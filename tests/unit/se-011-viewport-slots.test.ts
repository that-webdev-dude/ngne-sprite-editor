import { describe, expect, it } from "vitest";
import type { PixelBuffer } from "../../src/core/model";
import { isHealthy, swapDecision } from "../../src/engine/viewport/replacement";
import type { ViewportDocument } from "../../src/engine/viewport/types";
import {
    CHECKER_SLOT,
    frameSlotId,
    replaceSceneDocument,
    ViewportSlots,
} from "../../src/engine/viewport/viewportSlots";
import type { Scene } from "../../src/engine/viewport/viewportSlots";
import { bitmap, FakeRenderer, flush } from "./se-011-support";
import type { FakeBitmap } from "./se-011-support";

// SE-011: the texture slots of one renderer — what is uploaded for a scene, what may be
// drawn, and what happens when an image cannot be made or an upload fails — and the decision
// about a replacement renderer. No NGNE and no DOM: the renderer is a stand-in.

/** Names the images of the test documents, so an upload says what it carries. */
const labels = new WeakMap<Uint8ClampedArray, string>();

function labelOf(pixels: PixelBuffer): string {
    const named = labels.get(pixels.data);
    if (named) return named;
    const blank = pixels.width === 1 && pixels.height === 1 && pixels.data.every((b) => b === 0);
    return blank ? "blank" : `checker ${pixels.width}x${pixels.height}`;
}

interface TestDocument {
    document: ViewportDocument;
    /** Every key `pixels` was asked for, in order. */
    asked: string[];
}

/** A document whose frames are `keys`; an image is named `name/key`. */
function testDocument(name: string, keys: readonly string[], size = 4): TestDocument {
    const asked: string[] = [];
    const images = new Map<string, PixelBuffer>();
    return {
        asked,
        document: {
            width: size,
            height: size,
            pixels(key) {
                asked.push(key);
                if (!keys.includes(key)) return null;
                let image = images.get(key);
                if (!image) {
                    image = {
                        width: size,
                        height: size,
                        data: new Uint8ClampedArray(size * size * 4),
                    };
                    labels.set(image.data, `${name}/${key}`);
                    images.set(key, image);
                }
                return image;
            },
        },
    };
}

function setup(renderer = new FakeRenderer()) {
    const scene: Scene = {
        document: null,
        epoch: 0,
        current: null,
        view: { scale: 2, originX: 10, originY: 20 },
        checker: { a: 0x111111, b: 0x222222, size: 2 },
        background: 0,
    };
    const events: string[] = [];
    const made: FakeBitmap[] = [];
    const state = { rendererFailed: false, failOnce: new Set<string>() };
    const slots = new ViewportSlots(scene, {
        target: renderer,
        bitmap: async (pixels) => {
            const label = labelOf(pixels);
            if (state.failOnce.delete(label)) throw new Error(`no bitmap for ${label}`);
            const source = bitmap(label);
            made.push(source);
            return source;
        },
        rendererFailed: () => state.rendererFailed,
        onChange: () => events.push("change"),
        onError: (error) => events.push(`error: ${(error as Error).message}`),
        onStuck: () => events.push("stuck"),
        gate: () => undefined,
    });
    let landed = 0;
    return {
        scene,
        slots,
        renderer,
        events,
        made,
        state,
        /** The uploads so far, as `slot<image`. */
        uploads: () => renderer.calls.map((call) => `${call.id}<${call.source.label}`),
        /** Resolves every upload, also those started by the ones before, until all rest. */
        async land() {
            for (;;) {
                await flush();
                if (landed >= renderer.calls.length) return;
                while (landed < renderer.calls.length) renderer.calls[landed++]?.resolve();
            }
        },
        /** Leaves the uploads made so far in flight for the test to settle. */
        skip() {
            landed = renderer.calls.length;
        },
        /** Puts a document and its frame on show, as the viewport does. */
        show(document: ViewportDocument | null, current: string | null) {
            replaceSceneDocument(scene, document);
            slots.documentChanged();
            scene.current = current;
            slots.sync();
        },
        textures: () => slots.quads().map((quad) => quad.texture),
    };
}

describe("ViewportSlots: what is uploaded and what is drawn", () => {
    it("asks for the checkerboard and the current frame, and draws a slot only once its upload has resolved", async () => {
        const { slots, renderer, uploads, show, textures, events } = setup();
        const a = testDocument("A", ["a1", "a2"]);
        show(a.document, "a1");
        // Requested, not started: nothing can be drawn.
        expect(renderer.calls).toHaveLength(0);
        expect(slots.quads()).toEqual([]);

        await flush();
        expect(uploads()).toEqual(["ed:checker<checker 4x4", "ed:f:0<A/a1"]);
        // In flight: a frame that referenced these slots would be skipped by NGNE.
        expect(slots.quads()).toEqual([]);

        renderer.inFlight(CHECKER_SLOT).resolve();
        await flush();
        expect(textures()).toEqual(["ed:checker"]);
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        expect(slots.quads()).toEqual([
            { texture: "ed:checker", layer: 1, x: 14, y: 24, width: 8, height: 8 },
            { texture: "ed:f:0", layer: 4, x: 14, y: 24, width: 8, height: 8 },
        ]);
        expect(events).toEqual(["change", "change"]);
        expect(slots.shownKeys()).toEqual(["a1", null, null, null, null, null, null, null]);
        expect(frameSlotId(3)).toBe("ed:f:3");
    });

    it("keeps the frame drawn last while the next one loads, and uploads nothing for a cached frame", async () => {
        const { scene, slots, renderer, uploads, show, textures, land } = setup();
        const a = testDocument("A", ["a1", "a2"]);
        show(a.document, "a1");
        await land();
        // Drawn: this is the frame on screen.
        expect(textures()).toEqual(["ed:checker", "ed:f:0"]);

        scene.current = "a2";
        slots.sync();
        await flush();
        expect(uploads().slice(2)).toEqual(["ed:f:1<A/a2"]);
        // The second slot is reserved, not shown: the first frame stays, in full.
        expect(textures()).toEqual(["ed:checker", "ed:f:0"]);
        renderer.inFlight("ed:f:1").resolve();
        await flush();
        expect(textures()).toEqual(["ed:checker", "ed:f:1"]);

        // Both are cached now: switching draws from the other slot and uploads nothing.
        scene.current = "a1";
        slots.sync();
        await land();
        expect(textures()).toEqual(["ed:checker", "ed:f:0"]);
        expect(renderer.calls).toHaveLength(3);
        expect(a.asked).toEqual(["a1", "a2"]);
    });

    it("draws nothing without a document and only the checkerboard without a frame", async () => {
        const { slots, show, textures, uploads, land } = setup();
        slots.sync();
        await land();
        expect(uploads()).toEqual([]);
        expect(slots.quads()).toEqual([]);

        const a = testDocument("A", ["a1"]);
        show(a.document, null);
        await land();
        expect(uploads()).toEqual(["ed:checker<checker 4x4"]);
        expect(textures()).toEqual(["ed:checker"]);

        // No document again: the checkerboard slot gets the 1×1 image and is not drawn.
        show(null, null);
        await land();
        expect(uploads().slice(1)).toEqual(["ed:checker<blank"]);
        expect(slots.quads()).toEqual([]);
    });

    it("refreshes the current frame in its slot and gives the other touched frames up", async () => {
        const { scene, slots, uploads, show, textures, land } = setup();
        const a = testDocument("A", ["a1", "a2", "a3"]);
        show(a.document, "a1");
        await land();
        for (const key of ["a2", "a3"]) {
            scene.current = key;
            slots.sync();
            await land();
        }
        expect(slots.shownKeys().slice(0, 3)).toEqual(["a1", "a2", "a3"]);
        const before = uploads().length;

        // "a3" is on show: it is uploaded again. "a1" is given up, "a2" is not touched.
        slots.invalidate(["a1", "a3"]);
        expect(slots.shownKeys().slice(0, 3)).toEqual([null, "a2", "a3"]);
        await land();
        expect(uploads().slice(before).sort()).toEqual(["ed:f:0<blank", "ed:f:2<A/a3"]);
        expect(slots.shownKeys().slice(0, 3)).toEqual([null, "a2", "a3"]);
        expect(textures()).toEqual(["ed:checker", "ed:f:2"]);

        // "all": every other frame is given up; the checkerboard is as it was.
        slots.invalidate("all");
        await land();
        expect(
            uploads()
                .slice(before + 2)
                .sort(),
        ).toEqual(["ed:f:1<blank", "ed:f:2<A/a3"]);
        expect(slots.shownKeys().slice(0, 3)).toEqual([null, null, "a3"]);
    });

    it("uploads what another renderer had cached, least recently used first", async () => {
        const { slots, uploads, show, land } = setup();
        const a = testDocument("A", ["a1", "a2", "a3"]);
        show(a.document, "a3");
        slots.seed(["a1", "a2", "a3"]);
        await land();
        expect(uploads().sort()).toEqual([
            "ed:checker<checker 4x4",
            "ed:f:0<A/a3",
            "ed:f:1<A/a1",
            "ed:f:2<A/a2",
        ]);
        expect(slots.frames.keysByAge()).toEqual(["a3", "a1", "a2"]);
    });
});

describe("ViewportSlots: a document switch", () => {
    it("asks for nothing and uploads nothing for a key of the document left", async () => {
        const { scene, slots, uploads, show, textures, land } = setup();
        const a = testDocument("A", ["a1"]);
        const b = testDocument("B", ["b1"], 6);
        show(a.document, "a1");
        await land();
        expect(a.asked).toEqual(["a1"]);
        const before = uploads().length;

        // As the viewport does it: the document first, then the frame of the new one.
        replaceSceneDocument(scene, b.document);
        expect(scene.current).toBeNull();
        slots.documentChanged();
        expect(slots.frames.keysByAge()).toEqual([]);
        scene.current = "b1";
        slots.sync();
        await land();

        // The checkerboard and the frame of the new document, into the slot that was freed.
        expect(uploads().slice(before).sort()).toEqual(["ed:checker<checker 6x6", "ed:f:0<B/b1"]);
        expect(a.asked).toEqual(["a1"]);
        expect(b.asked).toEqual(["b1"]);
        expect(slots.frames.keysByAge()).toEqual(["b1"]);
        expect(textures()).toEqual(["ed:checker", "ed:f:0"]);
    });

    it("never draws an image of the document left, even under the same frame key", async () => {
        const { renderer, show, textures, land, skip, uploads } = setup();
        const first = testDocument("first", ["f1"]);
        const again = testDocument("again", ["f1"]);
        show(first.document, "f1");
        await flush();
        // The uploads of the first document are in flight when the same file is opened again.
        skip();
        show(again.document, "f1");
        const stale = renderer.calls.filter((call) => call.source.label === "first/f1");
        expect(stale).toHaveLength(1);
        for (const call of [...renderer.calls]) call.resolve();
        await flush();
        // The slot holds the first document's pixels under the key that is on show again.
        expect(textures()).toEqual([]);

        // The uploads of the second document, which waited behind them, go through.
        await land();
        expect(uploads().slice(2).sort()).toEqual(["ed:checker<checker 4x4", "ed:f:0<again/f1"]);
        expect(textures()).toEqual(["ed:checker", "ed:f:0"]);
    });
});

describe("ViewportSlots: an image that cannot be made", () => {
    it("gives the frame's reservation up, so the next sync asks again — and nothing asks before", async () => {
        const { slots, state, events, uploads, show, textures, land } = setup();
        const a = testDocument("A", ["a1"]);
        state.failOnce.add("A/a1");
        show(a.document, "a1");
        await land();
        expect(events).toContain("error: no bitmap for A/a1");
        expect(uploads()).toEqual(["ed:checker<checker 4x4"]);
        expect(slots.queue.failed("ed:f:0")).toBe(false);
        expect(slots.frames.reservedFor("a1")).toBe(-1);
        expect(textures()).toEqual(["ed:checker"]);
        // Not retried on its own: a builder that always throws would spin.
        await land();
        expect(a.asked).toEqual(["a1"]);
        expect(slots.stuck).toBe(false);

        slots.sync();
        await land();
        expect(a.asked).toEqual(["a1", "a1"]);
        expect(uploads()).toEqual(["ed:checker<checker 4x4", "ed:f:0<A/a1"]);
        expect(textures()).toEqual(["ed:checker", "ed:f:0"]);
    });

    it("stops showing a frame whose refresh could not be made and uploads it again at the next sync", async () => {
        const { slots, state, show, textures, land, uploads } = setup();
        const a = testDocument("A", ["a1"]);
        show(a.document, "a1");
        await land();
        expect(textures()).toEqual(["ed:checker", "ed:f:0"]);

        state.failOnce.add("A/a1");
        slots.invalidate(["a1"]);
        await land();
        // The slot still holds the pixels from before the change: they are not shown as "a1".
        expect(textures()).toEqual(["ed:checker"]);
        slots.sync();
        await land();
        expect(uploads().slice(2)).toEqual(["ed:f:0<A/a1"]);
        expect(textures()).toEqual(["ed:checker", "ed:f:0"]);
    });

    it("asks for the checkerboard again at the next sync", async () => {
        const { slots, state, events, uploads, show, textures, land } = setup();
        const a = testDocument("A", ["a1"]);
        state.failOnce.add("checker 4x4");
        show(a.document, "a1");
        await land();
        expect(events).toContain("error: no bitmap for checker 4x4");
        expect(uploads()).toEqual(["ed:f:0<A/a1"]);
        expect(slots.queue.failed(CHECKER_SLOT)).toBe(false);
        expect(textures()).toEqual(["ed:f:0"]);
        await land();
        expect(uploads()).toHaveLength(1);
        expect(slots.stuck).toBe(false);

        slots.sync();
        await land();
        expect(uploads()).toEqual(["ed:f:0<A/a1", "ed:checker<checker 4x4"]);
        expect(textures()).toEqual(["ed:checker", "ed:f:0"]);
        // And then it is known: another sync asks for nothing.
        slots.sync();
        await land();
        expect(uploads()).toHaveLength(2);
    });
});

describe("ViewportSlots: an upload that fails", () => {
    const rejected = new Error("WebGPU resource validation failed");

    it("moves the current frame to another slot when its slot fails", async () => {
        const { slots, renderer, events, uploads, show, textures, land, skip } = setup();
        const a = testDocument("A", ["a1"]);
        show(a.document, "a1");
        await flush();
        renderer.inFlight(CHECKER_SLOT).resolve();
        renderer.inFlight("ed:f:0").reject(rejected);
        skip();
        await land();
        expect(slots.queue.failed("ed:f:0")).toBe(true);
        expect(uploads()).toEqual(["ed:checker<checker 4x4", "ed:f:0<A/a1", "ed:f:1<A/a1"]);
        expect(textures()).toEqual(["ed:checker", "ed:f:1"]);
        expect(events.filter((event) => event !== "change")).toEqual([
            "error: WebGPU resource validation failed",
        ]);
        expect(slots.stuck).toBe(false);
    });

    it("reports the renderer stuck, once, when the checkerboard slot fails", async () => {
        const { scene, slots, renderer, events, uploads, show, land, skip } = setup();
        const a = testDocument("A", ["a1"]);
        show(a.document, "a1");
        await flush();
        renderer.inFlight(CHECKER_SLOT).reject(rejected);
        skip();
        await land();
        expect(events.filter((event) => event === "stuck")).toEqual(["stuck"]);
        expect(slots.stuck).toBe(true);

        // Nothing more reaches the slot on this renderer, and it does not ask twice.
        scene.checker = { a: 1, b: 2, size: 4 };
        slots.sync();
        slots.invalidate("all");
        await land();
        expect(uploads().filter((upload) => upload.startsWith("ed:checker"))).toHaveLength(1);
        expect(events.filter((event) => event === "stuck")).toEqual(["stuck"]);
    });

    it("reports the renderer stuck when no frame slot is left for the current frame", async () => {
        const { slots, renderer, events, uploads, show } = setup();
        const a = testDocument("A", ["a1"]);
        show(a.document, "a1");
        await flush();
        renderer.inFlight(CHECKER_SLOT).resolve();
        for (let slot = 0; slot < 8; slot++) {
            expect(slots.stuck).toBe(false);
            renderer.inFlight(frameSlotId(slot)).reject(rejected);
            await flush();
        }
        expect(uploads().filter((upload) => upload.endsWith("<A/a1"))).toHaveLength(8);
        expect(events.filter((event) => event === "stuck")).toEqual(["stuck"]);
        expect(slots.stuck).toBe(true);
        expect(slots.frames.reservedFor("a1")).toBe(-1);
    });

    it("tries no other slot on a renderer that has itself failed", async () => {
        const { slots, renderer, state, events, uploads, show, land, skip } = setup();
        const a = testDocument("A", ["a1"]);
        show(a.document, "a1");
        await flush();
        // The renderer failed: every upload is rejected with its failure.
        state.rendererFailed = true;
        const failure = new Error("WebGPU recovery failed. Reload to create a new renderer");
        renderer.inFlight("ed:f:0").reject(failure);
        renderer.inFlight(CHECKER_SLOT).reject(failure);
        skip();
        await land();
        // One call per slot that was in flight: the other seven are not walked.
        expect(uploads()).toEqual(["ed:checker<checker 4x4", "ed:f:0<A/a1"]);
        // The viewport replaces a failed renderer by itself: it is not asked to here.
        expect(events).not.toContain("stuck");
        expect(slots.stuck).toBe(false);
    });
});

describe("ViewportSlots: the end of a renderer", () => {
    it("settle() ends when the slots are disposed while uploads are in flight", async () => {
        // The renderer leaves aborted uploads in flight, as one that is being torn down may.
        const { slots, show, events } = setup(new FakeRenderer({ rejectsOnAbort: false }));
        const a = testDocument("A", ["a1"]);
        show(a.document, "a1");
        await flush();
        // A loop that spins on microtasks lets no timer fire, so the test could not even
        // time out: the waits are counted, and a spin fails here instead.
        const idle = slots.queue.idle.bind(slots.queue);
        let waits = 0;
        slots.queue.idle = () => {
            if (++waits > 1000) throw new Error("settle() spins on a disposed queue");
            return idle();
        };
        let outcome = "waiting";
        void slots.settle().then(
            () => {
                outcome = "settled";
            },
            (error: unknown) => {
                outcome = String(error);
            },
        );
        await flush();
        expect(outcome).toBe("waiting");

        slots.dispose();
        await flush();
        expect(outcome).toBe("settled");
        expect(waits).toBe(1);
        expect(slots.queue.busy()).toBe(false);
        expect(events).toEqual([]);
    });

    it("settle() resolves once every upload, also one requested meanwhile, has resolved", async () => {
        const { scene, slots, show, land } = setup();
        const a = testDocument("A", ["a1", "a2"]);
        show(a.document, "a1");
        let settled = false;
        void slots.settle().then(() => {
            settled = true;
        });
        await flush();
        scene.current = "a2";
        slots.sync();
        expect(settled).toBe(false);
        await land();
        expect(settled).toBe(true);
    });
});

describe("swapDecision: a loaded replacement", () => {
    const ready = { status: "ready", stuck: false } as const;
    const stuck = { status: "ready", stuck: true } as const;
    const recovering = { status: "recovering", stuck: false } as const;
    const failed = { status: "failed", stuck: false } as const;
    const disposed = { status: "disposed", stuck: false } as const;

    it("swaps in a renderer that can draw", () => {
        for (const old of [null, ready, stuck, recovering, failed]) {
            expect(swapDecision(ready, old)).toBe("swap");
        }
    });

    it("waits for a renderer that is recovering its device, whatever is on screen", () => {
        for (const old of [null, ready, stuck, failed]) {
            expect(swapDecision(recovering, old)).toBe("wait");
        }
        expect(swapDecision({ status: "recovering", stuck: true }, ready)).toBe("wait");
    });

    it("never puts a failed or disposed renderer on screen", () => {
        for (const old of [null, ready, stuck, recovering, failed]) {
            expect(swapDecision(failed, old)).toBe("abandon");
            expect(swapDecision(disposed, old)).toBe("abandon");
        }
    });

    it("keeps a healthy renderer rather than one that cannot show the scene in full", () => {
        expect(swapDecision(stuck, ready)).toBe("abandon");
        // Nothing better is on screen: the stuck one at least has the right size.
        for (const old of [null, stuck, recovering, failed]) {
            expect(swapDecision(stuck, old)).toBe("swap");
        }
    });

    it("calls a renderer healthy only when it is ready and not stuck", () => {
        expect(isHealthy(ready)).toBe(true);
        for (const other of [null, stuck, recovering, failed, disposed]) {
            expect(isHealthy(other)).toBe(false);
        }
    });
});
