import { expect, test } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its types.
import type * as CompositesModule from "../../src/app/state/composites";
import type * as LinkModule from "../../src/app/viewport/viewportLink";
import type * as CoreHistory from "../../src/core/history";
import type * as ThemeModule from "../../src/ui/theme/theme";
import { collectErrors } from "./se-006-support";
import {
    addFrame,
    captures,
    compare,
    documentRect,
    expectImage,
    framesUntil,
    hostDeviceSize,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    readback,
    settle,
    showFrame,
    shows,
    viewportHost,
} from "./se-011-support";
import type { FrameTimes } from "./se-011-support";

// SE-011: the viewport follows the stores — history steps, the active frame, the active
// session — and never draws a frame's key with another frame's texture.

/** Frame keys of the slot cache, as the viewport's probe reports them. */
const plain = (frameId: string) => `${frameId}:plain`;

// @alone: the frame counts are right only when no other worker takes the processor.
test("a pixel patch command changes the image within two animation frames, and undo restores it within two @alone", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const view = { scale: 8, originX: 64, originY: 40 };
    const document = await openDocument(page, { width: 5, height: 3 }, view);
    const before = pattern(5, 3, 1);
    await paint(page, document.id, before);
    await settle(page);
    await expectImage(page, document, view, before);

    // A 3×2 patch at (1, 1).
    const patch = { x: 1, y: 1, width: 3, height: 2, data: pattern(3, 2, 9) };
    const after = [...before];
    for (let y = 0; y < patch.height; y++) {
        for (let x = 0; x < patch.width; x++) {
            const from = (y * patch.width + x) * 4;
            after.splice(
                ((patch.y + y) * 5 + patch.x + x) * 4,
                4,
                ...patch.data.slice(from, from + 4),
            );
        }
    }
    const rect = documentRect(document, view);
    const images = [before, after];

    /** The first recorded frame that shows `image`, and what was drawn on the way to it. */
    const firstShowing = async (image: number, times: FrameTimes) => {
        const frames = (await captures(page)).filter((capture) => capture.stamp > times.start);
        const seen = frames.map((capture) => shows(capture.crop, images, 5, view.scale));
        // Never anything but the old image or the new one, each in full.
        expect(seen).not.toContain(-1);
        const at = seen.indexOf(image);
        expect(at).toBeGreaterThanOrEqual(0);
        return framesUntil(times, frames[at]?.stamp ?? Infinity);
    };

    // The command is executed at the start of an animation frame, as a pointer event is.
    const done = await page.evaluate(
        async ({ id, rect, patch }) => {
            const path = "/src/core/history/index.ts";
            const core = (await import(/* @vite-ignore */ path)) as typeof CoreHistory;
            const { documents } = window.__ngneTest!.sessions.getState();
            const { session, history } = documents.find((entry) => entry.id === id)!;
            const [cel] = [...session.doc.cels.values()];
            const command = core.pixelPatchCommand(session.doc, {
                label: "Patch",
                imageId: cel!.imageId,
                x: patch.x,
                y: patch.y,
                pixels: {
                    width: patch.width,
                    height: patch.height,
                    data: new Uint8ClampedArray(patch.data),
                },
            });
            window.__se011.record(rect);
            return window.__se011.atFrameStart(() => history.execute(command), 12);
        },
        { id: document.id, rect, patch },
    );
    const doFrames = await firstShowing(1, done);
    expect(doFrames).toBeGreaterThanOrEqual(1);
    expect(doFrames).toBeLessThanOrEqual(2);
    await settle(page);
    await expectImage(page, document, view, after);

    // Undo, through the registered command.
    const undone = await page.evaluate((rect) => {
        const undo = window.__ngneTest!.commands.get("edit.undo")!;
        window.__se011.record(rect);
        return window.__se011.atFrameStart(() => void undo.run(), 12);
    }, rect);
    const undoFrames = await firstShowing(0, undone);
    expect(undoFrames).toBeGreaterThanOrEqual(1);
    expect(undoFrames).toBeLessThanOrEqual(2);
    await settle(page);
    await expectImage(page, document, view, before);

    // Redo brings the patch back.
    await page.evaluate(() => void window.__ngneTest!.commands.get("edit.redo")!.run());
    await settle(page);
    await expectImage(page, document, view, after);
    expect(errors).toEqual([]);
});

test("switching between two frames that are both in the slot cache makes no texture() call", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const view = { scale: 6, originX: 30, originY: 18 };
    const document = await openDocument(page, { width: 6, height: 4 }, view);
    const first = pattern(6, 4, 2);
    const second = pattern(6, 4, 5);
    const images = [first, second];
    await paint(page, document.id, first);
    const secondId = await addFrame(page, document.id);
    await paint(page, document.id, second);
    await settle(page);
    await expectImage(page, document, view, second);
    // Uploads are counted twice: by the viewport's own counter, and outside the code under
    // test by the page's `copyExternalImageToTexture` calls, of which NGNE makes one per
    // `texture()`.
    const uploads = () =>
        page.evaluate(() => ({
            calls: window.__ngneTest!.viewport!.textureCalls,
            copies: window.__se011.copies(),
        }));
    // Adding the frame emptied the cache of the other one: the first visit uploads it, and
    // both counters see that upload.
    const loaded = await uploads();
    await showFrame(page, document.id, document.frameId);
    await settle(page);
    await expectImage(page, document, view, first);
    const cached = await uploads();
    expect(cached).toEqual({ calls: loaded.calls + 1, copies: loaded.copies + 1 });
    expect(await page.evaluate(() => window.__ngneTest!.viewport!.slots)).toEqual(
        expect.arrayContaining([plain(document.frameId), plain(secondId)]),
    );

    // Both frames are in the cache now. Each switch is drawn in the next animation frame
    // (SPEC §6.6) and uploads nothing.
    const rect = documentRect(document, view);
    for (const [target, frameId] of [
        [1, secondId],
        [0, document.frameId],
        [1, secondId],
        [0, document.frameId],
    ] as const) {
        const times = await page.evaluate(
            ({ id, frameId, rect }) => {
                const sessions = window.__ngneTest!.sessions.getState();
                const { session } = sessions.documents.find((entry) => entry.id === id)!;
                window.__se011.record(rect);
                return window.__se011.atFrameStart(() => {
                    session.activeFrameId = frameId;
                    sessions.touch(id);
                }, 6);
            },
            { id: document.id, frameId, rect },
        );
        const frames = (await captures(page)).filter((capture) => capture.stamp > times.start);
        expect(frames.map((capture) => shows(capture.crop, images, 6, view.scale))).toEqual([
            target,
        ]);
        expect(framesUntil(times, frames[0]?.stamp ?? Infinity)).toBe(1);
        await expectImage(page, document, view, images[target] ?? []);
    }
    // Four switches, each drawn: not one upload, by either count.
    expect(await uploads()).toEqual(cached);
    expect(errors).toEqual([]);
});

test("while a slot is re-keyed to another frame, the viewport shows the old frame or the new one in full", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    // The theme's checkerboard colours as a custom choice: a change of theme then changes
    // the workspace colour and nothing that is uploaded.
    await page.evaluate(() =>
        window.__ngneTest!.preferences.set("checkerboard", {
            size: 8,
            colors: { a: 0x3a3a3a, b: 0x4a4a4a },
        }),
    );
    const view = { scale: 8, originX: 48, originY: 32 };
    const size = 4;
    const document = await openDocument(page, { width: size, height: size }, view);
    // Nine frames for eight slots, each with its own image.
    const images = Array.from({ length: 9 }, (_, index) => pattern(size, size, index + 1));
    const frameIds = [document.frameId];
    await paint(page, document.id, images[0] ?? []);
    for (let index = 1; index < 9; index++) {
        frameIds.push(await addFrame(page, document.id));
        await paint(page, document.id, images[index] ?? []);
    }
    // Visit frames 1 to 8: they fill the cache and frame 9 is given up.
    for (let index = 0; index < 8; index++) {
        await showFrame(page, document.id, frameIds[index] ?? "");
        await settle(page);
        await expectImage(page, document, view, images[index] ?? []);
    }
    const keys = frameIds.map(plain);
    const slotsBefore = await page.evaluate(() => window.__ngneTest!.viewport!.slots);
    expect([...slotsBefore].sort()).toEqual(keys.slice(0, 8).sort());
    const rekeyed = slotsBefore.indexOf(keys[0] ?? "");

    // Frame 9 takes the slot of the least recently used frame, frame 1. Its upload waits.
    const rect = documentRect(document, view);
    const calls = await page.evaluate((rect) => {
        window.__se011.closeUploadGate();
        window.__se011.record(rect);
        return window.__ngneTest!.viewport!.textureCalls;
    }, rect);
    await showFrame(page, document.id, frameIds[8] ?? "");
    // The switch is drawn first. The viewport draws once per animation frame whatever asked
    // for it, so a theme change made before that frame would share it.
    await expect.poll(async () => (await captures(page)).length).toBeGreaterThan(0);

    // Draws made meanwhile show frame 8 in full: the slot that is being re-keyed still holds
    // frame 1's texture and is not drawn. The viewport is made to draw by changes of theme
    // (the workspace colour around the document); it is also read back directly.
    const setTheme = async (theme: "dark" | "light") => {
        const drawn = (await captures(page)).length;
        await page.evaluate(async (theme) => {
            const path = "/src/ui/theme/theme.ts";
            const module = (await import(/* @vite-ignore */ path)) as typeof ThemeModule;
            module.setTheme(theme);
        }, theme);
        // The new workspace colour has been drawn.
        await expect.poll(async () => (await captures(page)).length).toBeGreaterThan(drawn);
    };
    for (const theme of ["light", "dark", "light", "dark"] as const) await setTheme(theme);
    const during = await readback(page, rect);
    expect(compare(during.crop, images[7] ?? [], size, view.scale)).toEqual([]);
    expect(during.outside).toBe(0);
    // Every frame submitted while the upload waited is frame 8, in full: the one of the
    // switch itself and those of the theme changes.
    const waiting = await captures(page);
    expect(waiting.length).toBeGreaterThanOrEqual(5);
    expect(waiting.map((capture) => shows(capture.crop, images, size, view.scale))).toEqual(
        waiting.map(() => 7),
    );
    const slotsDuring = await page.evaluate(() => window.__ngneTest!.viewport!.slots);
    expect(slotsDuring).not.toContain(keys[8]);
    expect(slotsDuring[rekeyed]).toBe(keys[0]);
    expect(await page.evaluate(() => window.__ngneTest!.viewport!.textureCalls)).toBe(calls);
    expect(await page.evaluate(() => window.__ngneTest!.viewport!.settled)).toBe(false);

    // The upload goes through: frame 9 in full, in the slot that held frame 1.
    await page.evaluate(() => window.__se011.openUploadGate());
    await settle(page);
    await expectImage(page, document, view, images[8] ?? []);
    const slotsAfter = await page.evaluate(() => window.__ngneTest!.viewport!.slots);
    expect(slotsAfter[rekeyed]).toBe(keys[8]);
    expect(slotsAfter).not.toContain(keys[0]);
    expect(await page.evaluate(() => window.__ngneTest!.viewport!.textureCalls)).toBe(calls + 1);

    // Every frame submitted from the switch on showed frame 8 or frame 9 in full — never
    // the checkerboard alone, never another frame, never a mix — in that order, and frame 9
    // at least once.
    const seen = (await captures(page)).map((capture) =>
        shows(capture.crop, images, size, view.scale),
    );
    expect(seen.length).toBeGreaterThan(waiting.length);
    expect(new Set(seen)).toEqual(new Set([7, 8]));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(errors).toEqual([]);
});

test("a history step that changes the document's size shows the old image or the new one in full", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const view = { scale: 4, originX: 20, originY: 12 };
    const document = await openDocument(page, { width: 6, height: 4 }, view);
    const small = pattern(6, 4, 3);
    const large = pattern(9, 7, 4);
    await paint(page, document.id, small);
    await settle(page);
    await expectImage(page, document, view, small);

    // A test command with `structure: true` that resizes the canvas and its one image.
    const largeRect = documentRect({ width: 9, height: 7 }, view);
    await page.evaluate(
        ({ id, large, rect }) => {
            const { documents } = window.__ngneTest!.sessions.getState();
            const { history } = documents.find((entry) => entry.id === id)!;
            const swap = (
                session: (typeof documents)[number]["session"],
                width: number,
                height: number,
                data: Uint8ClampedArray,
            ) => {
                const [cel] = [...session.doc.cels.values()];
                const image = session.doc.images.get(cel!.imageId)!;
                const previous = { width: image.width, height: image.height, data: image.data };
                session.doc.width = width;
                session.doc.height = height;
                session.doc.images.set(cel!.imageId, { width, height, data });
                return previous;
            };
            let previous: ReturnType<typeof swap> | null = null;
            window.__se011.record(rect);
            history.execute({
                label: "Canvas Size",
                bytes: 0,
                touched: { frameIds: [], layerIds: [], structure: true },
                do(session) {
                    previous = swap(session, 9, 7, new Uint8ClampedArray(large));
                },
                undo(session) {
                    if (previous) swap(session, previous.width, previous.height, previous.data);
                },
            });
        },
        { id: document.id, large, rect: largeRect },
    );
    await settle(page);
    await expectImage(page, { width: 9, height: 7 }, view, large);

    // On the way: the 6×4 image over its own rectangle with workspace around it, or the 9×7
    // one. Never the old texture stretched over the new rectangle.
    const smallIn9x7 = (crop: { data: number[]; width: number }) => {
        const inner = { x: 0, y: 0, width: 24, height: 16, data: [] as number[] };
        for (let y = 0; y < 16; y++) {
            inner.data.push(...crop.data.slice(y * crop.width * 4, (y * crop.width + 24) * 4));
        }
        return compare(inner, small, 6, view.scale).length === 0;
    };
    const frames = await captures(page);
    expect(frames.length).toBeGreaterThanOrEqual(1);
    for (const frame of frames) {
        const isLarge = compare(frame.crop, large, 9, view.scale).length === 0;
        expect(isLarge || smallIn9x7(frame.crop)).toBe(true);
    }
    expect(compare(frames[frames.length - 1]!.crop, large, 9, view.scale)).toEqual([]);

    // Undo restores the 6×4 document.
    await page.evaluate(() => void window.__ngneTest!.commands.get("edit.undo")!.run());
    await settle(page);
    await expectImage(page, document, view, small);
    expect(errors).toEqual([]);
});

test("the viewport follows the active session and gives its renderer up with the last document", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const viewA = { scale: 4, originX: 12, originY: 20 };
    const viewB = { scale: 2, originX: 100, originY: 60 };
    const a = await openDocument(page, { name: "a", width: 8, height: 8 }, viewA);
    const imageA = pattern(8, 8, 6);
    await paint(page, a.id, imageA);
    await settle(page);
    await expectImage(page, a, viewA, imageA);

    const b = await openDocument(page, { name: "b", width: 12, height: 5 }, viewB);
    const imageB = pattern(12, 5, 7);
    await paint(page, b.id, imageB);
    await settle(page);
    await expectImage(page, b, viewB, imageB);
    // Nothing of the first document is kept in the frame cache.
    expect(await page.evaluate(() => window.__ngneTest!.viewport!.slots)).toEqual(
        expect.not.arrayContaining([plain(a.frameId)]),
    );

    // A switch uploads the checkerboard and the frame of the document switched to, and
    // nothing for a key of the document left: no slot is reserved for it on the way.
    const uploads = () =>
        page.evaluate(() => ({
            calls: window.__ngneTest!.viewport!.textureCalls,
            copies: window.__se011.copies(),
        }));
    const before = await uploads();
    await page.evaluate((id) => window.__ngneTest!.sessions.getState().activate(id), a.id);
    await settle(page);
    await expectImage(page, a, viewA, imageA);
    expect(await uploads()).toEqual({ calls: before.calls + 2, copies: before.copies + 2 });
    expect(await page.evaluate(() => window.__ngneTest!.viewport!.slots)).toEqual([
        plain(a.frameId),
        ...Array.from({ length: 7 }, () => null),
    ]);
    // One viewport, one renderer, for both documents.
    expect(await page.evaluate(() => window.__ngneTest!.viewport!.liveRenderers)).toBe(1);
    expect(await page.evaluate(() => window.__se011.liveDevices())).toBe(1);

    // Closing the active document shows the other; closing the last removes the canvas.
    await page.evaluate((id) => window.__ngneTest!.sessions.getState().close(id), a.id);
    await settle(page);
    await expectImage(page, b, viewB, imageB);
    await page.evaluate((id) => window.__ngneTest!.sessions.getState().close(id), b.id);
    await expect(viewportHost(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__se011.liveDevices())).toBe(0);
    expect(await page.evaluate(() => window.__ngneTest!.viewport)).toBeUndefined();
    expect(errors).toEqual([]);
});

test("other modules reach the active document's composites and the mounted viewport without the component", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const view = { scale: 6, originX: 30, originY: 18 };
    const document = await openDocument(page, { width: 6, height: 4 }, view);
    const image = pattern(6, 4, 3);
    await paint(page, document.id, image);
    await settle(page);
    await expectImage(page, document, view, image);

    // The link: a viewport is mounted, and its element has this size in device pixels.
    const link = () =>
        page.evaluate(async () => {
            const path = "/src/app/viewport/viewportLink.ts";
            const { viewportLink } = (await import(/* @vite-ignore */ path)) as typeof LinkModule;
            return { mounted: viewportLink.mounted, size: viewportLink.deviceSize };
        });
    expect(await link()).toEqual({ mounted: true, size: await hostDeviceSize(page) });
    await page.setViewportSize({ width: 1400, height: 800 });
    await settle(page);
    expect(await link()).toEqual({ mounted: true, size: await hostDeviceSize(page) });

    /** Writes the first texel inside an open stroke and tells the app in one of two ways. */
    const stroke = (texel: number[], tell: "composites" | "viewport") =>
        page.evaluate(
            async ({ id, texel, tell }) => {
                const compositesPath = "/src/app/state/composites.ts";
                const linkPath = "/src/app/viewport/viewportLink.ts";
                const { activeComposites } = (await import(
                    /* @vite-ignore */ compositesPath
                )) as typeof CompositesModule;
                const { viewportLink, frameKey } = (await import(
                    /* @vite-ignore */ linkPath
                )) as typeof LinkModule;
                const { documents } = window.__ngneTest!.sessions.getState();
                const { session, history } = documents.find((entry) => entry.id === id)!;
                const frameId = session.activeFrameId;
                const layerId = session.activeLayerId;
                const transaction = history.transaction ?? history.begin({ layerId, frameId });
                transaction.image.data.set(texel, 0);
                const touched = { frameIds: [frameId], layerIds: [layerId], structure: false };
                if (tell === "composites") {
                    // The cache drops the frame and the viewport hears of it from the cache.
                    activeComposites.invalidate(touched);
                } else {
                    // The writer keeps the cache itself and tells only the viewport.
                    activeComposites.cache!.invalidate(touched);
                    viewportLink.invalidate([frameKey(frameId)]);
                }
                // What every other reader of the composite gets now.
                return [...activeComposites.cache!.get(frameId).data.slice(0, 4)];
            },
            { id: document.id, texel, tell },
        );

    // No history step happens in a stroke; both ways the viewport shows the new pixels.
    const first = [1, 2, 3, 255];
    expect(await stroke(first, "composites")).toEqual(first);
    await settle(page);
    await expectImage(page, document, view, [...first, ...image.slice(4)]);
    const second = [200, 100, 50, 255];
    expect(await stroke(second, "viewport")).toEqual(second);
    await settle(page);
    await expectImage(page, document, view, [...second, ...image.slice(4)]);

    // The stroke is given up: the pixels are back, and reported the same way.
    await page.evaluate(async (id) => {
        const path = "/src/app/state/composites.ts";
        const { activeComposites } = (await import(
            /* @vite-ignore */ path
        )) as typeof CompositesModule;
        const { documents } = window.__ngneTest!.sessions.getState();
        const { session, history } = documents.find((entry) => entry.id === id)!;
        history.transaction!.abort();
        activeComposites.invalidate({
            frameIds: [session.activeFrameId],
            layerIds: [session.activeLayerId],
            structure: false,
        });
    }, document.id);
    await settle(page);
    await expectImage(page, document, view, image);

    // No document, no viewport: the link says so.
    await page.evaluate((id) => window.__ngneTest!.sessions.getState().close(id), document.id);
    await expect(viewportHost(page)).toHaveCount(0);
    expect(await link()).toEqual({ mounted: false, size: { width: 0, height: 0 } });
    expect(errors).toEqual([]);
});
