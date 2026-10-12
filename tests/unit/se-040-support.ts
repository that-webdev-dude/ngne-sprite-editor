import { crc32, deflateRawSync } from "node:zlib";
import { unzipSync } from "fflate";
import { expect } from "vitest";
import { celKey, createDocument } from "../../src/core/model";
import type {
    DocSession,
    PixelBuffer,
    PixelLayer,
    ReferenceLayer,
    SpriteDoc,
} from "../../src/core/model";
import { ProjectError, deserialize, docToJson, serialize } from "../../src/core/project";
import type { DocJson, ProjectErrorCode } from "../../src/core/project";

// Shared by the SE-040 tests: the fixture document of the acceptance list, a zip writer and a
// zip reader that do not use the code under test, and helpers to damage a project file.

// --- the fixture --------------------------------------------------------------------------------

export const WIDTH = 4;
export const HEIGHT = 3;

/** One pixel: red, green, blue, alpha. */
export type Rgba = readonly [number, number, number, number];

export function imageOf(pixels: readonly Rgba[], width = WIDTH, height = HEIGHT): PixelBuffer {
    const data = Uint8ClampedArray.from(pixels.flat());
    if (data.length !== width * height * 4) {
        throw new Error(`imageOf: ${data.length} bytes do not fill ${width}×${height} pixels`);
    }
    return { width, height, data };
}

/** A `width` × `height` image whose bytes follow from `seed`, with every kind of alpha. */
export function noiseImage(seed: number, width = WIDTH, height = HEIGHT): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    let state = seed;
    for (let i = 0; i < data.length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        data[i] = state >>> 24;
    }
    // Every third pixel is fully transparent and keeps its colour; every fifth is opaque.
    for (let pixel = 0; pixel < width * height; pixel++) {
        if (pixel % 3 === 0) data[pixel * 4 + 3] = 0;
        else if (pixel % 5 === 0) data[pixel * 4 + 3] = 255;
    }
    return { width, height, data };
}

const C: Rgba = [0, 0, 0, 0];

/** The pixels of an image, given row by row. */
function rows(...lines: (readonly Rgba[])[]): Rgba[] {
    return lines.flat();
}

/** The background: opaque except for its last column, which is transparent with a colour. */
export const IMAGE_BG = imageOf(
    rows(
        [
            [10, 20, 30, 255],
            [40, 50, 60, 255],
            [70, 80, 90, 255],
            [200, 100, 50, 0],
        ],
        [
            [0, 0, 0, 255],
            [255, 255, 255, 255],
            [128, 128, 128, 255],
            [1, 2, 3, 0],
        ],
        [
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [0, 0, 255, 255],
            [9, 9, 9, 0],
        ],
    ),
);

/** The body at frames 1 and 3: mostly transparent, one pixel of it with a colour. */
export const IMAGE_BODY_A = imageOf(
    rows(
        [C, [11, 12, 13, 255], C, [100, 110, 120, 128]],
        [[77, 66, 55, 0], C, [21, 22, 23, 255], C],
        [C, C, C, [31, 32, 33, 255]],
    ),
);

/**
 * The composite of the fixture's first frame, worked out by hand from the two images above
 * (both layers at opacity 255, normal blend): an opaque body pixel replaces the background, a
 * transparent one leaves it, and over the transparent last column the body pixel stands as
 * it is, or nothing does. Colour under alpha 0 never reaches a composite.
 */
export const FIRST_FRAME_COMPOSITE: readonly Rgba[] = rows(
    [
        [10, 20, 30, 255],
        [11, 12, 13, 255],
        [70, 80, 90, 255],
        [100, 110, 120, 128],
    ],
    [
        [0, 0, 0, 255],
        [255, 255, 255, 255],
        [21, 22, 23, 255],
        [0, 0, 0, 0],
    ],
    [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [31, 32, 33, 255],
    ],
);

function pixelLayer(id: string, name: string, change: Partial<PixelLayer> = {}): PixelLayer {
    return {
        id,
        name,
        kind: "pixel",
        visible: true,
        locked: false,
        opacity: 255,
        blend: "normal",
        ...change,
    };
}

/** ID of the fixture's reference source. */
export const SOURCE_ID = "source-sketch";

/** A second source that no layer of the fixture uses. */
export const UNUSED_SOURCE_ID = "source-unused";

/**
 * The fixture of the acceptance list: three pixel layers and a reference layer, five frames,
 * linked cels (the background is one image at all five frames; the body shares one between
 * frames 1 and 3), two tags, a palette, and settings and export settings that all differ from
 * the defaults. The session has a selection and names a layer and a frame other than the
 * first.
 */
export function fixtureSession(): DocSession {
    const ids = ["doc-hero", "layer-bg", "frame-1"];
    const session = createDocument({ name: "Hero ✦ idle", width: WIDTH, height: HEIGHT }, () => {
        const id = ids.shift();
        if (id === undefined) throw new Error("fixtureSession: unexpected ID request");
        return id;
    });
    const { doc } = session;

    const reference: ReferenceLayer = {
        id: "layer-ref",
        name: "Sketch",
        kind: "reference",
        visible: true,
        locked: true,
        opacity: 128,
        sourceId: SOURCE_ID,
        x: -1.5,
        y: 0.25,
        scale: 0.125,
        placement: "behind",
    };
    doc.layers = [
        reference,
        pixelLayer("layer-bg", "Background"),
        pixelLayer("layer-body", "Body"),
        // Hidden, so its blend mode and opacity change no composite.
        pixelLayer("layer-fx", "FX", {
            visible: false,
            locked: true,
            opacity: 64,
            blend: "screen",
        }),
    ];
    doc.frames = [
        { id: "frame-1", durationMs: 100 },
        { id: "frame-2", durationMs: 80 },
        { id: "frame-3", durationMs: 1 },
        { id: "frame-4", durationMs: 65535 },
        { id: "frame-5", durationMs: 250 },
    ];

    const cel = (layer: string, frame: string, imageId: string, opacity = 255) => {
        doc.cels.set(celKey(layer, frame), { imageId, opacity });
    };
    doc.images.set("image-bg", IMAGE_BG);
    for (const frame of doc.frames) cel("layer-bg", frame.id, "image-bg");
    doc.images.set("image-body-a", IMAGE_BODY_A);
    doc.images.set("image-body-b", noiseImage(11));
    doc.images.set("image-body-c", noiseImage(12));
    cel("layer-body", "frame-1", "image-body-a");
    cel("layer-body", "frame-2", "image-body-b", 128);
    cel("layer-body", "frame-3", "image-body-a");
    cel("layer-body", "frame-5", "image-body-c", 1);
    doc.images.set("image-fx", noiseImage(13));
    cel("layer-fx", "frame-2", "image-fx", 0);

    doc.tags = [
        {
            id: "tag-idle",
            name: "idle",
            color: 0x3cb371ff,
            fromFrameId: "frame-1",
            toFrameId: "frame-3",
            direction: "forward",
            repeat: 0,
        },
        {
            id: "tag-blink",
            name: "blink ✦",
            color: 0xff000080,
            fromFrameId: "frame-4",
            toFrameId: "frame-5",
            direction: "pingpong",
            repeat: 3,
        },
    ];
    doc.palette = { name: "Hero", colors: [0x00000000, 0xffffffff, 0x12345678, 0xff8000ff] };
    doc.pivot = { x: 0.25, y: 1 };
    doc.settings = {
        grid: { width: 8, height: 4, offsetX: -2, offsetY: 3, visible: true },
        pixelGrid: false,
        onion: {
            enabled: true,
            before: 3,
            after: 0,
            opacity: 96,
            falloff: 0.75,
            tint: true,
            placement: "front",
            withinTag: true,
        },
        symmetry: { mode: "both", axisX: 3, axisY: 5 },
        tiled: "x",
    };
    doc.exportSettings = {
        layout: "row",
        padding: 4,
        extrude: 2,
        trim: true,
        mergeDuplicates: false,
        frames: { tagId: "tag-idle" },
        files: { spritesTs: false, previewConfig: false, asepriteJson: "hash" },
        exportOnSave: true,
    };

    session.activeLayerId = "layer-body";
    session.activeFrameId = "frame-4";
    session.selection = {
        mask: { width: WIDTH, height: HEIGHT, data: Uint8Array.of(0b0011_0011, 0) },
        bounds: { x: 0, y: 0, width: 2, height: 2 },
    };
    return session;
}

/** The fixture's document alone. */
export function fixtureDocument(): SpriteDoc {
    return fixtureSession().doc;
}

/**
 * The reference sources of the fixture's store: the one its reference layer uses and one
 * that no layer uses.
 */
export function fixtureSources(): Map<string, Uint8Array> {
    return new Map([
        [SOURCE_ID, REFERENCE_PNG],
        [UNUSED_SOURCE_ID, pngFile(1, 1, [[1, 2, 3]])],
    ]);
}

/** The smallest project: one layer, one frame, one 2 × 2 cel, no reference. */
export function smallDocument(): SpriteDoc {
    const ids = ["doc", "layer", "frame"];
    const { doc } = createDocument({ name: "small", width: 2, height: 2 }, () => ids.shift() ?? "");
    doc.images.set("image", noiseImage(7, 2, 2));
    doc.cels.set(celKey("layer", "frame"), { imageId: "image", opacity: 255 });
    return doc;
}

// --- PNG files written here ---------------------------------------------------------------------
// The zlib stream is written with stored blocks, so these bytes do not depend on the version
// of zlib: the committed golden file holds them.

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function pngChunk(type: string, content: Uint8Array = new Uint8Array(0)): Buffer {
    const body = Buffer.concat([Buffer.from(type, "latin1"), content]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(content.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
}

export function pngHeaderChunk(
    width: number,
    height: number,
    bitDepth = 8,
    colorType = 6,
    interlace = 0,
): Buffer {
    const content = Buffer.alloc(13);
    content.writeUInt32BE(width, 0);
    content.writeUInt32BE(height, 4);
    content.set([bitDepth, colorType, 0, 0, interlace], 8);
    return pngChunk("IHDR", content);
}

/** A zlib stream of one stored block. */
function storedZlib(data: Uint8Array): Buffer {
    let a = 1;
    let b = 0;
    for (const byte of data) {
        a = (a + byte) % 65521;
        b = (b + a) % 65521;
    }
    const header = Buffer.from([0x78, 0x01, 0x01, 0, 0, 0, 0]);
    header.writeUInt16LE(data.length, 3);
    header.writeUInt16LE(~data.length & 0xffff, 5);
    const adler = Buffer.alloc(4);
    adler.writeUInt32BE(((b << 16) | a) >>> 0);
    return Buffer.concat([header, data, adler]);
}

/**
 * A PNG file of `width` × `height` pixels: `pixels` holds one array of samples per pixel,
 * three for an RGB file (colour type 2) and four for RGBA (colour type 6). `extra` chunks
 * stand before the image data.
 */
export function pngFile(
    width: number,
    height: number,
    pixels: readonly (readonly number[])[],
    extra: readonly Uint8Array[] = [],
): Buffer {
    const channels = pixels[0].length;
    const lines: number[] = [];
    for (let y = 0; y < height; y++) {
        lines.push(0, ...pixels.slice(y * width, (y + 1) * width).flat());
    }
    return Buffer.concat([
        PNG_SIGNATURE,
        pngHeaderChunk(width, height, 8, channels === 3 ? 2 : 6),
        ...extra,
        pngChunk("IDAT", storedZlib(Uint8Array.from(lines))),
        pngChunk("IEND"),
    ]);
}

/**
 * The fixture's reference image as another program would write it: an RGB file with a text
 * chunk, followed by bytes after its IEND chunk. `serialize` must keep every one of them.
 */
export const REFERENCE_PNG: Buffer = Buffer.concat([
    pngFile(
        2,
        2,
        [
            [250, 240, 230],
            [10, 20, 30],
            [1, 2, 3],
            [255, 255, 255],
        ],
        [pngChunk("tEXt", Buffer.from("Software\0another program", "latin1"))],
    ),
    Buffer.from("trailing bytes"),
]);

// --- a zip writer of its own --------------------------------------------------------------------
// Written from the zip specification with node:zlib, so that the archives the reader is
// tested with are not made by the library the writer under test uses.

export interface TestEntry {
    name: string | Uint8Array;
    data: Uint8Array;
    /** 0 stores and 8 deflates; any other number is stated over stored data. Default 0. */
    method?: number;
    /** General-purpose flags; bit 3 (a data descriptor follows the data) is honoured. */
    flags?: number;
    /** What the headers state in place of the true values. */
    crc?: number;
    size?: number;
    compressedSize?: number;
    /** The bytes written as the entry's data in place of the stored or deflated content. */
    body?: Uint8Array;
    /** The name the local header states in place of `name`. */
    localName?: string;
    /** An extra field in both headers. */
    extra?: Uint8Array;
    /** A comment in the central directory. */
    comment?: string;
    /** The offset the central directory states for the local header. */
    offset?: number;
    /** DOS time and date; the default is the current time of nothing in particular. */
    time?: number;
    date?: number;
}

export interface TestZipOptions {
    /** Bytes before the first local header; the offsets do not account for them. */
    prefix?: Uint8Array;
    /** The archive comment. */
    comment?: Uint8Array;
    /** Written between the central directory and the end record. */
    beforeEnd?: Uint8Array;
    /** Changes the end record, which starts at byte 0 of `end`. */
    patchEnd?: (end: Buffer) => void;
}

function nameBytes(name: string | Uint8Array): Buffer {
    return typeof name === "string" ? Buffer.from(name, "utf8") : Buffer.from(name);
}

/** A zip archive of the entries, written as stated; nothing in it is checked. */
export function zipOf(entries: readonly TestEntry[], options: TestZipOptions = {}): Buffer {
    const parts: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
        const method = entry.method ?? 0;
        const name = nameBytes(entry.name);
        const localName = entry.localName === undefined ? name : nameBytes(entry.localName);
        const extra = Buffer.from(entry.extra ?? []);
        const comment = Buffer.from(entry.comment ?? "", "utf8");
        const body = Buffer.from(
            entry.body ?? (method === 8 ? deflateRawSync(entry.data) : entry.data),
        );
        const flags = entry.flags ?? 0;
        const described = (flags & 8) !== 0;
        const crc = entry.crc ?? crc32(entry.data);
        const size = entry.size ?? entry.data.length;
        const compressedSize = entry.compressedSize ?? body.length;
        const time = entry.time ?? 0x6b2a;
        const date = entry.date ?? 0x5b4c;

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(flags, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        // With a data descriptor the local header states nothing: a reader must not rely on it.
        local.writeUInt32LE(described ? 0 : crc, 14);
        local.writeUInt32LE(described ? 0 : compressedSize, 18);
        local.writeUInt32LE(described ? 0 : size, 22);
        local.writeUInt16LE(localName.length, 26);
        local.writeUInt16LE(extra.length, 28);
        const descriptor = Buffer.alloc(described ? 16 : 0);
        if (described) {
            descriptor.writeUInt32LE(0x08074b50, 0);
            descriptor.writeUInt32LE(crc, 4);
            descriptor.writeUInt32LE(compressedSize, 8);
            descriptor.writeUInt32LE(size, 12);
        }

        const record = Buffer.alloc(46);
        record.writeUInt32LE(0x02014b50, 0);
        record.writeUInt16LE(0x031e, 4);
        record.writeUInt16LE(20, 6);
        record.writeUInt16LE(flags, 8);
        record.writeUInt16LE(method, 10);
        record.writeUInt16LE(time, 12);
        record.writeUInt16LE(date, 14);
        record.writeUInt32LE(crc, 16);
        record.writeUInt32LE(compressedSize, 20);
        record.writeUInt32LE(size, 24);
        record.writeUInt16LE(name.length, 28);
        record.writeUInt16LE(extra.length, 30);
        record.writeUInt16LE(comment.length, 32);
        record.writeUInt32LE(0o100644 * 65536, 38);
        record.writeUInt32LE(entry.offset ?? offset, 42);
        central.push(record, name, extra, comment);

        parts.push(local, localName, extra, body, descriptor);
        offset += 30 + localName.length + extra.length + body.length + descriptor.length;
    }
    const directory = Buffer.concat(central);
    const comment = Buffer.from(options.comment ?? []);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(comment.length, 20);
    options.patchEnd?.(end);
    return Buffer.concat([
        Buffer.from(options.prefix ?? []),
        ...parts,
        directory,
        Buffer.from(options.beforeEnd ?? []),
        end,
        comment,
    ]);
}

// --- reading archives without the code under test -----------------------------------------------

/** The entries of an archive, in the order of its directory, read by fflate's own `unzipSync`. */
export function entriesOf(bytes: Uint8Array): Map<string, Uint8Array> {
    return new Map(Object.entries(unzipSync(bytes)));
}

export function textOf(bytes: Uint8Array): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** The parsed JSON entry of an archive. */
export function jsonOf(bytes: Uint8Array, name: string): unknown {
    const entry = entriesOf(bytes).get(name);
    if (!entry) throw new Error(`jsonOf: the archive has no entry "${name}"`);
    return JSON.parse(textOf(entry)) as unknown;
}

/** What one entry's two headers state. */
export interface ZipHeader {
    name: string;
    method: number;
    flags: number;
    time: number;
    date: number;
    size: number;
    compressedSize: number;
    /** Offset of the local header. */
    offset: number;
    /** Offset and length of the entry's data. */
    dataStart: number;
    local: { method: number; flags: number; time: number; date: number; extraLength: number };
    /** Offset of the entry's record in the central directory. */
    recordOffset: number;
    extraLength: number;
    commentLength: number;
    madeBy: number;
    attributes: number;
}

/** The headers of a well-formed archive without a comment, in directory order. */
export function zipHeaders(bytes: Uint8Array): ZipHeader[] {
    const file = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = file.length - 22;
    expect(file.readUInt32LE(end)).toBe(0x06054b50);
    const headers: ZipHeader[] = [];
    let at = file.readUInt32LE(end + 16);
    for (let index = 0; index < file.readUInt16LE(end + 10); index++) {
        expect(file.readUInt32LE(at)).toBe(0x02014b50);
        const nameLength = file.readUInt16LE(at + 28);
        const extraLength = file.readUInt16LE(at + 30);
        const commentLength = file.readUInt16LE(at + 32);
        const offset = file.readUInt32LE(at + 42);
        expect(file.readUInt32LE(offset)).toBe(0x04034b50);
        const localExtra = file.readUInt16LE(offset + 28);
        headers.push({
            name: file.toString("utf8", at + 46, at + 46 + nameLength),
            method: file.readUInt16LE(at + 10),
            flags: file.readUInt16LE(at + 8),
            time: file.readUInt16LE(at + 12),
            date: file.readUInt16LE(at + 14),
            size: file.readUInt32LE(at + 24),
            compressedSize: file.readUInt32LE(at + 20),
            offset,
            dataStart: offset + 30 + file.readUInt16LE(offset + 26) + localExtra,
            local: {
                method: file.readUInt16LE(offset + 8),
                flags: file.readUInt16LE(offset + 6),
                time: file.readUInt16LE(offset + 10),
                date: file.readUInt16LE(offset + 12),
                extraLength: localExtra,
            },
            recordOffset: at,
            extraLength,
            commentLength,
            madeBy: file.readUInt16LE(at + 4),
            attributes: file.readUInt32LE(at + 38),
        });
        at += 46 + nameLength + extraLength + commentLength;
    }
    expect(at).toBe(end);
    return headers;
}

// --- project files to damage --------------------------------------------------------------------

export function jsonBytes(value: unknown): Buffer {
    return Buffer.from(`${JSON.stringify(value, null, 4)}\n`, "utf8");
}

/** An entry of a project file as `zipOf` takes it. */
export interface ProjectEntry extends TestEntry {
    name: string;
    method: number;
}

/**
 * The entries of a project file for `zipOf`, in the file's order: JSON entries deflated and
 * the others stored, as `serialize` writes them, but then by the writer above.
 */
export function projectEntries(bytes: Uint8Array): ProjectEntry[] {
    return [...entriesOf(bytes)].map(([name, data]) => ({
        name,
        data,
        method: name.endsWith(".json") ? 8 : 0,
    }));
}

/** What `rebuilt` does with one entry: new content, `null` to leave it out, or new headers. */
export type EntryChange = Uint8Array | null | Partial<TestEntry>;

/**
 * A project file with the content of `bytes` after `changes`, by entry name; a name the
 * file does not have is added at the end, stored.
 */
export function rebuilt(
    bytes: Uint8Array,
    changes: Record<string, EntryChange> = {},
    options: TestZipOptions = {},
): Buffer {
    const entries = projectEntries(bytes);
    for (const name of Object.keys(changes)) {
        if (!entries.some((entry) => entry.name === name)) {
            entries.push({ name, data: new Uint8Array(0), method: 0 });
        }
    }
    const written: TestEntry[] = [];
    for (const entry of entries) {
        const change = Object.hasOwn(changes, entry.name) ? changes[entry.name] : undefined;
        if (change === null) continue;
        if (change instanceof Uint8Array) written.push({ ...entry, data: change });
        else written.push({ ...entry, ...change });
    }
    return zipOf(written, options);
}

/** The fixture as a project file, written by `serialize`. */
export function fixtureFile(): Uint8Array {
    return serialize(fixtureDocument(), fixtureSources());
}

/** The `doc.json` of the fixture, to change and write back. */
export function fixtureDocJson(): DocJson {
    return docToJson(fixtureDocument());
}

/** The fixture's file with another `doc.json`. */
export function withDocJson(docJson: unknown): Buffer {
    return rebuilt(fixtureFile(), { "doc.json": jsonBytes(docJson) });
}

/**
 * The error `deserialize` rejects with. Fails when it returns a document, or when the error
 * is not a `ProjectError`.
 */
export async function failure(bytes: Uint8Array, label = ""): Promise<ProjectError> {
    const outcome: unknown = await deserialize(bytes).then(
        (project) => `returned the document "${project.doc.name}"`,
        (error: unknown) => error,
    );
    expect(outcome, label).toBeInstanceOf(ProjectError);
    return outcome as ProjectError;
}

/** Expects `deserialize` to reject with this code and a message that matches. */
export async function expectFailure(
    bytes: Uint8Array,
    code: ProjectErrorCode,
    message: RegExp,
): Promise<ProjectError> {
    const error = await failure(bytes);
    expect(`${error.code}: ${error.message}`).toMatch(
        new RegExp(`^${code}: .*${message.source}`, "s"),
    );
    expect(error.name).toBe("ProjectError");
    return error;
}

/** The `ProjectError` a function throws; fails when it returns or throws something else. */
export function thrown(run: () => unknown): ProjectError {
    try {
        run();
    } catch (error) {
        expect(error).toBeInstanceOf(ProjectError);
        return error as ProjectError;
    }
    throw new Error("the call did not throw");
}

/** Describes the first pixel in which two buffers differ, or null when they are byte-equal. */
export function firstDifference(actual: PixelBuffer, expected: PixelBuffer): string | null {
    if (actual.width !== expected.width || actual.height !== expected.height) {
        return `${actual.width}×${actual.height}, expected ${expected.width}×${expected.height}`;
    }
    for (let at = 0; at < expected.data.length; at += 4) {
        const found = actual.data.subarray(at, at + 4).join();
        const wanted = expected.data.subarray(at, at + 4).join();
        if (found !== wanted) {
            const index = at / 4;
            const x = index % expected.width;
            return `pixel (${x}, ${(index - x) / expected.width}) is ${found}, expected ${wanted}`;
        }
    }
    return null;
}

/** Fails unless both documents hold the same images with the same bytes. */
export function expectSamePixels(actual: SpriteDoc, expected: SpriteDoc): void {
    expect([...actual.images.keys()].sort()).toEqual([...expected.images.keys()].sort());
    for (const [imageId, image] of expected.images) {
        const found = actual.images.get(imageId);
        expect(found?.data, imageId).toBeInstanceOf(Uint8ClampedArray);
        expect(found && firstDifference(found, image), imageId).toBeNull();
    }
}
