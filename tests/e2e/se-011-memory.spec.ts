import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { harnessSettled, openHarness } from "./se-011-support";

// SE-011: slot memory. NGNE cannot release a manual texture, so a slot nothing uses any more
// is replaced by a 1×1 image (SPEC §6.2 #4, §6.4); `renderer.inspect()` shows the effect.
// The harness page runs an `NgneViewport` without the app, which can show a document with
// no frame on screen: the checker-only baseline.

const MB = 1024 * 1024;
const SIZE = 1024;
const FRAME_BYTES = SIZE * SIZE * 4;
const FRAME_SLOTS = Array.from({ length: 8 }, (_, slot) => `ed:f:${slot}`);

/** `renderer.inspect()` and the frame cache, as far as this spec reads them. */
function inspect(page: Page) {
    return page.evaluate(() => {
        const probe = window.se011!.probe!;
        const inspection = probe.inspect()!;
        return {
            /** NGNE's estimate over every texture of the renderer. */
            textureBytes: inspection.estimatedTextureBytes,
            /** Bytes of the image each slot holds, by slot id. */
            slotBytes: Object.fromEntries(
                inspection.entries.map((entry) => [entry.id, entry.estimatedSourceBytes]),
            ),
            /** The frame key each cache slot shows. */
            shown: [...probe.slots],
        };
    });
}

/** Bytes held by the frame cache slots `ed:f:0..7`; a slot never uploaded holds none. */
function frameCacheBytes(slotBytes: Record<string, number>): number[] {
    return FRAME_SLOTS.map((slot) => slotBytes[slot] ?? 0);
}

test("after filling and clearing the frame cache, texture bytes are within 1 MB of the checker-only baseline", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openHarness(page);

    // A 1024×1024 document with nine frames and none on show: the checkerboard alone.
    await page.evaluate((size) => window.se011!.open(size, 9), SIZE);
    await harnessSettled(page);
    const baseline = await inspect(page);
    expect(baseline.slotBytes["ed:checker"]).toBe(FRAME_BYTES);
    expect(frameCacheBytes(baseline.slotBytes)).toEqual(FRAME_SLOTS.map(() => 0));
    expect(baseline.shown).toEqual(FRAME_SLOTS.map(() => null));

    // Nine frames through eight slots: the cache is full, the first frame was given up.
    for (let index = 0; index < 9; index++) {
        await page.evaluate((index) => window.se011!.show(index), index);
        await harnessSettled(page);
    }
    const filled = await inspect(page);
    expect(frameCacheBytes(filled.slotBytes)).toEqual(FRAME_SLOTS.map(() => FRAME_BYTES));
    // The estimate of the whole renderer saw them: the comparison below is not vacuous.
    expect(filled.textureBytes - baseline.textureBytes).toBeGreaterThanOrEqual(8 * FRAME_BYTES);
    expect([...filled.shown].sort()).toEqual(
        Array.from({ length: 8 }, (_, index) => `frame-${index + 1}:plain`).sort(),
    );

    // Cleared: every slot holds the 1×1 image, and the estimate is back at the baseline.
    await page.evaluate(() => {
        window.se011!.show(null);
        window.se011!.clearFrames();
    });
    await harnessSettled(page);
    const cleared = await inspect(page);
    expect(cleared.shown).toEqual(FRAME_SLOTS.map(() => null));
    expect(Math.abs(cleared.textureBytes - baseline.textureBytes)).toBeLessThanOrEqual(MB);
    // Slot by slot: each frame slot holds the placeholder of four bytes, the checkerboard
    // its image.
    expect(frameCacheBytes(cleared.slotBytes)).toEqual(FRAME_SLOTS.map(() => 4));
    expect(cleared.slotBytes["ed:checker"]).toBe(FRAME_BYTES);

    // A slot that held the placeholder takes a frame again.
    await page.evaluate(() => window.se011!.show(3));
    await harnessSettled(page);
    const reused = await inspect(page);
    expect(reused.shown.filter((key) => key !== null)).toEqual(["frame-3:plain"]);
    expect(frameCacheBytes(reused.slotBytes).sort()).toEqual(
        [4, 4, 4, 4, 4, 4, 4, FRAME_BYTES].sort(),
    );
    const image = await page.evaluate(() => {
        const read = window.se011!.probe!.readCanvas()!;
        // The document is drawn 1:1 at the origin: a texel of frame 3.
        return [...read.data.slice(0, 4)];
    });
    expect(image).toEqual([60, 255, 255, 255]);

    expect(await page.evaluate(() => window.se011!.errors)).toEqual([]);
    expect(errors).toEqual([]);
});
