import { celKey, defaultDocSettings, defaultExportSettings } from "../../src/core/model";
import type { PixelBuffer, SpriteDoc, Tag } from "../../src/core/model";

// SE-063: the documents the GIF tests export, built in code. Plain TypeScript without DOM or
// Node APIs: the unit tests build them in Node, the E2E specs in the page (imported from the
// dev server), as SE-053's fixtures are.

/** An image whose pixel at (x, y) is `pixel(x, y)`: [r, g, b, a]. */
function image(
    width: number,
    height: number,
    pixel: (x: number, y: number) => readonly [number, number, number, number],
): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
    }
    return { width, height, data };
}

interface TagSpec {
    name: string;
    from: number;
    to: number;
    direction: Tag["direction"];
    repeat: number;
}

/** A document of one layer whose cel of frame i is `cels[i]` (null: empty). */
function document(
    name: string,
    width: number,
    height: number,
    durations: readonly number[],
    cels: readonly (PixelBuffer | null)[],
    tags: readonly TagSpec[] = [],
): SpriteDoc {
    const doc: SpriteDoc = {
        id: `doc-${name}`,
        name,
        width,
        height,
        colorMode: "rgba",
        layers: [
            {
                id: "layer-0",
                name: "Layer 1",
                kind: "pixel",
                visible: true,
                locked: false,
                opacity: 255,
                blend: "normal",
            },
        ],
        frames: durations.map((durationMs, index) => ({ id: `frame-${index}`, durationMs })),
        cels: new Map(),
        images: new Map(),
        tags: tags.map((tag, index) => ({
            id: `tag-${index}`,
            name: tag.name,
            color: 0x3cb371ff,
            fromFrameId: `frame-${tag.from}`,
            toFrameId: `frame-${tag.to}`,
            direction: tag.direction,
            repeat: tag.repeat,
        })),
        palette: { name: "Test", colors: [] },
        pivot: { x: 0.5, y: 0.5 },
        settings: defaultDocSettings(width, height),
        exportSettings: defaultExportSettings(),
    };
    cels.forEach((cel, index) => {
        if (!cel) return;
        doc.images.set(`image-${index}`, cel);
        doc.cels.set(celKey("layer-0", `frame-${index}`), {
            imageId: `image-${index}`,
            opacity: 255,
        });
    });
    return doc;
}

/** Durations of the four frames of `fourFrames`, in ms. */
export const FOUR_FRAME_DURATIONS = [100, 4, 155, 84] as const;
/** The delays a GIF writes for them: rounded to 10 ms, at least 20 ms. */
export const FOUR_FRAME_DELAYS = [100, 20, 160, 80] as const;

/**
 * 16 × 16, four frames of at most 256 colours each, which a GIF holds exactly:
 * - 0: 256 different opaque colours, no transparent pixel;
 * - 1: 255 different colours and one transparent pixel;
 * - 2: six colours, with alpha 127 (transparent in the GIF), 128 and 200 (shown opaque) and 0;
 * - 3: empty (every pixel transparent).
 * Its tags: "Bounce", a ping-pong over all four looping without end; "Twice", frames 2–3
 * forward, played twice; "Back", frames 1–3 in reverse, played once.
 */
export function fourFrames(): SpriteDoc {
    const all = image(16, 16, (x, y) => [x * 16 + 3, y * 16 + 5, (x * 7 + y * 11) % 256, 255]);
    const holed = image(16, 16, (x, y) =>
        x === 5 && y === 9 ? [0, 0, 0, 0] : [255 - x * 16, (x * 13 + y * 3) % 256, y * 16, 255],
    );
    const few = image(16, 16, (x, y) => {
        const band = (x + y) % 6;
        if (band === 0) return [10, 200, 30, 127];
        if (band === 1) return [250, 20, 90, 128];
        if (band === 2) return [40, 40, 220, 200];
        if (band === 3) return [0, 0, 0, 0];
        if (band === 4) return [255, 255, 255, 255];
        return [0, 0, 0, 255];
    });
    return document(
        "Four Frames",
        16,
        16,
        FOUR_FRAME_DURATIONS,
        [all, holed, few, null],
        [
            { name: "Bounce", from: 0, to: 3, direction: "pingpong", repeat: 0 },
            { name: "Twice", from: 2, to: 3, direction: "forward", repeat: 2 },
            { name: "Back", from: 1, to: 3, direction: "reverse", repeat: 1 },
        ],
    );
}

/**
 * 24 × 24, three frames of 100 ms: frame 1 has 576 different opaque colours, more than a GIF
 * frame holds; frames 0 and 2 have two each. Its tag "Swing" is a ping-pong over the three,
 * which shows frame 1 twice (0 1 2 1).
 */
export function manyColours(): SpriteDoc {
    const many = image(24, 24, (x, y) => [x * 10, y * 10, (x * 24 + y) % 256, 255]);
    const two = image(24, 24, (x) => (x < 12 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
    const other = image(24, 24, (_, y) => (y < 12 ? [0, 160, 0, 255] : [240, 220, 0, 255]));
    return document(
        "Many Colours",
        24,
        24,
        [100, 100, 100],
        [two, many, other],
        [{ name: "Swing", from: 0, to: 2, direction: "pingpong", repeat: 0 }],
    );
}
