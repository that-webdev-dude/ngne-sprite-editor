import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
// Declares `window.se011`, the harness page's handle on its viewport.
import type {} from "./harness/se-011-viewport";

// SE-011: slot memory. NGNE cannot release a manual texture, so a slot nothing uses any more
// is replaced by a 1×1 image (SPEC §6.2 #4, §6.4); `renderer.inspect()` shows the effect.
// The harness page runs an `NgneViewport` without the app, which can show a document with
// no frame on screen: the checker-only baseline.

const MB = 1024 * 1024;
const SIZE = 1024;
const FRAME_BYTES = SIZE * SIZE * 4;

async function settled(page: Page): Promise<void> {
    await page.waitForFunction(() => window.se011?.probe.settled === true, undefined, {
        polling: 50,
    });
}

function inspect(page: Page) {
    return page.evaluate(() => {
        const inspection = window.se011!.probe.inspect()!;
        return {
            textures: inspection.textures,
            textureBytes: inspection.estimatedTextureBytes,
            sourceBytes: inspection.estimatedSourceBytes,
            slots: [...window.se011!.probe.slots],
            ids: inspection.entries.map((entry) => entry.id).sort(),
        };
    });
}

test("after filling and clearing the frame cache, texture bytes are within 1 MB of the checker-only baseline", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.goto("/tests/e2e/harness/se-011-viewport.html");
    await page.waitForFunction(() => window.se011 !== undefined);

    // A 1024×1024 document with nine frames and none on show: the checkerboard alone.
    await page.evaluate((size) => window.se011!.open(size, 9), SIZE);
    await settled(page);
    const baseline = await inspect(page);
    expect(baseline.ids).toEqual(["ed:checker"]);
    // NGNE's own 1×1 white texture, and the checkerboard at document resolution.
    expect(baseline.textureBytes).toBe(4 + FRAME_BYTES);
    expect(baseline.slots).toEqual(Array.from({ length: 8 }, () => null));

    // Nine frames through eight slots: the cache is full, the first frame was given up.
    for (let index = 0; index < 9; index++) {
        await page.evaluate((index) => window.se011!.show(index), index);
        await settled(page);
    }
    const filled = await inspect(page);
    expect(filled.ids).toEqual(
        ["ed:checker", ...Array.from({ length: 8 }, (_, slot) => `ed:f:${slot}`)].sort(),
    );
    expect(filled.textureBytes).toBe(baseline.textureBytes + 8 * FRAME_BYTES);
    expect([...filled.slots].sort()).toEqual(
        Array.from({ length: 8 }, (_, index) => `frame-${index + 1}:plain`).sort(),
    );

    // Cleared: every slot holds the placeholder, and the estimate is back at the baseline.
    await page.evaluate(() => {
        window.se011!.show(null);
        window.se011!.clearFrames();
    });
    await settled(page);
    const cleared = await inspect(page);
    expect(cleared.slots).toEqual(Array.from({ length: 8 }, () => null));
    expect(Math.abs(cleared.textureBytes - baseline.textureBytes)).toBeLessThanOrEqual(MB);
    expect(cleared.textureBytes).toBe(baseline.textureBytes + 8 * 4);
    // NGNE also keeps a bitmap copy per slot: those are 1×1 now as well.
    expect(cleared.sourceBytes).toBe(baseline.sourceBytes + 8 * 4);

    // A slot that held the placeholder takes a frame again.
    await page.evaluate(() => window.se011!.show(3));
    await settled(page);
    const reused = await inspect(page);
    expect(reused.textureBytes).toBe(cleared.textureBytes + FRAME_BYTES - 4);
    expect(reused.slots.filter((key) => key !== null)).toEqual(["frame-3:plain"]);
    const image = await page.evaluate(() => {
        const read = window.se011!.probe.readCanvas()!;
        // The document is drawn 1:1 at the origin: a texel of frame 3 and the workspace.
        return [...read.data.slice(0, 4)];
    });
    expect(image).toEqual([60, 255, 255, 255]);

    expect(await page.evaluate(() => window.se011!.errors)).toEqual([]);
    expect(errors).toEqual([]);
});
