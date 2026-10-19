import { describe, expect, it } from "vitest";
import type { PixelBuffer } from "../../src/core/model";
import {
    blitCell,
    cellOrigin,
    cellUv,
    createGridImage,
    PLAY_GRID_MAX_BYTES,
    playGridLayout,
} from "../../src/engine/viewport/playGrid";
import type { ViewportDocument } from "../../src/engine/viewport/types";
import {
    FRAME_SLOT_COUNT,
    PLAY_SLOT,
    replaceSceneDocument,
    ViewportSlots,
} from "../../src/engine/viewport/viewportSlots";
import type { Scene } from "../../src/engine/viewport/viewportSlots";
import { bitmap, FakeRenderer, flush } from "./se-011-support";

// SE-024: the display path of editor playback in the viewport's slots (SPEC §6.4). The
// playing range is blitted into one `ed:play` grid when it fits and each frame is drawn as a
// UV sub-rectangle of it; otherwise playback steps through the 8-slot frame cache and shows
// the newest ready frame, never the checkerboard alone and never a frame played before the
// one on screen. No NGNE and no DOM: the renderer is a stand-in.

describe("playGridLayout: the ed:play grid", () => {
    it("lays 64 frames of 256×256 out in a square of 2048×2048 (16 MB)", () => {
        expect(playGridLayout(64, 256, 256)).toEqual({
            count: 64,
            columns: 8,
            rows: 8,
            cellWidth: 256,
            cellHeight: 256,
            width: 2048,
            height: 2048,
        });
    });

    it("keeps a grid of wide or tall cells about square, and every cell inside", () => {
        for (const [count, width, height] of [
            [5, 64, 16],
            [7, 3, 200],
            [1, 8192, 8192],
            [100, 1, 1],
        ] as const) {
            const layout = playGridLayout(count, width, height, {
                side: 8192,
                bytes: Number.MAX_SAFE_INTEGER,
            });
            expect(layout, `${count} × ${width}×${height}`).not.toBeNull();
            const { columns, rows } = layout!;
            expect(columns * rows).toBeGreaterThanOrEqual(count);
            expect(columns * rows - count).toBeLessThan(columns);
            const last = cellOrigin(layout!, count - 1);
            expect(last.x + width).toBeLessThanOrEqual(layout!.width);
            expect(last.y + height).toBeLessThanOrEqual(layout!.height);
            expect(layout!.width).toBeLessThanOrEqual(8192);
            expect(layout!.height).toBeLessThanOrEqual(8192);
        }
    });

    it("does not fit past 64 MB or a side of 8192", () => {
        // 16 frames of 1024² are exactly 64 MB; one more is not.
        expect(playGridLayout(16, 1024, 1024)).not.toBeNull();
        expect(16 * 1024 * 1024 * 4).toBe(PLAY_GRID_MAX_BYTES);
        expect(playGridLayout(17, 1024, 1024)).toBeNull();
        expect(playGridLayout(1, 8193, 1)).toBeNull();
        expect(playGridLayout(2, 1, 8192)).not.toBeNull();
        // Too many cells for the sides even when the bytes would fit.
        expect(playGridLayout(64, 1024, 1024, { side: 8192, bytes: Infinity })).not.toBeNull();
        expect(playGridLayout(65, 1024, 1024, { side: 8192, bytes: Infinity })).toBeNull();
        expect(playGridLayout(0, 4, 4)).toBeNull();
    });

    it("gives each cell's UV sub-rectangle and copies a frame into its cell", () => {
        const layout = playGridLayout(5, 2, 3)!;
        expect(layout).toMatchObject({ columns: 3, rows: 2, width: 6, height: 6 });
        expect(cellUv(layout, 4)).toEqual({ u: 2 / 6, v: 3 / 6, uw: 2 / 6, vh: 3 / 6 });
        const grid = createGridImage(layout);
        const frame: PixelBuffer = {
            width: 2,
            height: 3,
            data: Uint8ClampedArray.from({ length: 24 }, (_, index) => index + 1),
        };
        expect(blitCell(grid, layout, 4, frame)).toBe(true);
        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 6; x++) {
                const at = (y * 6 + x) * 4;
                const inside = x >= 2 && x < 4 && y >= 3;
                const expected = inside ? ((y - 3) * 2 + (x - 2)) * 4 + 1 : 0;
                expect(grid.data[at], `${x},${y}`).toBe(expected);
            }
        }
        expect(
            blitCell(grid, layout, 0, { width: 3, height: 3, data: new Uint8ClampedArray(36) }),
        ).toBe(false);
    });
});

/** A document whose frames are `keys`, each one opaque colour: red = 10 × its index + 10. */
function playDocument(keys: readonly string[], width: number, height: number) {
    const asked: string[] = [];
    let version = 0;
    const document: ViewportDocument & { setVersion(next: number): void } = {
        width,
        height,
        pixels(key) {
            asked.push(key);
            const index = keys.indexOf(key);
            if (index === -1) return null;
            const data = new Uint8ClampedArray(width * height * 4);
            for (let at = 0; at < data.length; at += 4) data.set([10 * index + 10, 0, 0, 255], at);
            return { width, height, data };
        },
        version: () => version,
        setVersion(next) {
            version = next;
        },
    };
    return { document, asked };
}

function setup() {
    const renderer = new FakeRenderer();
    const scene: Scene = {
        document: null,
        epoch: 0,
        current: null,
        view: { scale: 1, originX: 0, originY: 0 },
        checker: { a: 0x111111, b: 0x222222, size: 2 },
        background: 0,
    };
    /** The pixels behind each bitmap, by label. */
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
    const api = {
        scene,
        slots,
        renderer,
        /** The slot of each `texture()` call so far. */
        ids: () => renderer.calls.map((call) => call.id),
        /** Resolves every upload, also those started by the ones before, until all rest. */
        async land() {
            for (;;) {
                await flush();
                if (settled >= renderer.calls.length) return;
                while (settled < renderer.calls.length) renderer.calls[settled++]?.resolve();
            }
        },
        /** Resolves the uploads in flight now, in order, and nothing that they start. */
        async landNow() {
            await flush();
            const now = renderer.calls.length;
            while (settled < now) renderer.calls[settled++]?.resolve();
            await flush();
        },
        /** Starts what was requested and leaves it in flight. */
        async start() {
            await flush();
        },
        /** Marks the calls made so far as settled by the test itself. */
        skip() {
            settled = renderer.calls.length;
        },
        open(document: ViewportDocument, current: string) {
            replaceSceneDocument(scene, document);
            slots.documentChanged();
            scene.current = current;
            slots.sync();
        },
        play(keys: readonly string[] | null) {
            scene.playing = keys;
            slots.sync();
        },
        step(key: string) {
            scene.current = key;
            slots.sync();
        },
        /** The frame quad drawn now: its texture, and the red of its frame's pixels. */
        frameQuad() {
            const quad = slots.quads().find((entry) => entry.layer === 4);
            return quad ?? null;
        },
        /** The pixels a texture call uploaded. */
        uploaded(index: number): PixelBuffer {
            const call = renderer.calls[index]!;
            return sources.get(call.source.label)!;
        },
    };
    return api;
}

const KEYS = ["a", "b", "c", "d", "e", "f", "g", "h"];

describe("ViewportSlots: playback from the ed:play grid", () => {
    it("blits the playing range into ed:play and draws each frame as its UV sub-rectangle", async () => {
        const view = setup();
        const { document } = playDocument(KEYS, 4, 2);
        view.open(document, "a");
        await view.land();
        const before = view.renderer.calls.length;

        document.setVersion(7);
        view.play(KEYS);
        await view.land();
        expect(view.ids().slice(before)).toEqual([PLAY_SLOT]);
        // A grid of 2 × 4 cells of 4×2, about square, each frame's colour in its cell.
        const grid = view.uploaded(before);
        expect(grid).toMatchObject({ width: 8, height: 8 });
        for (const [index] of KEYS.entries()) {
            const x = (index % 2) * 4;
            const y = Math.floor(index / 2) * 2;
            for (const [dx, dy] of [
                [0, 0],
                [3, 1],
            ] as const) {
                const at = ((y + dy) * 8 + x + dx) * 4;
                expect(grid.data[at], KEYS[index]).toBe(10 * index + 10);
            }
        }
        expect(view.slots.playGrid()?.keys.sort()).toEqual(KEYS);

        // Every step of the range is drawn from ed:play, uploading nothing.
        for (const [index, key] of KEYS.entries()) {
            view.step(key);
            await view.land();
            const quad = view.frameQuad()!;
            const { u, v, uw, vh } = cellUv(playGridLayout(8, 4, 2)!, index);
            expect(quad).toEqual({
                texture: PLAY_SLOT,
                layer: 4,
                x: 2,
                y: 1,
                width: 4,
                height: 2,
                u,
                v,
                uw,
                vh,
            });
            // Reported as the frame drawn, with the version of the grid's pixels (SPEC §6.6).
            expect(view.slots.drawnFrame()).toEqual({ key, width: 4, height: 2, version: 7 });
        }
        expect(view.renderer.calls.length).toBe(before + 1);
    });

    it("steps through the frame cache until the grid has been uploaded", async () => {
        const view = setup();
        const { document } = playDocument(KEYS, 4, 2);
        view.open(document, "a");
        await view.land();
        const before = view.renderer.calls.length;
        view.play(KEYS);
        await view.start();
        view.skip();
        // ed:play in flight: "b" is uploaded into a frame slot and drawn from there.
        view.step("b");
        await view.landNow();
        expect(view.ids().slice(before)).toEqual([PLAY_SLOT, "ed:f:1"]);
        expect(view.frameQuad()?.texture).toBe("ed:f:1");
        view.renderer.inFlight(PLAY_SLOT).resolve();
        await flush();
        expect(view.frameQuad()?.texture).toBe(PLAY_SLOT);
    });

    it("after playback, a change of the frame on screen keeps its cell until a slot holds it", async () => {
        const view = setup();
        const { document } = playDocument(KEYS, 4, 2);
        view.open(document, "a");
        await view.land();
        view.play(KEYS);
        await view.land();
        view.step("f");
        await view.land();
        view.play(null);
        // A stroke right after the pause: "f" changes before its slot has it.
        view.slots.invalidate(["f"]);
        await view.start();
        view.skip();
        expect(view.frameQuad()?.texture).toBe(PLAY_SLOT);
        expect(view.slots.drawnFrame()?.key).toBe("f");
        view.renderer.inFlight("ed:f:1").resolve();
        await view.land();
        expect(view.frameQuad()?.texture).toBe("ed:f:1");
        expect(view.slots.drawnFrame()?.key).toBe("f");
        expect(view.slots.playGrid()).toBeNull();
    });

    it("keeps the grid after playback stops until a frame slot shows the frame, then frees ed:play", async () => {
        const view = setup();
        const { document } = playDocument(KEYS, 4, 2);
        view.open(document, "a");
        await view.land();
        view.play(KEYS);
        await view.land();
        view.step("e");
        await view.land();
        const before = view.renderer.calls.length;

        view.play(null);
        await view.start();
        view.skip();
        // "e" loads into a slot; meanwhile it is still drawn from the grid, not frame "a".
        expect(view.ids().slice(before)).toEqual(["ed:f:1"]);
        expect(view.frameQuad()?.texture).toBe(PLAY_SLOT);
        expect(view.slots.drawnFrame()?.key).toBe("e");
        view.renderer.inFlight("ed:f:1").resolve();
        await view.land();
        expect(view.frameQuad()?.texture).toBe("ed:f:1");
        // ed:play gets the 1×1 image (SPEC §6.4: slots that become unused).
        expect(view.ids().slice(before)).toEqual(["ed:f:1", PLAY_SLOT]);
        expect(view.uploaded(view.renderer.calls.length - 1)).toMatchObject({
            width: 1,
            height: 1,
        });
        expect(view.slots.playGrid()).toBeNull();
    });

    it("takes a frame whose pixels changed from the frame cache and builds the grid again", async () => {
        const view = setup();
        const { document } = playDocument(KEYS, 4, 2);
        view.open(document, "a");
        await view.land();
        view.play(KEYS);
        await view.land();
        view.step("c");
        await view.land();
        const before = view.renderer.calls.length;
        view.slots.invalidate(["c"]);
        expect(view.slots.playGrid()?.keys).not.toContain("c");
        await view.start();
        view.skip();
        expect(view.ids().slice(before).sort()).toEqual(["ed:f:1", PLAY_SLOT].sort());
        // Until a slot holds "c", its cell stays on screen with the previous pixels and the
        // grid's version, as a frame slot does during its upload: not another frame.
        expect(view.frameQuad()?.texture).toBe(PLAY_SLOT);
        expect(view.slots.drawnFrame()?.key).toBe("c");
        view.renderer.inFlight("ed:f:1").resolve();
        await flush();
        expect(view.frameQuad()?.texture).toBe("ed:f:1");
        view.renderer.inFlight(PLAY_SLOT).resolve();
        await flush();
        expect(view.slots.playGrid()?.keys).toContain("c");
        expect(view.frameQuad()?.texture).toBe(PLAY_SLOT);
    });
});

describe("ViewportSlots: playback through the frame cache (a range too large for ed:play)", () => {
    /** Ten frames of 8193×1: no grid side can hold one. */
    const TEN = ["k0", "k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9"];

    /** The index in `TEN` of the frame quad drawn now; -1 for none (checkerboard alone). */
    function shownIndex(view: ReturnType<typeof setup>): number {
        const drawn = view.frameQuad() ? view.slots.drawnFrame() : null;
        return drawn ? TEN.indexOf(drawn.key) : -1;
    }

    it("uploads exactly the next frame at each step of a cycle through more frames than slots", async () => {
        const view = setup();
        const { document } = playDocument(TEN, 8193, 1);
        view.open(document, "k0");
        view.play(TEN);
        await view.land();
        expect(view.ids()).not.toContain(PLAY_SLOT);
        // Two passes, each step's upload resolved before the next step.
        for (let pass = 0; pass < 2; pass++) {
            for (const [index, key] of TEN.entries()) {
                if (pass === 0 && index === 0) continue;
                const before = view.renderer.calls.length;
                view.step(key);
                await view.land();
                expect(view.renderer.calls.length - before, `${pass}:${key}`).toBe(1);
                expect(shownIndex(view)).toBe(index);
            }
        }
        expect(FRAME_SLOT_COUNT).toBe(8);
    });

    it("draws a frame that became ready while a later one loads, and not one played earlier", async () => {
        const view = setup();
        const { document } = playDocument(TEN, 8193, 1);
        view.open(document, "k0");
        view.play(TEN);
        await view.land();
        view.step("k1");
        await view.start();
        view.step("k2");
        await view.start();
        view.skip();
        const k1 = view.renderer.inFlight("ed:f:1");
        const k2 = view.renderer.inFlight("ed:f:2");
        expect(view.slots.quads().length > 0 && view.slots.drawnFrame()?.key).toBe("k0");
        // k1 is ready, k2 is not: k1 is the newest frame there is.
        k1.resolve();
        await flush();
        expect(view.slots.quads().length > 0 && view.slots.drawnFrame()?.key).toBe("k1");
        k2.resolve();
        await flush();
        expect(view.slots.quads().length > 0 && view.slots.drawnFrame()?.key).toBe("k2");

        // k3 loads; k0, played before k2, is still in a slot: k2 stays on screen.
        view.step("k3");
        await view.start();
        expect(view.slots.quads().length > 0 && view.slots.drawnFrame()?.key).toBe("k2");
        expect(view.slots.shownKeys()).toContain("k0");
    });

    it("shows the newest ready frame, never the checkerboard alone and never an older frame", async () => {
        const view = setup();
        const { document } = playDocument(TEN, 8193, 1);
        view.open(document, "k0");
        view.play(TEN);
        await view.land();
        const shown: number[] = [shownIndex(view)];
        // Steps come faster than uploads: two or three steps inside each upload, uploads
        // resolving out of order now and then.
        const pending: { resolve(): void }[] = [];
        let next = 1;
        for (let round = 0; round < 40; round++) {
            const steps = 2 + (round % 2);
            for (let step = 0; step < steps; step++) {
                view.step(TEN[next % TEN.length]!);
                next++;
                await view.start();
                for (const call of view.renderer.calls.splice(0)) pending.push(call);
                shown.push(shownIndex(view));
            }
            // Resolve the newest first every third round, otherwise the oldest.
            const call = round % 3 === 0 ? pending.pop() : pending.shift();
            call?.resolve();
            await flush();
            shown.push(shownIndex(view));
        }
        // Every upload lands, also those queued behind the ones in flight.
        for (;;) {
            await flush();
            const calls = [...pending.splice(0), ...view.renderer.calls.splice(0)];
            if (calls.length === 0) break;
            for (const call of calls) call.resolve();
        }
        shown.push(shownIndex(view));
        expect(shown.join(" ")).not.toContain("-1");
        // Steps run through k0 … k9 four times and more: order is by step, so unwrap the loop.
        let lap = 0;
        const unwrapped = shown.map((index, at) => {
            if (at > 0 && index < shown[at - 1]! % TEN.length) lap++;
            return lap * TEN.length + index;
        });
        for (let at = 1; at < unwrapped.length; at++) {
            expect(unwrapped[at]!, `${shown.join(" ")}`).toBeGreaterThanOrEqual(unwrapped[at - 1]!);
        }
        // Frames were skipped, and playback still went on to the end.
        expect(new Set(shown).size).toBeGreaterThan(2);
        expect(shown.at(-1)).toBe((next - 1) % TEN.length);
    });
});
