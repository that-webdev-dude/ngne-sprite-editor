import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its type.
import type * as AppViewportLink from "../../src/app/viewport/viewportLink";
import { collectErrors } from "./se-006-support";
import {
    checkerAt,
    DARK,
    DARK_CHECKER,
    documentRect,
    openDocument,
    openViewportEditor,
    paint,
    readback,
    settle,
    solid,
} from "./se-011-support";
import type { Crop, Rgb, Rgba } from "./se-011-support";
import {
    addReference,
    changeReference,
    deleteLayer,
    historyState,
    over,
    patchTexel,
    referenceLayers,
    setOpacity,
} from "./se-045-support";

// SE-045: reference layers on the canvas (SPEC §7.6, §6.4). A reference image is decoded, fitted
// and centred, drawn by NGNE behind the pixel layers at 50% opacity (quad layer 2) or in front
// (6), resampled on the CPU to its size on screen. Read back from the canvas (SPEC §6.7).

/** The colour of a device pixel of a crop. */
function at(crop: Crop, x: number, y: number): number[] {
    const from = (y * crop.width + x) * 4;
    return crop.data.slice(from, from + 4);
}

/**
 * Device pixels of a crop of the document rectangle at an integer `scale` whose colour is not
 * within `tolerance` of `expected(texelX, texelY)`. Returns the first few.
 */
function mismatches(
    crop: Crop,
    scale: number,
    tolerance: number,
    expected: (tx: number, ty: number) => readonly number[],
): string[] {
    const wrong: string[] = [];
    for (let y = 0; y < crop.height && wrong.length < 5; y++) {
        for (let x = 0; x < crop.width && wrong.length < 5; x++) {
            const tx = Math.floor(x / scale);
            const ty = Math.floor(y / scale);
            const want = expected(tx, ty);
            const got = at(crop, x, y);
            const same =
                got[3] === 255 &&
                [0, 1, 2].every((c) => Math.abs((got[c] ?? -99) - (want[c] ?? 0)) <= tolerance);
            if (!same)
                wrong.push(`${x},${y} (texel ${tx},${ty}): ${got} not ${want.map(Math.round)}`);
        }
    }
    return wrong;
}

const RED: Rgba = [200, 40, 40, 255];
const BLUE: Rgba = [20, 60, 230, 255];

async function open(page: Page, width: number, height: number, scale: number) {
    await openViewportEditor(page);
    const view = { scale, originX: 12, originY: 10 };
    const document = await openDocument(page, { width, height }, view);
    await settle(page);
    return { document, view };
}

test("a reference renders behind the pixel layers at 50% opacity, fitted and centred; patched pixels lie above it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    // 16 × 8 canvas, 8 × 8 image: fitted at scale 1, centred from x = 4 to 12.
    const { document, view } = await open(page, 16, 8, 4);
    const before = await historyState(page);
    const id = await addReference(page, { kind: "flat", width: 8, height: 8, rgba: RED });
    expect(id).not.toBeNull();
    const [layer] = await referenceLayers(page);
    expect(layer).toMatchObject({ id, opacity: 128, placement: "behind", x: 4, y: 0, scale: 1 });
    // One step, which adds one layer.
    expect(await historyState(page)).toEqual({ undo: before.undo + 1, layers: before.layers + 1 });

    await settle(page);
    const half = 128 / 255;
    const covered = (tx: number) => tx >= 4 && tx < 12;
    const expected = (tx: number, ty: number) => {
        const under = checkerAt(DARK_CHECKER, tx, ty);
        return covered(tx) ? over(RED, half, under) : under;
    };
    const rect = documentRect(document, view);
    const first = await readback(page, rect);
    // Within 2 per channel of the blend over the checkerboard (SE-045 acceptance).
    expect(mismatches(first.crop, view.scale, 2, expected)).toEqual([]);
    expect(first.outside).toBe(0);

    // A pixel layer's pixels, committed through a patch command, lie above the reference.
    await paint(
        page,
        document.id,
        solid(16, 8, [0, 0, 0, 0]).map((v, i) => (i === 3 ? 255 : v)),
    );
    await patchTexel(page, { x: 6, y: 3 }, BLUE);
    await settle(page);
    const second = await readback(page, rect);
    const withPixels = (tx: number, ty: number) => {
        if (tx === 6 && ty === 3) return BLUE;
        if (tx === 0 && ty === 0) return [0, 0, 0];
        return expected(tx, ty);
    };
    expect(mismatches(second.crop, view.scale, 2, withPixels)).toEqual([]);

    // Undo of the patch, the paint and the reference: the checkerboard alone again.
    await page.evaluate(() => {
        const undo = window.__ngneTest!.commands.get("edit.undo")!;
        for (let step = 0; step < 3; step++) void undo.run();
    });
    expect(await referenceLayers(page)).toEqual([]);
    await settle(page);
    const third = await readback(page, rect);
    expect(
        mismatches(third.crop, view.scale, 0, (tx, ty) => checkerAt(DARK_CHECKER, tx, ty)),
    ).toEqual([]);
    expect(errors).toEqual([]);
});

test("a reference placed in front draws over the pixel layers", async ({ page }) => {
    const errors = collectErrors(page);
    const { document, view } = await open(page, 8, 8, 4);
    await paint(page, document.id, solid(8, 8, BLUE));
    const id = await addReference(page, { kind: "flat", width: 4, height: 4, rgba: RED });
    await changeReference(page, id!, { placement: "front" });
    await settle(page);
    const { crop } = await readback(page, documentRect(document, view));
    const half = 128 / 255;
    expect(
        mismatches(crop, view.scale, 2, () => over(RED, half, BLUE.slice(0, 3) as unknown as Rgb)),
    ).toEqual([]);
    expect(errors).toEqual([]);
});

test("a 50%-alpha flat reference over the checkerboard is within 2 of the expected blend", async ({
    page,
}) => {
    const errors = collectErrors(page);
    // The reference's own alpha is 50% and the layer is opaque: the same blend by another path.
    const { document, view } = await open(page, 24, 16, 3);
    const id = await addReference(page, {
        kind: "flat",
        width: 24,
        height: 16,
        rgba: [30, 200, 120, 128],
    });
    await setOpacity(page, id!, 255);
    await settle(page);
    const { crop } = await readback(page, documentRect(document, view));
    expect(
        mismatches(crop, view.scale, 2, (tx, ty) =>
            over([30, 200, 120], 128 / 255, checkerAt(DARK_CHECKER, tx, ty)),
        ),
    ).toEqual([]);
    expect(errors).toEqual([]);
});

test("a 2048 × 2048 gradient fitted to a 64 × 64 canvas at scale 4 is within 4/255 of a box-filter downscale", async ({
    page,
}) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    const { document, view } = await open(page, 64, 64, 4);
    const id = await addReference(page, { kind: "gradient", width: 2048, height: 2048 });
    await setOpacity(page, id!, 255);
    await settle(page);
    const rect = documentRect(document, view);
    const error = await page.evaluate((rect) => {
        const image = window.__ngneTest!.viewport!.readCanvas()!;
        const side = 2048;
        const block = side / rect.width; // source pixels per device pixel: 8
        const value = (channel: number, x: number, y: number) =>
            channel === 0
                ? Math.round((x * 255) / (side - 1))
                : channel === 1
                  ? Math.round((y * 255) / (side - 1))
                  : Math.round(((x + y) * 255) / (2 * side - 2));
        const sums = [0, 0, 0];
        for (let dy = 0; dy < rect.height; dy++) {
            for (let dx = 0; dx < rect.width; dx++) {
                const from = ((rect.y + dy) * image.width + rect.x + dx) * 4;
                for (let channel = 0; channel < 3; channel++) {
                    // The box filter: the mean of the source block under the device pixel.
                    let total = 0;
                    for (let sy = 0; sy < block; sy++) {
                        for (let sx = 0; sx < block; sx++) {
                            total += value(channel, dx * block + sx, dy * block + sy);
                        }
                    }
                    const expected = total / (block * block);
                    sums[channel]! += Math.abs((image.data[from + channel] ?? 0) - expected);
                }
            }
        }
        return sums.map((sum) => sum / (rect.width * rect.height));
    }, rect);
    for (const channel of error) expect(channel).toBeLessThanOrEqual(4);
    // The slot holds the image at its size on screen, not the source's.
    const slots = await page.evaluate(() => window.__ngneTest!.viewport!.references);
    expect(slots.filter((slot) => slot !== null)).toEqual([
        { layerId: id, width: rect.width, height: rect.height },
    ]);
    expect(errors).toEqual([]);
});

test("after deleting every reference layer, texture bytes are within 1 MB of the baseline", async ({
    page,
}) => {
    const errors = collectErrors(page);
    // 128 × 128 at scale 4: each reference is 512 × 512 on screen, 1 MiB in its slot.
    await open(page, 128, 128, 4);
    const bytes = () =>
        page.evaluate(() => window.__ngneTest!.viewport!.inspect()!.estimatedTextureBytes);
    const baseline = await bytes();
    const ids: string[] = [];
    for (let index = 0; index < 4; index++) {
        const id = await addReference(page, {
            kind: "flat",
            width: 1024,
            height: 1024,
            rgba: [index * 60, 100, 200, 255],
        });
        ids.push(id!);
    }
    await settle(page);
    const MB = 1024 * 1024;
    // The four slots hold their images: the comparison below is not vacuous.
    expect((await bytes()) - baseline).toBeGreaterThanOrEqual(4 * MB);
    for (const id of ids) await deleteLayer(page, id);
    await settle(page);
    expect(Math.abs((await bytes()) - baseline)).toBeLessThanOrEqual(MB);
    expect(
        (await page.evaluate(() => window.__ngneTest!.viewport!.references)).every(
            (slot) => slot === null,
        ),
    ).toBe(true);
    expect(errors).toEqual([]);
});

test("zooming through every step within a second logs no texture diagnostic and every frame shows the document", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await open(page, 64, 64, 4);
    await addReference(page, { kind: "gradient", width: 512, height: 512 });
    const front = await addReference(page, { kind: "flat", width: 64, height: 32, rgba: RED });
    await changeReference(page, front!, { placement: "front" });
    await settle(page);
    const result = await page.evaluate(async () => {
        const linkPath = "/src/app/viewport/viewportLink.ts";
        const { viewportLink } = (await import(
            /* @vite-ignore */ linkPath
        )) as typeof AppViewportLink;
        const commands = window.__ngneTest!.commands;
        const frames: (string | null)[] = [];
        const stop = viewportLink.onDrawn((frame) => frames.push(frame?.key ?? null));
        while (commands.get("view.zoomOut")!.enabled()) void commands.get("view.zoomOut")!.run();
        const start = performance.now();
        const scales: number[] = [];
        // One step every 30 ms on a fixed schedule: the whole range well within a second.
        for (let step = 1; commands.get("view.zoomIn")!.enabled(); step++) {
            void commands.get("view.zoomIn")!.run();
            const state = window.__ngneTest!.sessions.getState();
            scales.push(state.documents.find((entry) => entry.id === state.activeId)!.view.scale);
            const wait = start + step * 30 - performance.now();
            await new Promise((resolve) => setTimeout(resolve, Math.max(0, wait)));
        }
        const elapsed = performance.now() - start;
        await new Promise((resolve) => setTimeout(resolve, 400));
        stop();
        return { frames, elapsed, scales };
    });
    expect(result.elapsed).toBeLessThan(1000);
    // Every step, from the smallest to the largest.
    expect(result.scales.length).toBeGreaterThanOrEqual(17);
    expect(result.frames.length).toBeGreaterThan(0);
    expect(result.frames.filter((key) => key === null)).toEqual([]);
    await settle(page);
    expect(errors.filter((line) => /not ready/i.test(line))).toEqual([]);
    expect(errors).toEqual([]);
});

test("the workspace colour stays outside the document", async ({ page }) => {
    // A reference larger than the canvas is clipped to the document rectangle.
    const errors = collectErrors(page);
    const { document, view } = await open(page, 16, 16, 4);
    const id = await addReference(page, { kind: "flat", width: 16, height: 16, rgba: RED });
    await changeReference(page, id!, { x: -8, y: -8, scale: 3 });
    await settle(page);
    const result = await readback(page, documentRect(document, view), DARK.workspace);
    expect(result.outside).toBe(0);
    expect(errors).toEqual([]);
});
