import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PixelBuffer } from "../../src/core/model";
import { UploadQueue } from "../../src/engine/UploadQueue";
import { QUAD_LAYER } from "../../src/engine/viewport/geometry";
import {
    displaySize,
    MAX_DISPLAY_SIDE,
    REFERENCE_TEXEL_BUDGET,
    referenceDeviceRect,
    ReferenceSlots,
    RESAMPLE_QUIET_MS,
    textureSizes,
} from "../../src/engine/viewport/referenceSlots";
import type { ReferenceScene, ReferenceTag } from "../../src/engine/viewport/referenceSlots";
import type { ViewportReference, ViewportView } from "../../src/engine/viewport/types";
import { bitmap, FakeRenderer } from "./se-011-support";

// SE-045: the reference slots `ed:ref:0..3` of one renderer (SPEC §6.4, §7.6) — the display
// source cap, the size on screen each image is uploaded at, the 16 MP budget, the resample
// 100 ms after the zoom settles, the 1×1 placeholder for a removed layer — and the quads they
// draw. No NGNE and no DOM: the renderer is a stand-in and the images are labels.

function image(width: number, height: number): PixelBuffer {
    // The slots never read the pixels of a reference: an empty buffer stands in.
    return { width, height, data: new Uint8ClampedArray(0) };
}

function reference(id: string, source: PixelBuffer, change: Partial<ViewportReference> = {}) {
    return {
        id,
        image: source,
        x: 0,
        y: 0,
        scale: 1,
        opacity: 128,
        placement: "behind",
        ...change,
    } satisfies ViewportReference as ViewportReference;
}

/** Lets the microtasks of the queue and the fake host run. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 30; turn++) await Promise.resolve();
}

function setup(view: ViewportView = { scale: 4, originX: 10, originY: 20 }) {
    const scene: {
        -readonly [Key in keyof ReferenceScene]: ReferenceScene[Key];
    } = { document: { width: 16, height: 8 }, epoch: 1, view, references: [] };
    const renderer = new FakeRenderer();
    const queue = new UploadQueue<ReferenceTag>({ target: renderer });
    const events: string[] = [];
    const slots = new ReferenceSlots(scene, queue, {
        referenceBitmap: async (source, width, height) =>
            bitmap(`${source.width}x${source.height}@${width}x${height}`),
        placeholder: async () => bitmap("placeholder"),
        gate: () => undefined,
        onStuck: () => events.push("stuck"),
    });
    let landed = 0;
    return {
        scene,
        slots,
        renderer,
        events,
        /** The uploads so far, as `slot<image`. */
        uploads: () => renderer.calls.map((call) => `${call.id}<${call.source.label}`),
        /** Resolves every upload in flight. */
        async land() {
            await settle();
            while (landed < renderer.calls.length) renderer.calls[landed++]?.resolve();
            await settle();
        },
    };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("sizes", () => {
    it("limits a display source to 4096 px on its longer side, keeping its aspect", () => {
        expect(displaySize({ width: 2048, height: 2048 })).toEqual({ width: 2048, height: 2048 });
        expect(displaySize({ width: 8192, height: 2048 })).toEqual({ width: 4096, height: 1024 });
        expect(displaySize({ width: 5000, height: 7000 })).toEqual({
            width: Math.round((5000 * MAX_DISPLAY_SIDE) / 7000),
            height: MAX_DISPLAY_SIDE,
        });
    });

    it("places a reference on whole device pixels: origin plus position and size times the zoom", () => {
        const view = { scale: 4, originX: 10, originY: 20 };
        const ref = reference("r", image(8, 6), { x: 1.5, y: -0.25, scale: 0.5 });
        expect(referenceDeviceRect(view, ref)).toEqual({ x: 16, y: 19, width: 16, height: 12 });
    });

    it("uploads at the size on screen, or the display source when that is smaller", () => {
        const view = { scale: 4, originX: 0, originY: 0 };
        // 2048 fitted to 64 at 4×: 256 × 256 on screen.
        const fitted = reference("a", image(2048, 2048), { scale: 1 / 32 });
        // 16 px at 1:1 at 4×: 64 px on screen, more than the source has.
        const small = reference("b", image(16, 16));
        expect(textureSizes(view, [fitted, small])).toEqual([
            { width: 256, height: 256 },
            { width: 16, height: 16 },
        ]);
    });

    it("scales every texture down by one factor when together they exceed 16 MP", () => {
        const view = { scale: 1, originX: 0, originY: 0 };
        const big = [0, 1, 2, 3].map((index) => reference(`r${index}`, image(4096, 4096)));
        const sizes = textureSizes(view, big);
        const total = sizes.reduce((sum, size) => sum + size.width * size.height, 0);
        expect(total).toBeLessThanOrEqual(REFERENCE_TEXEL_BUDGET);
        expect(sizes).toEqual(big.map(() => ({ width: 2048, height: 2048 })));
        // Within the budget nothing is scaled.
        expect(textureSizes(view, big.slice(0, 1))).toEqual([{ width: 4096, height: 4096 }]);
    });
});

describe("ReferenceSlots", () => {
    it("uploads a new reference at once, at its size on screen, and draws it only once the upload resolved", async () => {
        const { scene, slots, uploads, land } = setup();
        scene.references = [reference("r1", image(8, 8), { x: 4, y: 0 })];
        slots.sync();
        await settle();
        expect(uploads()).toEqual(["ed:ref:0<8x8@8x8"]);
        // In flight: NGNE would skip a frame that drew from the slot ("texture not ready").
        expect(slots.quads()).toEqual([]);
        await land();
        expect(slots.quads()).toEqual([
            {
                texture: "ed:ref:0",
                layer: QUAD_LAYER.referenceBehind,
                x: 10 + 16 + 16,
                y: 20 + 16,
                width: 32,
                height: 32,
                u: 0,
                v: 0,
                uw: 1,
                vh: 1,
                alpha: 128 / 255,
            },
        ]);
        expect(slots.shown()).toEqual([{ layerId: "r1", width: 8, height: 8 }, null, null, null]);
    });

    it("draws a reference placed in front at layer 6, and clips it to the document rectangle", async () => {
        const { scene, slots, land } = setup({ scale: 2, originX: 0, originY: 0 });
        // 16 × 8 document; the reference covers x −4..12 and y 2..10 in document pixels.
        scene.references = [
            reference("r1", image(16, 8), { x: -4, y: 2, placement: "front", opacity: 255 }),
        ];
        slots.sync();
        await land();
        const [quad] = slots.quads();
        expect(quad).toMatchObject({
            layer: QUAD_LAYER.referenceFront,
            alpha: 1,
            width: 24,
            height: 12,
            x: 12,
            y: 4 + 6,
            u: 0.25,
            v: 0,
            uw: 0.75,
            vh: 0.75,
        });
    });

    it("resamples to a new size on screen only once it has held for 100 ms; the old texture is drawn meanwhile", async () => {
        const { scene, slots, uploads, land } = setup();
        const source = image(64, 64);
        scene.references = [reference("r1", source, { scale: 0.25 })];
        slots.sync();
        await land();
        expect(uploads()).toEqual(["ed:ref:0<64x64@64x64"]);

        // Zooming through steps: each a new size, none held for 100 ms.
        for (const scale of [2, 3]) {
            scene.view = { ...scene.view, scale };
            slots.sync();
            expect(slots.waiting).toBe(true);
            vi.advanceTimersByTime(RESAMPLE_QUIET_MS - 1);
            await settle();
            // The texture uploaded before stays, drawn over the new rectangle.
            expect(slots.quads()[0]).toMatchObject({ texture: "ed:ref:0", width: 16 * scale });
        }
        expect(uploads()).toHaveLength(1);
        // At 8×: 128 × 128 on screen, more than the 64 px source: the source as is, which the
        // slot holds, so nothing waits.
        scene.view = { ...scene.view, scale: 8 };
        slots.sync();
        expect(slots.waiting).toBe(false);
        vi.advanceTimersByTime(RESAMPLE_QUIET_MS);
        await land();
        expect(uploads()).toEqual(["ed:ref:0<64x64@64x64"]);
        scene.view = { ...scene.view, scale: 2 };
        slots.sync();
        vi.advanceTimersByTime(RESAMPLE_QUIET_MS);
        await land();
        expect(uploads()).toEqual(["ed:ref:0<64x64@64x64", "ed:ref:0<64x64@32x32"]);
        expect(slots.shown()[0]).toEqual({ layerId: "r1", width: 32, height: 32 });
    });

    it("gives a removed reference's slot the 1×1 placeholder, once, and never draws another layer's texture", async () => {
        const { scene, slots, uploads, land } = setup();
        const first = reference("r1", image(4, 4));
        scene.references = [first];
        slots.sync();
        await land();
        scene.references = [];
        slots.sync();
        slots.sync();
        await land();
        expect(uploads()).toEqual(["ed:ref:0<4x4@4x4", "ed:ref:0<placeholder"]);
        expect(slots.shown()).toEqual([null, null, null, null]);

        // Another layer takes the slot: until its upload resolves, the slot is not drawn.
        scene.references = [reference("r2", image(2, 2))];
        slots.sync();
        await settle();
        expect(slots.quads()).toEqual([]);
        await land();
        expect(slots.quads().map((quad) => quad.texture)).toEqual(["ed:ref:0"]);
    });

    it("keeps one slot per layer, four at most, and draws nothing of an earlier document", async () => {
        const { scene, slots, uploads, land } = setup();
        scene.references = ["a", "b", "c", "d"].map((id) => reference(id, image(2, 2)));
        slots.sync();
        await land();
        expect([...uploads()].sort()).toEqual([
            "ed:ref:0<2x2@2x2",
            "ed:ref:1<2x2@2x2",
            "ed:ref:2<2x2@2x2",
            "ed:ref:3<2x2@2x2",
        ]);
        expect(slots.quads()).toHaveLength(4);
        // Another document (the viewport raises the epoch): the old textures are not drawn.
        scene.epoch++;
        expect(slots.quads()).toEqual([]);
        // A layer's opacity of 0 draws nothing.
        scene.epoch--;
        scene.references = scene.references!.map((ref, index) =>
            index === 0 ? { ...ref, opacity: 0 } : ref,
        );
        expect(slots.quads()).toHaveLength(3);
    });

    it("moves a layer to a free slot when its slot's upload fails for good", async () => {
        const { scene, slots, renderer, uploads, events } = setup();
        scene.references = [reference("r1", image(2, 2))];
        slots.sync();
        await settle();
        renderer.inFlight("ed:ref:0").reject(new Error("device says no"));
        await settle();
        slots.failed("ed:ref:0");
        slots.sync();
        await settle();
        expect(uploads()).toEqual(["ed:ref:0<2x2@2x2", "ed:ref:1<2x2@2x2"]);
        expect(events).toEqual([]);
    });
});
