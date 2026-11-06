import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import {
    expectImage,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    settle,
    solid,
} from "./se-011-support";
import { geometry } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { historyOf, texelClient } from "./se-014-support";
import { celBytes, setColours, setToolOptions } from "./se-015-support";
import { collapsePreview } from "./se-054-support";

// The viewport's upload paths under the NGNE 0.3.0 lifecycle (SPEC §6.4): edits made while an
// upload waits, slot IDs released and used again while their upload is under way, a fast
// stroke against NGNE's pending work, transparent pixels over opaque ones, and a device lost
// in the middle of a stroke. Frame slots are replaced whole with `texture()`: NGNE 0.3.0's
// `updateTexture` does not keep translucent pixels within the ±1 contract under software 2D
// readback (se-011-translucency).

const plain = (frameId: string) => `${frameId}:plain`;
const VIEW: View = { scale: 8, originX: 64, originY: 40 };

/** Counters of the viewport and of the GPU queue's image copies. */
function uploads(page: Page) {
    return page.evaluate(() => ({
        calls: window.__ngneTest!.viewport!.textureCalls,
        copies: window.__se011.copies(),
    }));
}

/** The IDs NGNE holds a registration for on the viewport's renderer. */
function registered(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        (window.__ngneTest!.viewport!.inspect()?.entries ?? []).map((entry) => entry.id).sort(),
    );
}

/** Moves the mouse onto the centre of each texel in turn (one move each). */
async function moveOver(page: Page, texels: readonly Point[]): Promise<void> {
    const layout = await geometry(page);
    for (const texel of texels) {
        const client = texelClient(layout, VIEW, texel);
        await page.mouse.move(client.x, client.y);
    }
}

test("edits made while a frame's upload waits are sent as the newest pixels, in at most two uploads", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    await collapsePreview(page);
    const view = { scale: 4, originX: 12, originY: 20 };
    const document = await openDocument(page, { width: 8, height: 8 }, view);
    await paint(page, document.id, pattern(8, 8, 1));
    await settle(page);
    const before = await uploads(page);

    // The first edit's upload starts and waits; the nineteen after it replace one another.
    await page.evaluate(() => window.__se011.closeUploadGate());
    for (let seed = 2; seed <= 20; seed++) await paint(page, document.id, pattern(8, 8, seed));
    expect(await uploads(page)).toEqual(before);
    await page.evaluate(() => window.__se011.openUploadGate());
    await settle(page);

    // The waiting upload reads the pixels when it goes on, so both carry the newest image.
    const after = await uploads(page);
    expect(after.calls - before.calls).toBeGreaterThanOrEqual(1);
    expect(after.calls - before.calls).toBeLessThanOrEqual(2);
    expect(after.copies - before.copies).toBe(after.calls - before.calls);
    await expectImage(page, document, view, pattern(8, 8, 20));
    expect(errors).toEqual([]);
});

test("slot IDs released and used again by tab switches while their uploads wait show only the last document", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    await collapsePreview(page);
    const viewA = { scale: 4, originX: 12, originY: 20 };
    const viewB = { scale: 2, originX: 100, originY: 60 };
    const a = await openDocument(page, { name: "a", width: 8, height: 8 }, viewA);
    await paint(page, a.id, pattern(8, 8, 6));
    await settle(page);
    const b = await openDocument(page, { name: "b", width: 12, height: 5 }, viewB);
    await paint(page, b.id, pattern(12, 5, 7));
    await settle(page);
    const before = await uploads(page);
    const activate = (id: string) =>
        page.evaluate((id) => window.__ngneTest!.sessions.getState().activate(id), id);

    // Every switch releases the frame slots and the next document takes `ed:f:0` again while
    // the upload of the one before still waits; edits land on both documents meanwhile.
    await page.evaluate(() => window.__se011.closeUploadGate());
    await activate(a.id);
    await paint(page, a.id, pattern(8, 8, 8));
    await activate(b.id);
    await activate(a.id);
    await activate(b.id);
    const imageB = pattern(12, 5, 9);
    await paint(page, b.id, imageB);
    expect(await uploads(page)).toEqual(before);
    await page.evaluate(() => window.__se011.openUploadGate());
    await settle(page);

    await expectImage(page, b, viewB, imageB);
    // A released upload never reaches NGNE: at most the checkerboard and the frame, each
    // started once while waiting and once for the newest request.
    const after = await uploads(page);
    expect(after.calls - before.calls).toBeGreaterThanOrEqual(2);
    expect(after.calls - before.calls).toBeLessThanOrEqual(4);
    const slots = await page.evaluate(() => window.__ngneTest!.viewport!.slots);
    expect(slots.filter((key) => key !== null)).toEqual([plain(b.frameId)]);
    // NGNE holds the checkerboard and that one frame slot, nothing of the document left.
    const slot = slots.indexOf(plain(b.frameId));
    expect(await registered(page)).toEqual(["ed:checker", `ed:f:${slot}`]);
    expect(await page.evaluate(() => window.__ngneTest!.viewport!.liveRenderers)).toBe(1);
    expect(errors).toEqual([]);
});

test("a fast stroke keeps at most one pending NGNE replacement at any frame, and the image ends correct", async ({
    page,
}, testInfo) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    await collapsePreview(page);
    const document = await openDocument(page, { width: 24, height: 16 }, VIEW);
    await setColours(page, 0x000000ff, 0xffffffff);
    await setToolOptions(page, "pencil", { size: 1, shape: "square" });
    await paint(page, document.id, pattern(24, 16, 3));
    await settle(page);

    // Sampled at every animation frame and every timer turn of the stroke: NGNE's pending
    // manual replacements (one per ID at most by its contract; the queue keeps it to one for
    // the frame slot, the only slot a stroke uploads).
    await page.evaluate(() => {
        const state = { max: 0, samples: 0, running: true };
        (window as unknown as { pressure: typeof state }).pressure = state;
        const read = () => {
            const inspection = window.__ngneTest!.viewport!.inspect();
            state.max = Math.max(state.max, inspection?.manualReplacements ?? 0);
            state.samples++;
        };
        const frame = () => {
            read();
            if (state.running) requestAnimationFrame(frame);
        };
        const turn = () => {
            read();
            if (state.running) setTimeout(turn, 0);
        };
        requestAnimationFrame(frame);
        setTimeout(turn, 0);
    });
    const calls = await uploads(page);
    const texels: Point[] = [];
    for (let round = 0; round < 3; round++) {
        for (let x = 0; x < 24; x++) texels.push({ x, y: (x + round * 5) % 16 });
    }
    await moveOver(page, [texels[0]!]);
    await page.mouse.down();
    await moveOver(page, texels.slice(1));
    await page.mouse.up();
    await settle(page);
    const pressure = await page.evaluate(() => {
        const state = (
            window as unknown as { pressure: { max: number; samples: number; running: boolean } }
        ).pressure;
        state.running = false;
        return { max: state.max, samples: state.samples };
    });
    const made = (await uploads(page)).calls - calls.calls;
    testInfo.annotations.push({
        type: "queue pressure",
        description: `${texels.length} moves, ${made} uploads, ${pressure.samples} samples, most pending ${pressure.max}`,
    });
    expect(pressure.samples).toBeGreaterThan(0);
    expect(pressure.max).toBeLessThanOrEqual(1);
    // Never one upload per pointer report beyond what the stroke changed.
    expect(made).toBeGreaterThan(0);
    expect(made).toBeLessThanOrEqual(texels.length);
    await expectImage(page, document, VIEW, (await celBytes(page, document.id))!);
    expect(errors).toEqual([]);
});

test("transparent pixels painted over opaque ones show the checkerboard exactly", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    await collapsePreview(page);
    const view = { scale: 4, originX: 12, originY: 20 };
    const document = await openDocument(page, { width: 16, height: 12 }, view);
    await paint(page, document.id, solid(16, 12, [200, 40, 90, 255]));
    await settle(page);
    // An erased band, a translucent band and the opaque rest: the erasure replaces the
    // texel, it does not blend with what the texture held.
    const image = solid(16, 12, [200, 40, 90, 255]);
    for (let y = 3; y < 9; y++) {
        for (let x = 0; x < 16; x++) {
            const at = (y * 16 + x) * 4;
            if (x < 8) image.splice(at, 4, 0, 0, 0, 0);
            else image.splice(at, 4, 10, 220, 30, 64);
        }
    }
    await paint(page, document.id, image);
    await settle(page);
    await expectImage(page, document, view, image);
    expect(errors).toEqual([]);
});

test("a device lost in the middle of a stroke keeps the edits made meanwhile and draws them once NGNE is ready", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    await collapsePreview(page);
    const document = await openDocument(page, { width: 24, height: 16 }, VIEW);
    await setColours(page, 0x000000ff, 0xffffffff);
    await setToolOptions(page, "pencil", { size: 2, shape: "square" });
    await paint(page, document.id, pattern(24, 16, 4));
    await settle(page);
    const status = () => page.evaluate(() => window.__ngneTest!.viewport!.status);
    const submitted = () => page.evaluate(() => window.__ngneTest!.viewport!.submittedFrames);
    const devices = await page.evaluate(() => window.__se011.devicesCreated());

    await moveOver(page, [{ x: 2, y: 2 }]);
    await page.mouse.down();
    await moveOver(page, [{ x: 8, y: 4 }]);
    // The device is lost and its replacement held back: NGNE stays `recovering`.
    await page.evaluate(() => {
        window.__se011.holdDevices();
        window.__se011.loseDevice();
    });
    await expect.poll(status).toBe("recovering");
    const waiting = await submitted();
    await moveOver(page, [
        { x: 14, y: 9 },
        { x: 20, y: 13 },
    ]);
    // The stroke goes on in the document; nothing is submitted to a recovering renderer.
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: true });
    const held = await celBytes(page, document.id);
    expect(await submitted()).toBe(waiting);

    // The device arrives: the view kept its dirty state and draws the stroke as it is now.
    await page.evaluate(() => window.__se011.releaseDevices());
    await settle(page);
    expect(await status()).toBe("ready");
    expect(await submitted()).toBeGreaterThan(waiting);
    await expectImage(page, document, VIEW, held!);
    await page.mouse.up();
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    await settle(page);
    await expectImage(page, document, VIEW, (await celBytes(page, document.id))!);
    // NGNE recovered on a new device: the same renderer, no replacement.
    expect(await page.evaluate(() => window.__se011.devicesCreated())).toBe(devices + 1);
    expect(await page.evaluate(() => window.__ngneTest!.viewport!.liveRenderers)).toBe(1);
    expect(errors).toEqual([]);
});
