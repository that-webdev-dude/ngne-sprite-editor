import { celKey, defaultDocSettings, defaultExportSettings } from "../../src/core/model";
import type { ExportSettings, PixelBuffer, SpriteDoc, Tag } from "../../src/core/model";

// SE-053: the fixture documents of the export conformance checks (SPEC §9.7), built in code.
// The module is plain TypeScript without DOM or Node APIs. Three programs build the same
// documents from it: the export page (tests/e2e/harness/se-053-export.ts), which runs
// `bundle()` in the browser as the editor does; the specs, which composite the frames in
// Node to know what a game must show; and the unit tests.

/** The four fixtures of ticket SE-053, by the letter the ticket gives them. */
export type FixtureId = "a" | "b" | "c" | "d";

export const FIXTURE_IDS: readonly FixtureId[] = ["a", "b", "c", "d"];

export interface Fixture {
    id: FixtureId;
    /** What the ticket asks of it. */
    title: string;
    /** `<name>` of SPEC §9.1: the base name of the bundle's files and the ID of its image. */
    name: string;
    /** `<name>` and `<Name>` of SPEC §9.5, as in `<name>Image` and `draw<Name>`. */
    camel: string;
    pascal: string;
    build(): SpriteDoc;
}

// --- pixels -------------------------------------------------------------------------------------

/** Alpha values between transparent and opaque, the two ends among them. */
const PARTIAL_ALPHA = [1, 64, 128, 191, 254] as const;

/**
 * A `width` × `height` image of noise, so that a pixel drawn one place off shows:
 * - `inset` pixels at the left, top, right and bottom are transparent;
 * - inside, every eleventh pixel along a diagonal is a transparent hole;
 * - every seventh pixel along another diagonal has an alpha between 1 and 254;
 * - every other pixel is opaque.
 * A pixel with alpha 0 is 0,0,0,0. The holes are sparse, so trimming cuts an image of the
 * fixtures to exactly that inside (a unit test compares the rectangles).
 */
export function drawing(
    width: number,
    height: number,
    seed: number,
    inset: readonly [number, number, number, number] = [0, 0, 0, 0],
): PixelBuffer {
    let state = (seed * 2654435761 + 1) >>> 0;
    const next = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state >>> 24;
    };
    const [left, top, right, bottom] = inset;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const red = next();
            const green = next();
            const blue = next();
            const outside = x < left || y < top || x >= width - right || y >= height - bottom;
            if (outside || (x + y * 3 + seed) % 11 === 0) continue;
            const partial = (x * 5 + y * 2 + seed) % 7 === 0;
            const alpha = partial ? PARTIAL_ALPHA[(x + y + seed) % PARTIAL_ALPHA.length] : 255;
            data.set([red, green, blue, alpha], (y * width + x) * 4);
        }
    }
    return { width, height, data };
}

// --- documents ----------------------------------------------------------------------------------

interface LayerSpec {
    name: string;
    /** 0..255; 255 when left out. */
    opacity?: number;
    visible?: boolean;
    /** The image of each frame's cel; null is an empty cel. A number links to that frame's cel. */
    cels: (PixelBuffer | number | null)[];
    /** Opacity of every cel of the layer; 255 when left out. */
    celOpacity?: number;
}

interface TagSpec {
    name: string;
    from: number;
    to: number;
    direction?: Tag["direction"];
    repeat?: number;
}

interface DocumentSpec {
    name: string;
    width: number;
    height: number;
    /** Duration of each frame in milliseconds; their number is the number of frames. */
    durations: number[];
    /** Bottom to top. */
    layers: LayerSpec[];
    tags?: TagSpec[];
    pivot?: [number, number];
    settings?: Partial<Omit<ExportSettings, "files">>;
}

/** A document with the frames `frame-0`, `frame-1`, …, the layers `layer-0`, … and the tags `tag-0`, …. */
function spriteDocument(spec: DocumentSpec): SpriteDoc {
    const { width, height } = spec;
    const doc: SpriteDoc = {
        id: `doc-${spec.name}`,
        name: spec.name,
        width,
        height,
        colorMode: "rgba",
        layers: spec.layers.map((layer, index) => ({
            id: `layer-${index}`,
            name: layer.name,
            kind: "pixel",
            visible: layer.visible ?? true,
            locked: false,
            opacity: layer.opacity ?? 255,
            blend: "normal",
        })),
        frames: spec.durations.map((durationMs, index) => ({ id: `frame-${index}`, durationMs })),
        cels: new Map(),
        images: new Map(),
        tags: (spec.tags ?? []).map((tag, index) => ({
            id: `tag-${index}`,
            name: tag.name,
            color: 0x3cb371ff,
            fromFrameId: `frame-${tag.from}`,
            toFrameId: `frame-${tag.to}`,
            direction: tag.direction ?? "forward",
            repeat: tag.repeat ?? 0,
        })),
        palette: { name: "Test", colors: [] },
        pivot: { x: spec.pivot?.[0] ?? 0.5, y: spec.pivot?.[1] ?? 0.5 },
        settings: defaultDocSettings(width, height),
        exportSettings: { ...defaultExportSettings(), ...spec.settings },
    };
    spec.layers.forEach((layer, layerIndex) => {
        if (layer.cels.length !== spec.durations.length) {
            throw new Error(`Layer "${layer.name}" needs one cel per frame.`);
        }
        layer.cels.forEach((cel, frameIndex) => {
            if (cel === null) return;
            // A linked cel shares the image of the frame it names (SPEC §5.1).
            const imageId = `image-${layerIndex}-${typeof cel === "number" ? cel : frameIndex}`;
            if (typeof cel !== "number") doc.images.set(imageId, cel);
            doc.cels.set(celKey(`layer-${layerIndex}`, `frame-${frameIndex}`), {
                imageId,
                opacity: layer.celOpacity ?? 255,
            });
        });
    });
    return doc;
}

/**
 * (a) 32 × 32, four frames, no trim, the default export settings. Three layers: the drawing;
 * a half-transparent layer over two of the frames, so that the atlas holds blended pixels;
 * and a hidden layer, which must not show. Its tags give a looping animation, one that plays
 * twice and stops (written out as four entries, SPEC §9.3), and a ping-pong.
 */
function walker(): SpriteDoc {
    return spriteDocument({
        name: "Walker",
        width: 32,
        height: 32,
        durations: [100, 50, 150, 80],
        layers: [
            {
                name: "Body",
                cels: [0, 1, 2, 3].map((seed) => drawing(32, 32, seed, [seed, 0, 0, seed])),
            },
            {
                name: "Glow",
                opacity: 160,
                celOpacity: 200,
                cels: [
                    drawing(32, 32, 40, [8, 8, 8, 8]),
                    drawing(32, 32, 41, [0, 20, 16, 0]),
                    null,
                    null,
                ],
            },
            {
                name: "Guide",
                visible: false,
                cels: [drawing(32, 32, 50), null, null, drawing(32, 32, 51)],
            },
        ],
        tags: [
            { name: "Walk", from: 0, to: 2 },
            { name: "Blink", from: 2, to: 3, repeat: 2 },
            { name: "Turn", from: 0, to: 3, direction: "pingpong", repeat: 1 },
        ],
    });
}

/**
 * (b) 33 × 17, an odd size on both axes, with trim and extrude 1. The pivot is the centre,
 * (16.5, 8.5): half a pixel on both axes. Its frames trim to rectangles of every kind: the
 * whole canvas (34 × 18, one pixel past the frame both ways), even and odd content inside
 * the frame, odd content against the right edge, and nothing at all.
 */
function oddBird(): SpriteDoc {
    return spriteDocument({
        name: "Odd Bird",
        width: 33,
        height: 17,
        durations: [60, 60, 120, 60, 200],
        layers: [
            {
                name: "Bird",
                cels: [
                    drawing(33, 17, 10),
                    // Content 30 × 13 from (3, 2): even width, odd height, inside the frame.
                    drawing(33, 17, 11, [3, 2, 0, 2]),
                    // Content 27 × 16 from (6, 1): odd width against the right edge.
                    drawing(33, 17, 12, [6, 1, 0, 0]),
                    // Content 5 × 3 from (1, 1): odd both ways, inside the frame.
                    drawing(33, 17, 13, [1, 1, 27, 13]),
                    null,
                ],
            },
        ],
        tags: [{ name: "Flap", from: 0, to: 3, direction: "reverse" }],
        settings: { trim: true, extrude: 1 },
    });
}

/**
 * (c) Merged duplicate frames: five frames of 9 × 7 that show two images in turn. Frames 0
 * and 2 have equal pixels in images of their own and frame 4 is linked to frame 0; frames 1
 * and 3 likewise. No trim, so every rectangle is 10 × 8, one pixel past the odd frame. It has
 * no tag: its one animation is the loop over all frames (SPEC §9.3). Packed in a row.
 */
function twice(): SpriteDoc {
    const first = () => drawing(9, 7, 20, [1, 0, 0, 0]);
    const second = () => drawing(9, 7, 21, [0, 0, 2, 1]);
    return spriteDocument({
        name: "Twice",
        width: 9,
        height: 7,
        durations: [70, 30, 70, 30, 100],
        layers: [{ name: "Layer 1", cels: [first(), second(), first(), second(), 0] }],
        settings: { layout: "row", padding: 2 },
    });
}

/**
 * (d) Pivot `[0.5, 1]`, the bottom centre, on 32 × 32 with trim. The name starts with a
 * digit, so the identifiers of its module carry the `sprite` prefix (SPEC §9.5). Packed in a
 * column without padding: the rectangle of the full frame and the one below it touch, and a
 * texel taken from beside one would be a texel of the other.
 */
function feet(): SpriteDoc {
    return spriteDocument({
        name: "2d Feet",
        width: 32,
        height: 32,
        durations: [90, 110, 40],
        layers: [
            {
                name: "Layer 1",
                cels: [
                    drawing(32, 32, 30, [4, 6, 4, 0]),
                    drawing(32, 32, 31),
                    drawing(32, 32, 32, [10, 12, 9, 3]),
                ],
            },
        ],
        tags: [{ name: "Idle", from: 0, to: 1, direction: "reverse" }],
        pivot: [0.5, 1],
        settings: { trim: true, layout: "column", padding: 0 },
    });
}

export const FIXTURES: Readonly<Record<FixtureId, Fixture>> = {
    a: {
        id: "a",
        title: "(a) 32 × 32, four frames, no trim",
        name: "walker",
        camel: "walker",
        pascal: "Walker",
        build: walker,
    },
    b: {
        id: "b",
        title: "(b) 33 × 17 with trim and extrude 1",
        name: "odd-bird",
        camel: "oddBird",
        pascal: "OddBird",
        build: oddBird,
    },
    c: {
        id: "c",
        title: "(c) merged duplicate frames",
        name: "twice",
        camel: "twice",
        pascal: "Twice",
        build: twice,
    },
    d: {
        id: "d",
        title: "(d) pivot [0.5, 1]",
        name: "2d-feet",
        camel: "sprite2dFeet",
        pascal: "Sprite2dFeet",
        build: feet,
    },
};

// --- a bundle as bytes ----------------------------------------------------------------------------

/** One file of a bundle: `BundleFile` of `core/export`, declared here to keep that module out. */
export interface FileBytes {
    name: string;
    bytes: Uint8Array;
}

/** Bytes as base64. `btoa` and `atob` exist in the browser and in Node alike. */
export function toBase64(bytes: ArrayLike<number>): string {
    let binary = "";
    for (let index = 0; index < bytes.length; index++) {
        binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
}

export function fromBase64(data: string): Uint8Array {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

/** One file of a bundle as the export page hands it to a spec. */
export interface FileBase64 {
    name: string;
    data: string;
}

/**
 * What tests/e2e/harness/se-053-export.ts puts on `window.__se053Export`: the bundle of a
 * fixture, made by `bundle()` in the page, in the order of SPEC §9.1.
 */
export type ExportHarness = (fixture: FixtureId) => FileBase64[];

declare global {
    interface Window {
        __se053Export?: ExportHarness;
    }
}

const text = (file: FileBytes) => new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);

/** The file of a bundle whose name ends with `ending`. */
export function fileOf(files: readonly FileBytes[], ending: string): FileBytes {
    const file = files.find((candidate) => candidate.name.endsWith(ending));
    if (!file) throw new Error(`The bundle has no file ending in "${ending}".`);
    return file;
}

/** The text of that file. Throws when it is not UTF-8. */
export function textOf(files: readonly FileBytes[], ending: string): string {
    return text(fileOf(files, ending));
}

/**
 * A bundle corrupted on purpose (ticket SE-053, acceptance): the rectangle of its first frame
 * is moved to the last column of the image, so that it reaches outside it. The two files that
 * state the rectangle to a reader are changed alike, `<name>.atlas.json` and
 * `<name>.preview.config.mjs`; the image and the other files are those of the bundle.
 * Returns the new files and the ID of the frame.
 */
export function withRectOutsideImage(
    files: readonly FileBytes[],
    name: string,
): { files: FileBytes[]; frame: string; x: number } {
    const atlasFile = fileOf(files, ".atlas.json");
    const atlas = JSON.parse(text(atlasFile)) as {
        width: number;
        frames: Record<string, { x: number; w: number }>;
    };
    const [frame] = Object.keys(atlas.frames);
    // The narrowest rectangle is 2 wide: from the last column every rectangle leaves the image.
    const x = atlas.width - 1;
    const before = atlas.frames[frame].x;
    atlas.frames[frame].x = x;

    const configFile = fileOf(files, ".preview.config.mjs");
    const config = text(configFile);
    const entry = `{ id: ${JSON.stringify(frame)}, image: ${JSON.stringify(name)}, x: `;
    const at = config.indexOf(`${entry}${before},`);
    if (at === -1 || config.indexOf(entry, at + 1) !== -1) {
        throw new Error(`The preview config does not state frame "${frame}" once.`);
    }
    const start = at + entry.length;
    const changed = config.slice(0, start) + x + config.slice(start + String(before).length);

    const encode = (content: string) => new TextEncoder().encode(content);
    return {
        files: files.map((file) => {
            if (file === atlasFile) {
                return { name: file.name, bytes: encode(`${JSON.stringify(atlas, null, 4)}\n`) };
            }
            return file === configFile ? { name: file.name, bytes: encode(changed) } : file;
        }),
        frame,
        x,
    };
}
