import { deflateRawSync } from "node:zlib";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    MAX_REFERENCE_SOURCE_BYTES,
    ProjectError,
    deserialize,
    serialize,
} from "../../src/core/project";
import type { ProjectErrorCode } from "../../src/core/project";
import {
    MAX_DOC_JSON_BYTES,
    MAX_PROJECT_CONTENT_BYTES,
    maxImageEntryBytes,
} from "../../src/core/project/format";
import { crc32, openZip, writeZip } from "../../src/core/project/zip";
import {
    HEIGHT,
    REFERENCE_PNG,
    SOURCE_ID,
    WIDTH,
    expectFailure,
    expectSamePixels,
    failure,
    fixtureDocJson,
    fixtureDocument,
    fixtureFile,
    jsonBytes,
    pngChunk,
    pngFile,
    pngHeaderChunk,
    projectEntries,
    rebuilt,
    smallDocument,
    zipHeaders,
    zipOf,
} from "./se-040-support";
import type { TestEntry } from "./se-040-support";

afterEach(() => {
    vi.unstubAllGlobals();
});

/** Fails unless the file reads as the fixture: document, pixels and reference source. */
async function expectFixture(bytes: Uint8Array): Promise<void> {
    const project = await deserialize(bytes);
    expect(project.doc).toEqual(fixtureDocument());
    expectSamePixels(project.doc, fixtureDocument());
    expect([...project.referenceSources.keys()]).toEqual([SOURCE_ID]);
    const source = project.referenceSources.get(SOURCE_ID) ?? new Uint8Array(0);
    expect(Buffer.compare(Buffer.from(source), REFERENCE_PNG)).toBe(0);
}

/**
 * Runs `run` and returns the largest typed array of bytes that code outside libraries asked
 * for meanwhile (`new Uint8Array(n)`, `new Uint8ClampedArray(n)`). fflate keeps its own
 * reference to `Uint8Array`, so its working buffers are not seen; the buffers that are sized
 * from what a file states are allocated in `core/project` and `core/png`, and are.
 */
async function largestAllocation(run: () => Promise<unknown>): Promise<number> {
    let largest = 0;
    for (const name of ["Uint8Array", "Uint8ClampedArray"] as const) {
        const original: new (...args: unknown[]) => object = globalThis[name];
        vi.stubGlobal(
            name,
            new Proxy(original, {
                construct(target, args: unknown[], newTarget: typeof original) {
                    if (typeof args[0] === "number") largest = Math.max(largest, args[0]);
                    return Reflect.construct(target, args, newTarget);
                },
            }),
        );
    }
    try {
        await run();
    } finally {
        vi.unstubAllGlobals();
    }
    return largest;
}

const MIB = 1024 * 1024;

describe("openZip and writeZip", () => {
    it("computes the CRC-32 of the zip specification", () => {
        // The check value of CRC-32/ISO-HDLC.
        expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
        expect(crc32(new Uint8Array(0))).toBe(0);
    });

    it("reads back what writeZip wrote, stored and deflated", () => {
        const text = Buffer.from("deflate me ".repeat(200));
        const raw = Uint8Array.of(0, 1, 2, 250, 251, 252);
        const archive = openZip(
            writeZip([
                { name: "a.json", data: text, stored: false },
                { name: "b/c.png", data: raw, stored: true },
                { name: "empty", data: new Uint8Array(0), stored: false },
            ]),
            MIB,
        );

        expect(Buffer.compare(Buffer.from(archive.read("a.json", MIB) ?? []), text)).toBe(0);
        expect(Array.from(archive.read("b/c.png", MIB) ?? [])).toEqual(Array.from(raw));
        expect(archive.read("empty", MIB)).toHaveLength(0);
        // Names are compared as they are spelled.
        expect(archive.read("A.JSON", MIB)).toBeUndefined();
        expect(archive.read("missing", MIB)).toBeUndefined();
    });

    it("reads an archive without entries", () => {
        const archive = openZip(zipOf([]), MIB);
        expect(archive.read("manifest.json", MIB)).toBeUndefined();
    });

    it("the allocation probe of these tests sees the buffers a file sizes", async () => {
        const file = fixtureFile();
        const docJson = zipHeaders(file).find((entry) => entry.name === "doc.json")?.size ?? 0;
        expect(docJson).toBeGreaterThan(2000);

        // Reading the fixture allocates the inflated doc.json, and nothing larger.
        expect(await largestAllocation(() => deserialize(file))).toBe(docJson);
        expect(await largestAllocation(async () => void new Uint8ClampedArray(70_000))).toBe(
            70_000,
        );
    });

    it("refuses to read more than the total it was opened with", () => {
        const entries = [1, 2, 3].map((n) => ({ name: `${n}`, data: Buffer.alloc(40, n) }));
        const archive = openZip(zipOf(entries), 100);

        expect(archive.read("1", 50)).toHaveLength(40);
        expect(archive.read("2", 50)).toHaveLength(40);
        let thrown: unknown;
        try {
            archive.read("3", 50);
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(ProjectError);
        expect((thrown as ProjectError).code).toBe("too-large");
        expect((thrown as ProjectError).message).toMatch(/hold more than 100 bytes/);
    });
});

describe("deserialize: not a zip archive", () => {
    const valid = fixtureFile();
    const cases: [string, Uint8Array, RegExp][] = [
        ["empty input", new Uint8Array(0), /no end-of-central-directory record/],
        ["21 bytes", Buffer.alloc(21, 0x50), /no end-of-central-directory record/],
        ["text", Buffer.from("this is not a project file, only some text"), /no end-of-central/],
        ["a PNG file", REFERENCE_PNG, /no end-of-central-directory record/],
        ["a JSON file", jsonBytes(fixtureDocJson()), /no end-of-central-directory record/],
        ["a file cut one byte short", valid.subarray(0, -1), /no end-of-central-directory/],
        [
            "bytes after the end record that its comment length does not cover",
            Buffer.concat([valid, Buffer.from("more")]),
            /no end-of-central-directory record/,
        ],
        [
            "bytes before the first entry",
            zipOf(projectEntries(valid), { prefix: Buffer.from("#!/bin/sh\n") }),
            /central directory does not end where its end record starts/,
        ],
        [
            "bytes between the central directory and the end record",
            zipOf(projectEntries(valid), { beforeEnd: Buffer.alloc(8) }),
            /central directory does not end where its end record starts/,
        ],
    ];

    it.each(cases)("rejects %s", async (_name, bytes, message) => {
        const error = await expectFailure(bytes, "not-a-zip", message);
        expect(error.message).toMatch(/^The file is not a zip archive: /);
    });

    it("rejects a directory with more records than the end record counts", async () => {
        const bytes = zipOf(projectEntries(valid), {
            patchEnd: (end) => {
                end.writeUInt16LE(8, 8);
                end.writeUInt16LE(8, 10);
            },
        });
        await expectFailure(bytes, "not-a-zip", /central directory holds more than its entries/);
    });

    it("rejects a directory with fewer records than the end record counts", async () => {
        const bytes = zipOf(projectEntries(valid), {
            patchEnd: (end) => {
                end.writeUInt16LE(10, 8);
                end.writeUInt16LE(10, 10);
            },
        });
        await expectFailure(
            bytes,
            "not-a-zip",
            /entry 10 of 10 in its central directory is damaged/,
        );
    });

    it("rejects a damaged directory record", async () => {
        const bytes = Buffer.from(valid);
        const second = zipHeaders(bytes)[1];
        bytes.writeUInt32LE(0x02014b51, second.recordOffset);
        await expectFailure(bytes, "not-a-zip", /entry 2 of 9 in its central directory is damaged/);

        // A name length that runs past the directory.
        const long = Buffer.from(valid);
        long.writeUInt16LE(0xffff, zipHeaders(long)[8].recordOffset + 28);
        await expectFailure(long, "not-a-zip", /entry 9 of 9 in its central directory is damaged/);
    });

    it("rejects an entry without a local header where the directory says it is", async () => {
        const moved = rebuilt(valid, { "doc.json": { offset: 3 } });
        await expectFailure(moved, "not-a-zip", /entry "doc.json" has no local header/);

        const outside = rebuilt(valid, { "doc.json": { offset: 0xfffffff0 } });
        await expectFailure(outside, "not-a-zip", /entry "doc.json" has no local header/);
    });

    it("rejects an entry whose data runs into the central directory", async () => {
        // doc.json last, so that its data ends where the directory starts; one byte more
        // than it has is then a byte of the directory.
        const entries = projectEntries(valid);
        const doc = entries.splice(1, 1)[0];
        const stored = deflateRawSync(doc.data).length;
        await expectFixture(zipOf([...entries, doc]));

        const bytes = zipOf([...entries, { ...doc, compressedSize: stored + 1 }]);
        await expectFailure(bytes, "not-a-zip", /entry "doc.json" runs into the central directory/);
    });

    it("rejects an entry whose local header has another name", async () => {
        const bytes = rebuilt(valid, { "doc.json": { localName: "DOC.JSON" } });
        await expectFailure(
            bytes,
            "not-a-zip",
            /local header of entry "doc.json" has another name/,
        );
    });

    it("rejects every truncation of a project file", async () => {
        const file = serialize(smallDocument(), new Map());
        for (let length = 0; length < file.length; length++) {
            const error = await failure(file.subarray(0, length), `${length} bytes`);
            expect(error.code, `${length} bytes`).toBe("not-a-zip");
        }
    });

    it("rejects arbitrary bytes", async () => {
        await fc.assert(
            fc.asyncProperty(fc.uint8Array({ maxLength: 400 }), async (bytes) => {
                await failure(bytes);
            }),
            { numRuns: 300 },
        );
    });

    it("rejects arbitrary bytes that end with an end-of-central-directory record", async () => {
        const end = (count: number, size: number, offset: number): Buffer => {
            const record = Buffer.alloc(22);
            record.writeUInt32LE(0x06054b50, 0);
            record.writeUInt16LE(count, 8);
            record.writeUInt16LE(count, 10);
            record.writeUInt32LE(size, 12);
            record.writeUInt32LE(offset, 16);
            return record;
        };
        await fc.assert(
            fc.asyncProperty(
                fc.uint8Array({ maxLength: 300 }),
                fc.nat({ max: 0xffff }),
                fc.nat({ max: 300 }),
                async (bytes, count, size) => {
                    // The directory is where the record says: the bytes before it are read
                    // as its records.
                    const length = Math.min(size, bytes.length);
                    const file = Buffer.concat([bytes, end(count, length, bytes.length - length)]);
                    const error = await failure(file);
                    expect(["not-a-zip", "missing-manifest"]).toContain(error.code);
                },
            ),
            { numRuns: 300 },
        );
    });
});

describe("deserialize: zip features a project file must not use", () => {
    const valid = fixtureFile();

    it("rejects a zip64 archive", async () => {
        const record = Buffer.alloc(56);
        record.writeUInt32LE(0x06064b50, 0);
        const locator = Buffer.alloc(20);
        locator.writeUInt32LE(0x07064b50, 0);
        const bytes = zipOf(projectEntries(valid), { beforeEnd: Buffer.concat([record, locator]) });

        await expectFailure(bytes, "unsupported-zip", /uses the zip64 extension/);
    });

    it("rejects an archive that spans several disks", async () => {
        for (const offset of [4, 6]) {
            const bytes = zipOf(projectEntries(valid), {
                patchEnd: (end) => void end.writeUInt16LE(1, offset),
            });
            await expectFailure(bytes, "unsupported-zip", /spans several disks/);
        }
        const partial = zipOf(projectEntries(valid), {
            patchEnd: (end) => void end.writeUInt16LE(4, 8),
        });
        await expectFailure(partial, "unsupported-zip", /spans several disks/);
    });

    it("rejects an encrypted entry", async () => {
        const bytes = rebuilt(valid, { "manifest.json": { flags: 1 } });
        const error = await expectFailure(bytes, "unsupported-zip", /"manifest.json" is encrypted/);
        expect(error.entry).toBe("manifest.json");
    });

    it.each([
        ["bzip2", 12],
        ["LZMA", 14],
        ["Zstandard", 93],
        ["deflate64", 9],
    ])("rejects an entry compressed with %s", async (_name, method) => {
        const bytes = rebuilt(valid, { "doc.json": { method } });
        const error = await expectFailure(
            bytes,
            "unsupported-zip",
            new RegExp(`"doc.json" uses compression method ${method}`),
        );
        expect(error.entry).toBe("doc.json");
    });

    it("rejects two entries of one name", async () => {
        const entries = projectEntries(valid);
        const twice = zipOf([...entries, { ...entries[1], data: jsonBytes({ other: true }) }]);
        const error = await expectFailure(
            twice,
            "unsupported-zip",
            /two entries are named "doc.json"/,
        );
        expect(error.entry).toBe("doc.json");

        // Also when neither is an entry the format names.
        const extra = { name: "notes.txt", data: Buffer.from("x") };
        await expectFailure(zipOf([...entries, extra, extra]), "unsupported-zip", /"notes.txt"/);
    });
});

describe("deserialize: limits", () => {
    const valid = fixtureFile();
    const bomb = (bytes: number): Buffer => deflateRawSync(Buffer.alloc(bytes, 0x20));

    it("refuses a manifest.json above 64 KiB before inflating it", async () => {
        const data = Buffer.alloc(64 * 1024 + 1, 0x20);
        const bytes = rebuilt(valid, { "manifest.json": { data, method: 8 } });

        const error = await expectFailure(bytes, "too-large", /"manifest.json" holds 65537 bytes/);
        expect(error.message).toMatch(/the limit is 65536 bytes/);
        expect(error.entry).toBe("manifest.json");
    });

    it("refuses a doc.json above 16 MiB before inflating it", async () => {
        expect(MAX_DOC_JSON_BYTES).toBe(16 * MIB);
        // A real one: 17 kB of deflate data that expand to 16 MiB + 1 of white space.
        const real = rebuilt(valid, {
            "doc.json": { data: Buffer.alloc(MAX_DOC_JSON_BYTES + 1, 0x20), method: 8 },
        });
        expect(real.length).toBeLessThan(64 * 1024);
        const largest = await largestAllocation(async () => {
            const error = await expectFailure(real, "too-large", /"doc.json" holds 16777217 bytes/);
            expect(error.message).toMatch(/the limit is 16777216 bytes/);
        });
        expect(largest).toBeLessThan(64 * 1024);
    });

    it("refuses an entry that states 4 GiB without allocating it", async () => {
        for (const name of [
            "manifest.json",
            "doc.json",
            "images/image-bg.png",
            `refs/${SOURCE_ID}.png`,
        ]) {
            const bytes = rebuilt(valid, { [name]: { size: 0xffffffff, method: 8 } });
            const largest = await largestAllocation(async () => {
                const error = await expectFailure(bytes, "too-large", /holds 4294967295 bytes/);
                expect(error.entry, name).toBe(name);
            });
            expect(largest, name).toBeLessThan(64 * 1024);
        }
    });

    it("abandons a deflate stream that expands beyond the size its entry states", async () => {
        // 64 MiB of spaces in 64 kB of deflate data, behind a header that states 1000 bytes.
        const bytes = rebuilt(valid, { "doc.json": { body: bomb(64 * MIB), size: 1000 } });

        const started = performance.now();
        const error = await expectFailure(
            bytes,
            "corrupt-entry",
            /"doc.json" is damaged: it inflates to more than the 1000 bytes it states/,
        );
        expect(error.entry).toBe("doc.json");
        expect(performance.now() - started).toBeLessThan(2000);
    });

    it("stops inflating such a stream at its first step, not at its end", () => {
        // Only the start of the stream is real. A reader that inflated all of it before
        // comparing sizes would reach the bytes that are no deflate data and report those.
        const body = Buffer.concat([
            bomb(64 * MIB).subarray(0, 24 * 1024),
            Buffer.alloc(8192, 0xff),
        ]);
        const read = (size: number): ProjectError => {
            const archive = openZip(
                zipOf([{ name: "x", data: Buffer.alloc(0), method: 8, body, size }]),
                1024 * MIB,
            );
            try {
                archive.read("x", 1024 * MIB);
            } catch (error) {
                expect(error).toBeInstanceOf(ProjectError);
                return error as ProjectError;
            }
            throw new Error("the entry was read");
        };

        expect(read(1000).message).toMatch(/inflates to more than the 1000 bytes it states/);
        // The control: with room for all that the real part expands to, the bad part is reached.
        const patient = read(64 * MIB);
        expect(patient.code).toBe("corrupt-entry");
        expect(patient.message).toMatch(/not a valid deflate stream/);
    });

    it("refuses an image entry larger than an image of the document can be", async () => {
        const limit = maxImageEntryBytes(WIDTH, HEIGHT);
        expect(limit).toBe(HEIGHT * (4 * WIDTH + 1) + 64 * 1024);
        const bytes = rebuilt(valid, {
            "images/image-fx.png": { data: Buffer.alloc(limit + 1), method: 8 },
        });

        const error = await expectFailure(bytes, "too-large", /"images\/image-fx.png" holds/);
        expect(error.message).toContain(`the limit is ${limit} bytes`);
    });

    it("refuses a reference entry above 64 MiB", async () => {
        expect(MAX_REFERENCE_SOURCE_BYTES).toBe(64 * MIB);
        const bytes = rebuilt(valid, {
            [`refs/${SOURCE_ID}.png`]: { size: MAX_REFERENCE_SOURCE_BYTES + 1, method: 8 },
        });

        const error = await expectFailure(bytes, "too-large", /holds 67108865 bytes/);
        expect(error.entry).toBe(`refs/${SOURCE_ID}.png`);
    });

    it("bounds what the entries hold together at 2 GiB", () => {
        expect(MAX_PROJECT_CONTENT_BYTES).toBe(2 * 1024 * MIB);
    });

    it("refuses more than 1 GiB of pixel data before reading an image", async () => {
        // 257 images of 1024 × 1024 pixels; the file holds none of them, so a reader that
        // went for the images first would report a missing one.
        const docJson = fixtureDocJson();
        docJson.width = 1024;
        docJson.height = 1024;
        docJson.frames = Array.from({ length: 257 }, (_, index) => ({
            id: `f${index}`,
            durationMs: 100,
        }));
        docJson.cels = docJson.frames.map((frame, index) => ({
            layerId: "layer-bg",
            frameId: frame.id,
            imageId: `i${index}`,
            opacity: 255,
        }));
        docJson.tags = [];
        docJson.exportSettings.frames = "all";

        const largest = await largestAllocation(async () => {
            const error = await expectFailure(
                rebuilt(valid, { "doc.json": jsonBytes(docJson) }),
                "too-large",
                /257 images of 1024×1024 pixels, 1077936128 bytes of pixel data/,
            );
            expect(error.message).toMatch(/the limit is 1073741824 bytes/);
        });
        expect(largest).toBeLessThan(MIB);

        // 256 such images are exactly 1 GiB and pass this check.
        docJson.frames.pop();
        docJson.cels.pop();
        const full = await failure(rebuilt(valid, { "doc.json": jsonBytes(docJson) }));
        expect(full.code).toBe("missing-image");
    });

    it("refuses an image whose header claims 100 000 × 100 000 pixels without allocating it", async () => {
        const huge = Buffer.concat([
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
            pngHeaderChunk(100_000, 100_000),
            // Enough data for the decoder's own plausibility check to let the size pass.
            pngChunk("IDAT", Buffer.alloc(50_000, 0x55)),
            pngChunk("IEND"),
        ]);
        const bytes = rebuilt(valid, { "images/image-bg.png": huge });

        const largest = await largestAllocation(async () => {
            const error = await expectFailure(
                bytes,
                "image-size",
                /"images\/image-bg.png" is an image of 100000×100000 pixels; the document is 4×3/,
            );
            expect(error.entry).toBe("images/image-bg.png");
        });
        expect(largest).toBeLessThan(MIB);
    });
});

describe("deserialize: damaged entries", () => {
    const valid = fixtureFile();

    /** The fixture's file with one bit of an entry's stored data flipped. */
    function withDamagedData(name: string): Buffer {
        const bytes = Buffer.from(valid);
        const header = zipHeaders(bytes).find((entry) => entry.name === name);
        if (!header) throw new Error(`no entry ${name}`);
        bytes[header.dataStart + header.compressedSize - 6] ^= 0x10;
        return bytes;
    }

    it.each(["manifest.json", "doc.json", "images/image-body-b.png", `refs/${SOURCE_ID}.png`])(
        "rejects %s when a bit of its data changed, naming the entry",
        async (name) => {
            const error = await failure(withDamagedData(name));

            expect(error.code).toBe("corrupt-entry");
            expect(error.entry).toBe(name);
            expect(error.message).toContain(`Entry "${name}" is damaged: `);
        },
    );

    it("rejects an entry that fails its CRC-32", async () => {
        for (const name of ["doc.json", "images/image-bg.png", `refs/${SOURCE_ID}.png`]) {
            const bytes = rebuilt(valid, { [name]: { crc: 0x12345678 } });
            const error = await expectFailure(bytes, "corrupt-entry", /it fails its checksum/);
            expect(error.entry, name).toBe(name);
        }
    });

    it("rejects an entry whose data is not a deflate stream", async () => {
        const body = Buffer.alloc(64, 0xff);
        const bytes = rebuilt(valid, { "doc.json": { body } });
        const error = await expectFailure(bytes, "corrupt-entry", /not a valid deflate stream/);
        expect(error.entry).toBe("doc.json");
        expect(error.cause).toBeInstanceOf(Error);
    });

    it("rejects a deflate stream that is cut short", async () => {
        const data = jsonBytes(fixtureDocJson());
        const body = deflateRawSync(data).subarray(0, -9);
        const bytes = rebuilt(valid, { "doc.json": { body } });
        await expectFailure(bytes, "corrupt-entry", /"doc.json" is damaged: /);
    });

    it("rejects an entry that inflates to less than it states", async () => {
        const data = jsonBytes(fixtureDocJson());
        const bytes = rebuilt(valid, { "doc.json": { size: data.length + 5 } });
        await expectFailure(
            bytes,
            "corrupt-entry",
            new RegExp(`it inflates to ${data.length} bytes and states ${data.length + 5}`),
        );
    });

    it("rejects a stored entry whose two sizes differ", async () => {
        const name = "images/image-bg.png";
        const stored = zipHeaders(valid).find((entry) => entry.name === name)?.size ?? 0;
        const bytes = rebuilt(valid, { [name]: { size: stored - 1 } });
        await expectFailure(
            bytes,
            "corrupt-entry",
            new RegExp(`it stores ${stored} bytes and states ${stored - 1}`),
        );
    });

    it("rejects a JSON entry that is not UTF-8", async () => {
        const data = Buffer.concat([
            Buffer.from('{"format":"'),
            Buffer.from([0xff, 0xfe]),
            Buffer.from('"}'),
        ]);
        const bytes = rebuilt(valid, { "manifest.json": data });
        const error = await expectFailure(
            bytes,
            "corrupt-entry",
            /"manifest.json" is damaged: it is not UTF-8/,
        );
        expect(error.entry).toBe("manifest.json");
    });

    it.each([
        ["nothing", ""],
        ["text", "not json"],
        ["a cut-off object", '{"id": "doc-hero", "name": '],
        ["two values", "{} {}"],
        ["a trailing comma", '{"id": "doc-hero",}'],
        ["a comment", '// doc\n{"id": "doc-hero"}'],
        ["nesting deeper than any parser allows", "[".repeat(200_000)],
    ])("rejects a doc.json that is %s", async (_name, text) => {
        const bytes = rebuilt(valid, { "doc.json": Buffer.from(text) });
        const error = await expectFailure(bytes, "corrupt-entry", /"doc.json" is damaged: /);
        expect(error.entry).toBe("doc.json");
    });

    it("rejects a manifest.json that is not JSON", async () => {
        const bytes = rebuilt(valid, {
            "manifest.json": Buffer.from("format=ngne-sprite-project"),
        });
        await expectFailure(
            bytes,
            "corrupt-entry",
            /"manifest.json" is damaged: it is not valid JSON/,
        );
    });
});

describe("deserialize: files as other programs write them", () => {
    const valid = fixtureFile();
    const entries = (): TestEntry[] => projectEntries(valid);

    it("reads the fixture written by a zip writer other than fflate", async () => {
        await expectFixture(zipOf(entries()));
    });

    it("reads a file whose entries are all deflated, PNG entries included", async () => {
        await expectFixture(zipOf(entries().map((entry) => ({ ...entry, method: 8 }))));
    });

    it("reads a file whose entries are all stored, JSON entries included", async () => {
        await expectFixture(zipOf(entries().map((entry) => ({ ...entry, method: 0 }))));
    });

    it("reads entries with data descriptors, as a streaming writer leaves them", async () => {
        await expectFixture(zipOf(entries().map((entry) => ({ ...entry, method: 8, flags: 8 }))));
    });

    it("reads entries with extra fields, comments and the UTF-8 flag", async () => {
        // An extended-timestamp field, as Info-ZIP writes it.
        const extra = Buffer.from([0x55, 0x54, 5, 0, 1, 0x78, 0x56, 0x34, 0x12]);
        const changed = entries().map((entry) => ({
            ...entry,
            extra,
            comment: "a comment ✦",
            flags: 0x800,
        }));
        await expectFixture(zipOf(changed, { comment: Buffer.from("archive comment") }));
    });

    it("reads entries in any order", async () => {
        await expectFixture(zipOf(entries().reverse()));
        await expectFixture(zipOf(entries().sort((a, b) => (a.name < b.name ? -1 : 1))));
    });

    it("ignores entries the format does not name, whatever they hold", async () => {
        const unknown: TestEntry[] = [
            { name: "images/", data: new Uint8Array(0) },
            { name: "refs/", data: new Uint8Array(0) },
            { name: "notes.txt", data: Buffer.from("remember the hat") },
            { name: "__MACOSX/._doc.json", data: Buffer.alloc(82, 7) },
            { name: "images/not-used.png", data: Buffer.from("not even a PNG") },
            { name: "refs/not-used.png", data: Buffer.from("nor this") },
            { name: "Manifest.JSON", data: Buffer.from("{}") },
            // Never read: neither its method, its size, its flag nor its checksum matters.
            { name: "secret.bin", data: Buffer.alloc(4), method: 99, flags: 1, size: 0xfffffffe },
            { name: "bad-crc.bin", data: Buffer.alloc(4), crc: 1 },
            // A name that is not UTF-8.
            {
                name: Uint8Array.of(0x66, 0xff, 0xfe, 0x2e, 0x74, 0x78, 0x74),
                data: Buffer.from("x"),
            },
        ];
        await expectFixture(zipOf([...unknown.slice(0, 5), ...entries(), ...unknown.slice(5)]));
    });

    it("reads a file without thumb.png, and one whose thumb.png is not an image", async () => {
        await expectFixture(rebuilt(valid, { "thumb.png": null }));
        await expectFixture(rebuilt(valid, { "thumb.png": Buffer.from("no picture") }));
    });

    it("reads JSON with a byte order mark, CRLF, tabs, no white space or another field order", async () => {
        const docJson = fixtureDocJson();
        const manifest = {
            generator: "another program 3.1",
            version: 1,
            format: "ngne-sprite-project",
        };
        const reordered = Object.fromEntries(Object.entries(docJson).reverse());
        const bom = Buffer.from([0xef, 0xbb, 0xbf]);
        const texts = [
            JSON.stringify(docJson),
            JSON.stringify(docJson, null, "\t").replaceAll("\n", "\r\n"),
            JSON.stringify(reordered, null, 1),
        ];
        for (const text of texts) {
            await expectFixture(
                rebuilt(valid, {
                    "manifest.json": Buffer.concat([bom, Buffer.from(JSON.stringify(manifest))]),
                    "doc.json": Buffer.concat([bom, Buffer.from(text)]),
                }),
            );
        }
    });

    it("reads images written with other PNG settings, as long as they are 8-bit RGBA", async () => {
        const doc = fixtureDocument();
        const changes: Record<string, Uint8Array> = {};
        for (const [imageId, image] of doc.images) {
            const pixels: number[][] = [];
            for (let at = 0; at < image.data.length; at += 4) {
                pixels.push(Array.from(image.data.subarray(at, at + 4)));
            }
            // Stored deflate blocks, a text chunk, and bytes after IEND.
            changes[`images/${imageId}.png`] = Buffer.concat([
                pngFile(WIDTH, HEIGHT, pixels, [
                    pngChunk("tEXt", Buffer.from("Software\0another program", "latin1")),
                ]),
                Buffer.from("after the end"),
            ]);
        }
        await expectFixture(rebuilt(valid, changes));
    });
});

describe("deserialize: a file with any single bit changed", () => {
    it("is rejected or reads as the same document", async () => {
        const doc = smallDocument();
        const file = serialize(doc, new Map());
        const codes = new Map<ProjectErrorCode | "same document", number>();
        for (let bit = 0; bit < file.length * 8; bit++) {
            const damaged = Buffer.from(file);
            damaged[bit >> 3] ^= 1 << (bit & 7);
            const outcome = await deserialize(damaged).then(
                (project) => project,
                (error: unknown) => error,
            );
            if (outcome instanceof ProjectError) {
                codes.set(outcome.code, (codes.get(outcome.code) ?? 0) + 1);
                continue;
            }
            // Only a bit the reader has no use for may pass: a time stamp, a version, the
            // local copy of a size or checksum, the thumbnail.
            expect(outcome, `bit ${bit}`).not.toBeInstanceOf(Error);
            const project = outcome as Awaited<ReturnType<typeof deserialize>>;
            expect(project.doc, `bit ${bit}`).toEqual(doc);
            expectSamePixels(project.doc, doc);
            codes.set("same document", (codes.get("same document") ?? 0) + 1);
        }
        // Most bits belong to data under a checksum or to the structure of the archive.
        const total = file.length * 8;
        expect(codes.get("corrupt-entry") ?? 0).toBeGreaterThan(total / 4);
        expect(codes.get("not-a-zip") ?? 0).toBeGreaterThan(0);
        expect(codes.get("same document") ?? 0).toBeLessThan(total / 2);
    }, 60_000);
});
