import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import {
    checkerAt,
    compare,
    DARK_CHECKER,
    documentRect,
    openDocument,
    openViewportEditor,
    paint,
    readback,
    settle,
} from "./se-011-support";
import type { Mismatch } from "./se-011-support";
import { collapsePreview } from "./se-054-support";

// The pixel contract for translucent texels (SPEC §6.7, SE-011): a texel with alpha 1–254 is
// shown blended over the checkerboard within ±1 per channel. NGNE 0.3.0's `updateTexture`
// captures its source through the browser's 2D readback, whose premultiplied storage loses
// precision at low alpha; this spec checks every alpha and every value of a channel through
// the viewport, both as a whole image and as a region sent into a texture that holds an
// image already. It is the gate of the editable frame slots (migration to 0.3.0).

const WIDTH = 256;
const HEIGHT = 254;
const VIEW = { scale: 1, originX: 4, originY: 4 };

/**
 * Every value of each channel at every alpha 1–254: the column is the red value, the row the
 * alpha less one; green and blue run other ways so the three channels differ.
 */
function translucent(): number[] {
    const pixels: number[] = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            pixels.push(x, 255 - x, (x * 7 + y * 3) & 255, y + 1);
        }
    }
    return pixels;
}

/** An opaque image the translucent one replaces in part. */
function opaque(): number[] {
    const pixels: number[] = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) pixels.push((x * 3) & 255, (y * 5) & 255, 90, 255);
    }
    return pixels;
}

/** `base` with the rectangle `rect` taken from `over`. */
function patched(
    base: readonly number[],
    over: readonly number[],
    rect: { x: number; y: number; width: number; height: number },
): number[] {
    const pixels = [...base];
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
            const at = (y * WIDTH + x) * 4;
            for (let channel = 0; channel < 4; channel++)
                pixels[at + channel] = over[at + channel]!;
        }
    }
    return pixels;
}

/**
 * The mismatches of the document rectangle against `pixels`, and the worst error of any
 * translucent texel shown (mismatched or not), against its exact blend over the checkerboard.
 */
async function check(page: Page, pixels: readonly number[]) {
    const result = await readback(page, documentRect({ width: WIDTH, height: HEIGHT }, VIEW));
    const mismatches: Mismatch[] = compare(result.crop, pixels, WIDTH, VIEW.scale);
    const { crop } = result;
    let worst = 0;
    for (let y = 0; y < crop.height; y++) {
        for (let x = 0; x < crop.width; x++) {
            const at = (y * WIDTH + x) * 4;
            const alpha = pixels[at + 3] ?? 0;
            if (alpha === 0 || alpha === 255) continue;
            const under = checkerAt(DARK_CHECKER, x, y);
            for (let channel = 0; channel < 3; channel++) {
                const exact =
                    ((pixels[at + channel] ?? 0) * alpha + (under[channel] ?? 0) * (255 - alpha)) /
                    255;
                const shown = crop.data[(y * crop.width + x) * 4 + channel] ?? 0;
                worst = Math.max(worst, Math.abs(shown - exact));
            }
        }
    }
    return { mismatches, worst: Math.round(worst * 1000) / 1000, outside: result.outside };
}

test("every translucent value is shown within ±1 of its blend, sent whole and as a region", async ({
    page,
}, testInfo) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    await collapsePreview(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    const image = translucent();

    // The whole image: the first upload of the frame.
    await paint(page, document.id, image);
    await settle(page);
    const whole = await check(page, image);
    testInfo.annotations.push({
        type: "translucency (whole)",
        description: `${whole.mismatches.length} device pixels beyond ±1, worst ${whole.worst}`,
    });

    // A region: the frame holds an opaque image, and a part of it becomes translucent.
    const base = opaque();
    await paint(page, document.id, base);
    await settle(page);
    const region = { x: 16, y: 8, width: 200, height: 230 };
    const mixed = patched(base, image, region);
    await paint(page, document.id, mixed);
    await settle(page);
    const part = await check(page, mixed);
    testInfo.annotations.push({
        type: "translucency (region)",
        description: `${part.mismatches.length} device pixels beyond ±1, worst ${part.worst}`,
    });

    expect(whole.mismatches.slice(0, 5)).toEqual([]);
    expect(whole.outside).toBe(0);
    expect(part.mismatches.slice(0, 5)).toEqual([]);
    expect(part.outside).toBe(0);
    expect(errors).toEqual([]);
});
