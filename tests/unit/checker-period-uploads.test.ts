import { describe, expect, it } from "vitest";
import type { ViewportDocument } from "../../src/engine/viewport/types";
import {
    CHECKER_SLOT,
    replaceSceneDocument,
    ViewportSlots,
} from "../../src/engine/viewport/viewportSlots";
import type { Scene } from "../../src/engine/viewport/viewportSlots";
import { bitmap, FakeRenderer, flush } from "./se-011-support";

// gh-13: the checkerboard is one period of the pattern (2 × 2 squares) with repeat addressing
// (NGNE 0.4.0 `TextureSampling`), drawn over the document rectangle with as many periods as
// fit it (SPEC §6.4). Its image depends on the checker setting alone: a document resize or
// another document uploads nothing, a checker change uploads the period only.

/** A document with no frame on show: only its size is read. */
function sized(
    width: number,
    height: number,
): ViewportDocument & {
    width: number;
    height: number;
} {
    return { width, height, pixels: () => null };
}

function setup() {
    const renderer = new FakeRenderer();
    const scene: Scene = {
        document: null,
        epoch: 0,
        current: null,
        view: { scale: 3, originX: 10, originY: 20 },
        checker: { a: 0x111111, b: 0x222222, size: 2 },
        background: 0,
    };
    const slots = new ViewportSlots(scene, {
        target: renderer,
        // The label is the image's size: a period of squares of `size` is 2 × size square.
        bitmap: async (pixels) => bitmap(`${pixels.width}x${pixels.height}`),
        rendererFailed: () => false,
        onChange: () => undefined,
        onError: (error) => {
            throw error;
        },
        onStuck: () => undefined,
        gate: () => undefined,
    });
    const settled = new WeakSet<object>();
    return {
        scene,
        slots,
        renderer,
        /** The checker uploads so far, by the size of their image. */
        checkerUploads: () =>
            renderer.calls
                .filter((call) => call.id === CHECKER_SLOT)
                .map((call) => call.source.label),
        /** Resolves every upload until none is left. */
        async land() {
            for (;;) {
                await flush();
                const open = renderer.calls.filter((call) => !settled.has(call));
                if (open.length === 0) return;
                for (const call of open) {
                    settled.add(call);
                    call.resolve();
                }
            }
        },
        show(document: ViewportDocument | null) {
            replaceSceneDocument(scene, document);
            slots.documentChanged();
        },
        checkerQuads: () => slots.quads().filter((quad) => quad.texture === CHECKER_SLOT),
    };
}

describe("checker period: what is uploaded", () => {
    it("uploads one period of 2 × size squares, registered with repeat addressing", async () => {
        const { renderer, checkerUploads, show, land } = setup();
        show(sized(37, 23));
        await land();
        expect(checkerUploads()).toEqual(["4x4"]);
        expect(renderer.inFlight(CHECKER_SLOT).sampling).toEqual({ address: "repeat" });
    });

    it("uploads nothing for the checkerboard when the document is resized", async () => {
        const { slots, scene, checkerUploads, show, land, checkerQuads } = setup();
        const document = sized(37, 23);
        show(document);
        await land();
        expect(checkerUploads()).toEqual(["4x4"]);

        // A resize, as the app tells it: the size changed and every frame with it.
        document.width = 1024;
        document.height = 7;
        slots.invalidate("all");
        slots.sync();
        await land();
        expect(checkerUploads()).toEqual(["4x4"]);
        // The period is drawn over the new rectangle at once, never stretched.
        expect(checkerQuads()).toEqual([
            {
                texture: CHECKER_SLOT,
                layer: 1,
                x: 10 + (1024 * 3) / 2,
                y: 20 + (7 * 3) / 2,
                width: 1024 * 3,
                height: 7 * 3,
                u: 0,
                v: 0,
                uw: 1024 / 4,
                vh: 7 / 4,
            },
        ]);
        expect(scene.document?.width).toBe(1024);
    });

    it("uploads nothing for the checkerboard when another document of another size is shown", async () => {
        const { checkerUploads, show, land, checkerQuads } = setup();
        show(sized(37, 23));
        await land();
        show(sized(5, 3));
        await land();
        expect(checkerUploads()).toEqual(["4x4"]);
        expect(checkerQuads()).toMatchObject([{ width: 15, height: 9, uw: 5 / 4, vh: 3 / 4 }]);
    });

    it("uploads the new period alone for a checker change, and draws the old one with its own period until then", async () => {
        const { slots, scene, renderer, checkerUploads, show, land, checkerQuads } = setup();
        show(sized(37, 23));
        await land();

        // Another square size: one upload of the new period.
        scene.checker = { ...scene.checker, size: 3 };
        slots.sync();
        await flush();
        expect(checkerUploads()).toEqual(["4x4", "6x6"]);
        // In flight: the slot still holds the period of squares of 2, drawn as such.
        expect(checkerQuads()).toMatchObject([{ uw: 37 / 4, vh: 23 / 4 }]);
        await land();
        expect(checkerQuads()).toMatchObject([{ uw: 37 / 6, vh: 23 / 6 }]);
        expect(renderer.inFlight(CHECKER_SLOT).sampling).toEqual({ address: "repeat" });

        // Other colours, same size: the period again, nothing else.
        scene.checker = { ...scene.checker, a: 0x333333 };
        slots.sync();
        await land();
        expect(checkerUploads()).toEqual(["4x4", "6x6", "6x6"]);

        // The same checker again: nothing.
        scene.checker = { ...scene.checker };
        slots.sync();
        await land();
        expect(checkerUploads()).toEqual(["4x4", "6x6", "6x6"]);
    });
});

describe("checker period: what is drawn", () => {
    it("starts the pattern at the document's top-left in every tiled-mode copy", async () => {
        const { scene, show, land, checkerQuads } = setup();
        show(sized(5, 3));
        scene.tiled = "both";
        await land();
        const quads = checkerQuads();
        expect(quads).toHaveLength(9);
        for (const quad of quads) {
            expect(quad).toMatchObject({ u: 0, v: 0, uw: 5 / 4, vh: 3 / 4, width: 15, height: 9 });
        }
        expect(new Set(quads.map((quad) => `${quad.x},${quad.y}`)).size).toBe(9);
    });

    it("is released with the last document and asked for again with the next", async () => {
        const { renderer, checkerUploads, show, land, checkerQuads } = setup();
        show(sized(5, 3));
        await land();
        show(null);
        await land();
        expect(renderer.released).toEqual([CHECKER_SLOT]);
        expect(checkerQuads()).toEqual([]);
        show(sized(8, 8));
        await land();
        expect(checkerUploads()).toEqual(["4x4", "4x4"]);
        expect(checkerQuads()).toMatchObject([{ uw: 2, vh: 2 }]);
    });
});
