import { describe, expect, it } from "vitest";
import type { PixelBuffer } from "../../src/core/model";
import { QUAD_LAYER } from "../../src/engine/viewport/geometry";
import { frameKey } from "../../src/engine/viewport/types";
import type { ViewportDocument, ViewportGhost } from "../../src/engine/viewport/types";
import {
    frameSlotId,
    replaceSceneDocument,
    ViewportSlots,
} from "../../src/engine/viewport/viewportSlots";
import type { Scene } from "../../src/engine/viewport/viewportSlots";
import { bitmap, FakeRenderer, flush } from "./se-011-support";

// SE-025: onion skins in the viewport's slots (SPEC §6.4). Ghosts are frame keys drawn from the
// frame cache at layer 3 or 5 with their opacity, only from a slot that holds them; they are
// keys on screen, so a history step uploads them again in place; they are hidden while
// playing; with tint off they are the plain keys a frame switch draws. No NGNE and no DOM.

/** A document of the frames `a` to `i`; each key's pixels are one colour, red = 10 × (index + 1). */
function document(): ViewportDocument & { asked: string[] } {
    const asked: string[] = [];
    const frames = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    return {
        width: 4,
        height: 2,
        asked,
        pixels(key) {
            asked.push(key);
            const [frame, variant] = key.split(":");
            const index = frames.indexOf(frame!);
            if (index === -1) return null;
            const data = new Uint8ClampedArray(4 * 2 * 4);
            const blue = variant === "after" ? 200 : variant === "before" ? 100 : 0;
            for (let at = 0; at < data.length; at += 4)
                data.set([10 * index + 10, 0, blue, 255], at);
            return { width: 4, height: 2, data };
        },
    };
}

const plain = (frame: string) => frameKey(frame);

function setup() {
    const renderer = new FakeRenderer();
    const scene: Scene = {
        document: null,
        epoch: 0,
        current: null,
        view: { scale: 2, originX: 10, originY: 20 },
        checker: { a: 0x111111, b: 0x222222, size: 2 },
        background: 0,
    };
    const sources = new Map<string, PixelBuffer>();
    let made = 0;
    const slots = new ViewportSlots(scene, {
        target: renderer,
        bitmap: async (pixels) => {
            const label = `image ${++made}`;
            sources.set(label, pixels);
            return bitmap(label);
        },
        rendererFailed: () => false,
        onChange: () => {},
        onError: (error) => {
            throw error;
        },
        onStuck: () => {},
        gate: () => undefined,
    });
    let settled = 0;
    const doc = document();
    replaceSceneDocument(scene, doc);
    slots.documentChanged();
    return {
        scene,
        slots,
        renderer,
        doc,
        /** The slot of each `texture()` call so far. */
        ids: () => renderer.calls.map((call) => call.id),
        /** Resolves every upload, also those started by the ones before. */
        async land() {
            for (;;) {
                await flush();
                if (settled >= renderer.calls.length) return;
                while (settled < renderer.calls.length) renderer.calls[settled++]?.resolve();
            }
        },
        /** Starts what was requested and leaves it in flight. */
        async start() {
            await flush();
        },
        show(current: string, ghosts: readonly ViewportGhost[]) {
            scene.current = current;
            scene.onion = ghosts;
            slots.sync();
        },
        /** The red of the pixels the upload of `call` held. */
        red(index: number): number {
            return sources.get(renderer.calls[index]!.source.label)!.data[0]!;
        },
        /** The ghost quads drawn now: layer, alpha and texture. */
        ghostQuads() {
            return slots
                .quads()
                .filter((quad) => quad.layer === QUAD_LAYER.onionBehind || quad.layer === 5)
                .map(({ layer, alpha, texture }) => ({ layer, alpha, texture }));
        },
        /** The slot that holds `key` now, or -1. */
        holding: (key: string) => slots.frames.holding(key),
    };
}

const behind = (key: string, alpha: number): ViewportGhost => ({ key, alpha, placement: "behind" });

describe("ViewportSlots: onion skins", () => {
    it("draws each ghost from its slot once ready, at layer 3 or 5 with its opacity, under and over the frame", async () => {
        const view = setup();
        view.show(plain("c"), [behind(plain("b"), 0.5), behind(plain("a"), 0.25)]);
        // Not uploaded yet: no ghost is drawn, so no frame names a texture that is not ready.
        expect(view.ghostQuads()).toEqual([]);
        await view.land();
        const quads = view.slots.quads();
        const b = view.holding(plain("b"));
        const a = view.holding(plain("a"));
        expect(quads.filter((quad) => quad.layer === QUAD_LAYER.onionBehind)).toEqual([
            { texture: frameSlotId(b), layer: 3, x: 14, y: 22, width: 8, height: 4, alpha: 0.5 },
            { texture: frameSlotId(a), layer: 3, x: 14, y: 22, width: 8, height: 4, alpha: 0.25 },
        ]);
        expect(quads.find((quad) => quad.layer === QUAD_LAYER.frame)?.texture).toBe(
            frameSlotId(view.holding(plain("c"))),
        );
        expect(view.slots.drawnGhosts()).toEqual([
            { key: plain("b"), alpha: 0.5, layer: 3 },
            { key: plain("a"), alpha: 0.25, layer: 3 },
        ]);

        // In front: layer 5.
        view.show(plain("c"), [{ key: plain("b"), alpha: 1, placement: "front" }]);
        expect(view.ghostQuads()).toEqual([
            { layer: QUAD_LAYER.onionFront, alpha: 1, texture: frameSlotId(b) },
        ]);
    });

    it("with tint off shares the plain slots: switching to a ghost's frame uploads nothing", async () => {
        const view = setup();
        view.show(plain("c"), [behind(plain("b"), 0.5), behind(plain("d"), 0.5)]);
        await view.land();
        const uploads = view.renderer.calls.length;
        expect(uploads).toBe(4); // checker, c, b, d
        view.show(plain("d"), [behind(plain("c"), 0.5), behind(plain("e"), 0.5)]);
        await view.land();
        // Only e is new.
        expect(view.renderer.calls.length).toBe(uploads + 1);
        expect(view.doc.asked.slice(-1)).toEqual([plain("e")]);
    });

    it("uploads a ghost again in place at a history step that touches it, and gives up other keys", async () => {
        const view = setup();
        view.show(plain("b"), []);
        await view.land();
        view.show(plain("h"), []);
        await view.land();
        view.show(plain("c"), [behind(frameKey("b", "before"), 0.5)]);
        await view.land();
        const slot = view.holding(frameKey("b", "before"));
        const hSlot = view.holding(plain("h"));
        expect(slot).toBeGreaterThanOrEqual(0);
        const before = view.renderer.calls.length;

        // A step touching b and h names their plain keys: b's tinted ghost is a key on screen.
        view.slots.invalidate([plain("b"), plain("h")]);
        await view.start();
        const ids = view.ids().slice(before);
        expect(ids).toContain(frameSlotId(slot));
        // h is not on screen: its slot gets the placeholder.
        expect(ids).toContain(frameSlotId(hSlot));
        expect(view.slots.frames.reservedFor(plain("h"))).toBe(-1);
        // Until the upload resolves, the ghost stays on screen with its previous pixels.
        expect(view.ghostQuads()).toEqual([{ layer: 3, alpha: 0.5, texture: frameSlotId(slot) }]);
        // The plain key of b, not on screen, is given up as any other key.
        expect(view.slots.frames.reservedFor(plain("b"))).toBe(-1);
        await view.land();
        expect(view.holding(frameKey("b", "before"))).toBe(slot);
        expect(view.ghostQuads()).toEqual([{ layer: 3, alpha: 0.5, texture: frameSlotId(slot) }]);
    });

    it("keeps drawing a ghost whose newer upload is queued, as it does the current frame", async () => {
        const view = setup();
        view.show(plain("c"), [behind(plain("b"), 0.5)]);
        await view.land();
        const slot = view.holding(plain("b"));
        // Two steps in a row: the first upload resolves while the second waits.
        view.slots.invalidate([plain("b")]);
        await view.start();
        view.slots.invalidate([plain("b")]);
        await view.start();
        view.renderer.inFlight(frameSlotId(slot)).resolve();
        await flush();
        expect(view.ghostQuads()).toEqual([{ layer: 3, alpha: 0.5, texture: frameSlotId(slot) }]);
    });

    it("never takes the slot of a ghost on screen for another key", async () => {
        const view = setup();
        // Every slot holds a frame, a the least recently used.
        for (const frame of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
            view.show(plain(frame), []);
            await view.land();
        }
        const slot = view.holding(plain("a"));
        view.doc.asked.length = 0;
        // A frame that is not cached, with a as its ghost: its upload takes another slot than
        // a's, which is on screen, and a is not uploaded again.
        view.show(plain("i"), [behind(plain("a"), 1)]);
        await view.land();
        expect(view.holding(plain("a"))).toBe(slot);
        expect(view.doc.asked).toEqual([plain("i")]);
        expect(view.ghostQuads()).toEqual([{ layer: 3, alpha: 1, texture: frameSlotId(slot) }]);
    });

    it("hides the ghosts while playing and shows them again after", async () => {
        const view = setup();
        view.show(plain("c"), [behind(plain("b"), 0.5)]);
        await view.land();
        view.scene.playing = [plain("a"), plain("b"), plain("c")];
        view.slots.sync();
        expect(view.ghostQuads()).toEqual([]);
        expect(view.slots.drawnGhosts()).toEqual([]);
        view.scene.playing = null;
        view.slots.sync();
        await view.land();
        expect(view.ghostQuads().length).toBe(1);
    });

    it("gives up the tinted variants once no ghost is tinted, and keeps the plain ones", async () => {
        const view = setup();
        view.show(plain("c"), [behind(frameKey("b", "before"), 0.5), behind(plain("d"), 0.5)]);
        await view.land();
        const tinted = view.holding(frameKey("b", "before"));
        const before = view.renderer.calls.length;
        // Onion off.
        view.show(plain("c"), []);
        await view.land();
        expect(view.slots.frames.reservedFor(frameKey("b", "before"))).toBe(-1);
        expect(view.ids().slice(before)).toEqual([frameSlotId(tinted)]);
        expect(view.slots.frames.reservedFor(plain("d"))).toBeGreaterThanOrEqual(0);
        // While playing, a tinted ghost is only hidden.
        view.show(plain("c"), [behind(frameKey("b", "before"), 0.5)]);
        await view.land();
        view.scene.playing = [plain("c"), plain("d")];
        view.slots.sync();
        await view.land();
        expect(view.slots.frames.reservedFor(frameKey("b", "before"))).toBeGreaterThanOrEqual(0);
    });

    it("forgets the ghosts with the document", async () => {
        const view = setup();
        view.show(plain("c"), [behind(plain("b"), 0.5)]);
        await view.land();
        replaceSceneDocument(view.scene, document());
        view.slots.documentChanged();
        expect(view.scene.onion).toEqual([]);
        expect(view.ghostQuads()).toEqual([]);
    });
});
