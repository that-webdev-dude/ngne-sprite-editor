import { zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { celKey } from "../../src/core/model";
import type { SpriteDoc } from "../../src/core/model";
import { serialize } from "../../src/core/project";
import {
    HEIGHT,
    WIDTH,
    fixtureDocument,
    fixtureSession,
    fixtureSources,
    zipHeaders,
} from "./se-040-support";

/** DOS date and time of 1980-01-01 00:00:00: year 0 from 1980, month 1, day 1. */
const FIXED_DATE = (1 << 5) | 1;
const FIXED_TIME = 0;

const originalZone = process.env.TZ;

afterEach(() => {
    vi.useRealTimers();
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
});

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    return Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
}

/** The fixture's file as written at this moment. */
function write(): Uint8Array {
    return serialize(fixtureDocument(), fixtureSources());
}

/** A copy of the document whose maps and source store are filled in reverse order. */
function reversed(doc: SpriteDoc): SpriteDoc {
    return {
        ...doc,
        cels: new Map([...doc.cels].reverse()),
        images: new Map([...doc.images].reverse()),
    };
}

describe("serialize is deterministic", () => {
    it("yields identical bytes for the same document twice", () => {
        const doc = fixtureDocument();
        const sources = fixtureSources();
        const first = serialize(doc, sources);
        const second = serialize(doc, sources);

        expect(first).not.toBe(second);
        expect(sameBytes(first, second)).toBe(true);
        // And for an equal document built anew.
        expect(sameBytes(write(), first)).toBe(true);
    });

    it("yields identical bytes one second, one day and forty years apart", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-12T08:30:00Z"));
        const first = write();

        for (const later of [
            "2026-10-12T08:30:01Z",
            "2026-10-12T08:30:02Z",
            "2026-10-13T08:30:00Z",
            "2066-12-31T23:59:59Z",
        ]) {
            vi.setSystemTime(new Date(later));
            expect(Date.now()).toBe(Date.parse(later));
            expect(Number.isNaN(Date.now())).toBe(false);
            expect(sameBytes(write(), first), later).toBe(true);
        }
    });

    it("yields identical bytes in a second run, more than one second later by the real clock", async () => {
        // A zip time stamp counts steps of two seconds: the second run waits for the next one.
        const first = write();
        const started = Date.now();
        const step = Math.floor(started / 2000);
        while (Math.floor(Date.now() / 2000) === step || Date.now() - started < 1000) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }

        expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
        expect(sameBytes(write(), first)).toBe(true);
    }, 10_000);

    it("would differ between those moments without the fixed time stamp", () => {
        // The control for the test above: the same archive written with fflate's default,
        // the current time, changes when the clock passes a two-second boundary.
        const files = { "manifest.json": Uint8Array.of(1, 2, 3) };
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-12T08:30:00Z"));
        const first = zipSync(files);
        vi.setSystemTime(new Date("2026-10-12T08:30:02Z"));

        expect(sameBytes(zipSync(files), first)).toBe(false);
    });

    it("states 1980-01-01 00:00:00 for every entry, in both of its headers", () => {
        const headers = zipHeaders(write());

        expect(headers.length).toBe(9);
        for (const header of headers) {
            expect([header.date, header.time], header.name).toEqual([FIXED_DATE, FIXED_TIME]);
            expect([header.local.date, header.local.time], header.name).toEqual([
                FIXED_DATE,
                FIXED_TIME,
            ]);
        }
    });

    it("yields identical bytes in every time zone", () => {
        const zones = Intl.supportedValuesOf("timeZone");
        expect(zones.length).toBeGreaterThan(300);

        process.env.TZ = "UTC";
        const first = write();
        const offsets = new Set<number>();
        const different: string[] = [];
        for (const zone of zones) {
            process.env.TZ = zone;
            // The zone took effect: the local clock of this moment is read in it.
            offsets.add(new Date(2026, 0, 1).getTimezoneOffset());
            if (!sameBytes(write(), first)) different.push(zone);
        }
        expect(offsets.size).toBeGreaterThan(20);
        expect(different).toEqual([]);
    });

    it("does not depend on the order in which the document's maps were filled", () => {
        const doc = fixtureDocument();
        const first = serialize(doc, fixtureSources());
        const shuffled = reversed(doc);
        expect([...shuffled.cels.keys()]).not.toEqual([...doc.cels.keys()]);
        expect([...shuffled.images.keys()]).not.toEqual([...doc.images.keys()]);

        expect(sameBytes(serialize(shuffled, fixtureSources()), first)).toBe(true);
        const sources = new Map([...fixtureSources()].reverse());
        expect(sameBytes(serialize(doc, sources), first)).toBe(true);
    });

    it("does not depend on sources that no layer uses", () => {
        const sources = fixtureSources();
        const first = serialize(fixtureDocument(), sources);
        sources.delete("source-unused");

        expect(sameBytes(serialize(fixtureDocument(), sources), first)).toBe(true);
    });

    it("serializes a session with a selection to the same bytes as one without", () => {
        const selected = fixtureSession();
        expect(selected.selection).not.toBeNull();

        const plain = fixtureSession();
        plain.selection = null;
        plain.activeLayerId = "layer-bg";
        plain.activeFrameId = "frame-1";
        const first = serialize(plain.doc, fixtureSources());
        expect(sameBytes(serialize(selected.doc, fixtureSources()), first)).toBe(true);

        // Another selection and another active cel on the same document change nothing either.
        selected.selection = {
            mask: {
                width: WIDTH,
                height: HEIGHT,
                data: new Uint8Array(Math.ceil((WIDTH * HEIGHT) / 8)).fill(0xff),
            },
            bounds: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
        };
        selected.activeLayerId = "layer-fx";
        selected.activeFrameId = "frame-5";
        expect(sameBytes(serialize(selected.doc, fixtureSources()), first)).toBe(true);
    });

    it("changes with every part of the document", () => {
        // The other direction: bytes that never changed would pass every test above.
        const first = write();
        const changes: [string, (doc: SpriteDoc) => void][] = [
            ["name", (doc) => void (doc.name = "Hero")],
            ["pixel", (doc) => void (doc.images.get("image-fx")!.data[0] ^= 1)],
            ["colour under alpha 0", (doc) => void (doc.images.get("image-bg")!.data[12] ^= 1)],
            [
                "cel opacity",
                (doc) => void (doc.cels.get(celKey("layer-fx", "frame-2"))!.opacity = 1),
            ],
            ["frame duration", (doc) => void (doc.frames[4].durationMs = 251)],
            ["layer order", (doc) => void doc.layers.reverse()],
            ["tag", (doc) => void (doc.tags[1].repeat = 4)],
            ["palette", (doc) => void doc.palette.colors.pop()],
            ["pivot", (doc) => void (doc.pivot.y = 0.5)],
            ["setting", (doc) => void (doc.settings.onion.falloff = 0.7)],
            ["export setting", (doc) => void (doc.exportSettings.files.asepriteJson = "array")],
        ];
        for (const [name, change] of changes) {
            const doc = fixtureDocument();
            change(doc);
            expect(sameBytes(serialize(doc, fixtureSources()), first), name).toBe(false);
        }
    });
});

describe("the archive serialize writes", () => {
    it("stores PNG entries uncompressed and deflates the JSON entries", () => {
        const file = write();
        const headers = zipHeaders(file);

        for (const header of headers) {
            const png = header.name.endsWith(".png");
            expect(header.method, header.name).toBe(png ? 0 : 8);
            expect(header.local.method, header.name).toBe(header.method);
            if (png) {
                expect(header.compressedSize, header.name).toBe(header.size);
                // The entry's data is the PNG file itself, readable in place.
                const data = Buffer.from(file).subarray(header.dataStart, header.dataStart + 8);
                expect(Array.from(data), header.name).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
            }
        }
        expect(
            headers.filter((header) => header.method === 8).map((header) => header.name),
        ).toEqual(["manifest.json", "doc.json"]);
    });

    it("is a plain zip: no flags, extra fields, comments, attributes or data before it", () => {
        const file = Buffer.from(write());
        const headers = zipHeaders(file);

        expect(headers[0].offset).toBe(0);
        for (const header of headers) {
            expect([header.flags, header.local.flags], header.name).toEqual([0, 0]);
            expect([header.extraLength, header.local.extraLength, header.commentLength]).toEqual([
                0, 0, 0,
            ]);
            // Made by: specification 2.0 on MS-DOS, the host that implies no file attributes.
            expect([header.madeBy, header.attributes], header.name).toEqual([20, 0]);
        }
        // The end record closes the file: no archive comment.
        expect(file.readUInt16LE(file.length - 2)).toBe(0);
    });
});
