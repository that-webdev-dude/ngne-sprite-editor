// Scene layouts shared by a page and the runner, which compares screenshots with the same
// expected pattern the page uses for in-page readback. Pure TypeScript.
import { makeDoc, type Doc, type Placement } from "./pattern.ts";

// ---- Question 4 -----------------------------------------------------------------------------

export const Q4_CLEAR = 0x202830;
/** Backing sizes the viewport cycles through in 4(a); all contain `Q4_REGION`. */
export const Q4_SIZES: readonly (readonly [number, number])[] = [
    [1280, 720],
    [1024, 640],
    [1600, 900],
    [900, 700],
    [1366, 768],
];
/** The part of the viewport every size shows; screenshots are compared over it. */
export const Q4_REGION = { width: 900, height: 640 } as const;

export interface Q4Docs {
    readonly checker: Doc;
    readonly current: Doc;
    readonly side: Doc;
    readonly marker: Doc;
}

export function q4Docs(): Q4Docs {
    const current = makeDoc(256, 256, 2);
    // The right half of the current frame is transparent, so the checker slot shows through.
    for (let y = 0; y < 256; y++) current.pixels.fill(0, (y * 256 + 128) * 4, (y + 1) * 256 * 4);
    return {
        checker: makeDoc(256, 256, 1),
        current,
        side: makeDoc(128, 128, 3),
        marker: makeDoc(16, 16, 4),
    };
}

/** Slot of each document of the question 4 scene. */
export const Q4_SLOTS = {
    checker: "ed:checker",
    current: "ed:f:0",
    side: "ed:f:1",
    marker: "ed:f:2",
} as const;

/**
 * Quads in draw order. With `viewport` (4b) a marker is anchored 8 px inside the viewport's
 * bottom-right corner, so a resize changes the frame.
 */
export function q4Placements(
    docs: Q4Docs,
    viewport?: { readonly width: number; readonly height: number },
): { slot: string; placement: Placement }[] {
    const list: { slot: string; placement: Placement }[] = [
        { slot: Q4_SLOTS.checker, placement: { doc: docs.checker, x: 40, y: 30, scale: 2 } },
        { slot: Q4_SLOTS.current, placement: { doc: docs.current, x: 40, y: 30, scale: 2 } },
        { slot: Q4_SLOTS.side, placement: { doc: docs.side, x: 600, y: 30, scale: 2 } },
    ];
    if (viewport)
        list.push({
            slot: Q4_SLOTS.marker,
            placement: {
                doc: docs.marker,
                x: viewport.width - 16 - 8,
                y: viewport.height - 16 - 8,
                scale: 1,
            },
        });
    return list;
}

// ---- Question 7 -----------------------------------------------------------------------------

export const Q7_CLEAR = 0x182430;
/** The preview background is a rect (SPEC §6.5); it covers the whole logical canvas. */
export const Q7_GAME_BG = 0x283848;
/** Bare renderer canvas: backing size divisible by 3, so it is whole CSS pixels at DPR 1.5. */
export const Q7_BARE = { width: 96, height: 66 } as const;
/** Preview canvas: logical size, shown at `k` device pixels per logical pixel (SPEC §6.5). */
export const Q7_GAME = { width: 48, height: 36, k: 3 } as const;

export function q7BarePlacements(): Placement[] {
    return [{ doc: makeDoc(30, 20, 7), x: 3, y: 3, scale: 3 }];
}

/** In logical pixels; multiply by `scale` for the screenshot of the upscaled canvas. */
export function q7GamePlacements(scale = 1): Placement[] {
    return [{ doc: makeDoc(16, 12, 8), x: 4 * scale, y: 6 * scale, scale: 2 * scale }];
}

// ---- Question 8 -----------------------------------------------------------------------------

export const Q8_CLEAR = 0x241c30;
export const Q8_CANVAS = { width: 256, height: 192 } as const;

export function q8Placements(): { slot: string; placement: Placement }[] {
    return [
        { slot: "ed:checker", placement: { doc: makeDoc(64, 64, 11), x: 16, y: 16, scale: 2 } },
        { slot: "ed:f:0", placement: { doc: makeDoc(32, 32, 12), x: 160, y: 16, scale: 2 } },
        { slot: "ed:f:1", placement: { doc: makeDoc(33, 17, 13), x: 160, y: 96, scale: 2 } },
    ];
}
