import { describe, expect, it } from "vitest";
import { createFloatingState, TRANSFORM_LABEL } from "../../src/app/selection/floatingState";
import type { FloatShown, FloatingState } from "../../src/app/selection/floatingState";
import { createMoveTool, MOVE_TOOL_ID } from "../../src/app/selection/move/moveTool";
import { HANDLE_REACH, ROTATE_REACH } from "../../src/app/selection/transform/handles";
import {
    createTransformBoxLayer,
    TRANSFORM_BOX_ORDER,
} from "../../src/app/selection/transform/transformBox.overlay";
import { overlayLayers } from "../../src/app/overlay/overlayLayers";
import type { PointerInput } from "../../src/app/tools/pipeline";
import { createStrokeEcho } from "../../src/app/tools/strokeEcho";
import { createViewMapping } from "../../src/app/view/coordinates";
import { MAX_TRANSFORM_SIDE } from "../../src/core/floating";
import type { FreeTransform } from "../../src/core/floating";
import { celAt, celKey, createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import { rectMask, selectionOf } from "../../src/core/selection";
import { harness } from "./se-014-support";
import type { Harness } from "./se-014-support";

// SE-033: the free transform of a floating selection through the Move tool and the app's
// floating state (DESIGN §5.2, §6). A drag of a handle scales the float, a drag in the ring
// outside its box turns it, and either gives exactly what the same values set directly give
// (the context bar's way); Escape takes back that drag only; the float stays one step until it
// is applied, recorded as "Transform", and a cancel puts the cel back byte for byte. The
// overlay draws the box only while a selection floats in the document it shows.

const W = 12;
const H = 10;
const SCALE = 8;

function pattern(): PixelBuffer {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            data.set([15 + x * 19, 15 + y * 23, (x * 11 + y * 7) & 255, 255], (y * W + x) * 4);
        }
    }
    return { width: W, height: H, data };
}

interface Setup {
    h: Harness;
    floating: FloatingState;
    session: DocSession;
}

function setUp(ratio = 1): Setup {
    const h = harness();
    let version = 0;
    const floating = createFloatingState({
        sessions: h.sessions,
        composites: h.composites,
        viewport: { invalidate: (keys) => void h.invalidated.push(keys) },
        nextFrame: h.frames.request,
        echo: createStrokeEcho({ nextVersion: () => ++version }),
        context: () => undefined,
        onError: (error) => void h.errors.push(error),
    });
    h.registry.register(createMoveTool({ floating, ratio: () => ratio }), "test");
    h.tools.select(MOVE_TOOL_ID);
    const session = createDocument({ name: "t", width: W, height: H }, sequentialIds("t-"));
    session.doc.images.set("img", pattern());
    session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
        imageId: "img",
        opacity: 255,
    });
    h.open(session, { scale: SCALE, originX: 0, originY: 0 });
    return { h, floating, session };
}

function bytes(session: DocSession): number[] {
    const cel = celAt(session.doc, session.activeLayerId, session.activeFrameId)!;
    return Array.from(session.doc.images.get(cel.imageId)!.data);
}

/** A pointer input at document position `x, y` (with its fraction), ratio 1. */
function point(x: number, y: number, fields: Partial<PointerInput> = {}): PointerInput {
    return {
        pointerId: 1,
        button: -1,
        buttons: 1,
        clientX: x * SCALE,
        clientY: y * SCALE,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        timeStamp: 0,
        ...fields,
    };
}

/** A drag from document position `from` through `to`, the button released at the last. */
function drag(
    h: Harness,
    from: [number, number],
    to: readonly [number, number][],
    fields: Partial<PointerInput> = {},
): void {
    h.pipeline.down(point(...from, { ...fields, button: 0, buttons: 1 }));
    for (const at of to) h.pipeline.move([point(...at, { ...fields })]);
    const last = to.at(-1) ?? from;
    h.pipeline.up(point(...last, { ...fields, button: 0, buttons: 0 }));
}

const RECT = { x: 3, y: 2, width: 4, height: 3 };

/** Selects RECT and lifts it with a drag that ends where it began. */
function lift(setup: Setup): void {
    setup.session.selection = selectionOf(rectMask(W, H, RECT));
    drag(setup.h, [4.5, 3.5], [[4.5, 3.5]]);
    expect(setup.floating.floats()).toBe(true);
}

/** The cel after the float of a fresh setup is given `transform` directly, then applied. */
function typed(transform: FreeTransform): number[] {
    const setup = setUp();
    lift(setup);
    setup.floating.setTransform(transform);
    setup.floating.apply();
    return bytes(setup.session);
}

describe("a free transform dragged with the Move tool", () => {
    it("a drag of the south-east handle scales the float; the same values set directly give the same cel", () => {
        const setup = setUp();
        const { h, floating, session } = setup;
        const before = bytes(session);
        lift(setup);
        // From the corner (7, 5) to (11, 8): the box grows to 8 × 6 from its top-left.
        drag(
            h,
            [7, 5],
            [
                [9.2, 6.3],
                [11.1, 7.8],
            ],
        );
        expect(floating.float?.transform).toEqual({ ...RECT, width: 8, height: 6, angle: 0 });
        expect(floating.shown.getState().transform).toEqual({
            ...RECT,
            width: 8,
            height: 6,
            angle: 0,
        });
        expect(h.document().history.undoCount).toBe(0);
        floating.apply();
        const { history } = h.document();
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe(TRANSFORM_LABEL);
        expect(bytes(session)).toEqual(typed({ ...RECT, width: 8, height: 6, angle: 0 }));
        history.undo();
        expect(bytes(session)).toEqual(before);
        expect(session.selection?.bounds).toEqual(RECT);
        expect(h.errors).toEqual([]);
    });

    it("Shift keeps the aspect ratio, also when it is pressed during the drag", () => {
        const setup = setUp();
        const { h, floating } = setup;
        lift(setup);
        h.pipeline.down(point(7, 5, { button: 0, buttons: 1 }));
        h.pipeline.move([point(15, 6)]);
        expect(floating.float?.transform).toEqual({ ...RECT, width: 12, height: 4, angle: 0 });
        h.pipeline.key({
            type: "down",
            key: "Shift",
            shiftKey: true,
            ctrlKey: false,
            altKey: false,
            metaKey: false,
            repeat: false,
        });
        expect(floating.float?.transform).toEqual({ ...RECT, width: 12, height: 9, angle: 0 });
        h.pipeline.up(point(15, 6, { button: 0, buttons: 0, shiftKey: true }));
        expect(floating.float?.transform).toEqual({ ...RECT, width: 12, height: 9, angle: 0 });
    });

    it("a drag in the ring outside the box turns it about its centre; Shift snaps to 15°; the same angle set directly gives the same cel", () => {
        const setup = setUp();
        const { h, floating, session } = setup;
        const before = bytes(session);
        lift(setup);
        // The centre is (5, 3.5). Start just right of the box, sweep 90° clockwise (to below).
        const ring = (ROTATE_REACH / SCALE) * 0.5;
        drag(
            h,
            [7 + ring, 3.5],
            [
                [6.5, 6],
                [5.2, 3.5 + 2 + ring],
            ],
            { shiftKey: true },
        );
        expect(floating.float?.transform).toEqual({ ...RECT, angle: 90 });
        floating.apply();
        expect(bytes(session)).toEqual(typed({ ...RECT, angle: 90 }));
        h.document().history.undo();
        expect(bytes(session)).toEqual(before);

        // Without Shift, whole degrees.
        const free = setUp();
        lift(free);
        drag(free.h, [7 + ring, 3.5], [[7 + ring, 4.5]]);
        const angle = free.floating.float!.transform.angle;
        expect(Number.isInteger(angle)).toBe(true);
        expect(angle).toBeGreaterThan(0);
        expect(angle % 15).not.toBe(0);
    });

    it("a pointer cancel during a handle drag takes back that drag only: the transform and the label as before it", () => {
        const setup = setUp();
        const { h, floating, session } = setup;
        lift(setup);
        drag(h, [7, 5], [[9, 6]]);
        const kept = floating.float!.transform;
        const shown = bytes(session);
        // Just outside the north-west corner: its handle, not a pixel of the float.
        h.pipeline.down(point(2.95, 1.95, { button: 0, buttons: 1 }));
        h.pipeline.move([point(1, 0)]);
        expect(floating.float!.transform).toEqual({ x: 1, y: 0, width: 8, height: 6, angle: 0 });
        h.pipeline.cancel();
        expect(floating.float!.transform).toEqual(kept);
        expect(bytes(session)).toEqual(shown);
        expect(floating.floats()).toBe(true);

        // A float only moved, whose handle drag is taken back, is still a Move.
        const moved = setUp();
        lift(moved);
        moved.h.pipeline.down(point(7, 5, { button: 0, buttons: 1 }));
        moved.h.pipeline.move([point(9, 6)]);
        moved.h.pipeline.cancel();
        expect(moved.floating.float!.label).toBe("Move");
        moved.floating.apply();
        expect(moved.h.document().history.undoCount).toBe(0);
    });

    it("a press on a pixel of the float drags it even on a handle; a press beyond the ring applies it", () => {
        const setup = setUp();
        const { h, floating } = setup;
        lift(setup);
        // Inside the corner pixel (6, 4), within reach of the south-east handle: a move.
        const inside = 7 - (HANDLE_REACH / SCALE) * 0.5;
        drag(h, [inside, inside - 2], [[inside + 1, inside - 1]]);
        expect(floating.float?.transform).toEqual({ ...RECT, x: 4, y: 3, angle: 0 });
        // Beyond the ring: applied, nothing more.
        drag(h, [0.5, 9.5], [[2.5, 9.5]]);
        expect(floating.floats()).toBe(false);
        expect(h.document().history.undoLabel).toBe("Move");
    });

    it("handles and the ring are sized in CSS pixels: at a ratio of 2 they reach twice as far", () => {
        const one = setUp(1);
        lift(one);
        const far = 7 + (ROTATE_REACH * 1.5) / SCALE;
        one.h.pipeline.down(point(far, 3.5, { button: 0, buttons: 1 }));
        expect(one.floating.floats()).toBe(false);
        one.h.pipeline.up(point(far, 3.5, { button: 0, buttons: 0 }));

        const two = setUp(2);
        lift(two);
        drag(two.h, [far, 3.5], [[5, 3.5 + 6]]);
        expect(two.floating.floats()).toBe(true);
        expect(two.floating.float!.transform.angle).not.toBe(0);
    });

    it("a handle dragged far past the size limit stops at it: no error, the float still floating (review A)", () => {
        const setup = setUp();
        const { h, floating } = setup;
        lift(setup);
        // The east handle, at the middle of the right side (7, 3.5), dragged 5000 px out.
        drag(
            h,
            [7, 3.5],
            [
                [2000, 3.5],
                [5007, 3.5],
            ],
        );
        expect(h.errors).toEqual([]);
        expect(floating.floats()).toBe(true);
        expect(floating.float!.transform).toEqual({ ...RECT, width: MAX_TRANSFORM_SIDE, angle: 0 });
        // With Shift on a corner both sides stop where the longer one meets the limit.
        const aspect = setUp();
        lift(aspect);
        drag(aspect.h, [7, 5], [[5000, 6]], { shiftKey: true });
        expect(aspect.h.errors).toEqual([]);
        expect(aspect.floating.float!.transform).toEqual({
            ...RECT,
            width: MAX_TRANSFORM_SIDE,
            height: (MAX_TRANSFORM_SIDE * RECT.height) / RECT.width,
            angle: 0,
        });
        expect(aspect.floating.floats()).toBe(true);
    });

    it("is labelled Transform only while it differs by more than a move: flips that cancel out leave a Move (review H)", () => {
        const setup = setUp();
        const { h, floating } = setup;
        lift(setup);
        floating.flip("horizontal");
        expect(floating.float!.label).toBe(TRANSFORM_LABEL);
        floating.flip("horizontal");
        expect(floating.float!.label).toBe("Move");
        floating.flip("horizontal");
        floating.flip("vertical");
        // Both flips: a half turn.
        expect(floating.float!.label).toBe(TRANSFORM_LABEL);
        floating.rotate(2);
        expect(floating.float!.label).toBe("Move");
        floating.rotate(1);
        floating.rotate(-1);
        expect(floating.float!.label).toBe("Move");
        floating.setTransform({ ...floating.float!.transform, angle: 30 });
        expect(floating.float!.label).toBe(TRANSFORM_LABEL);
        floating.setTransform({ ...floating.float!.transform, angle: 0 });
        expect(floating.float!.label).toBe("Move");
        floating.moveBy(1, 0);
        floating.apply();
        expect(h.document().history.undoLabel).toBe("Move");
    });

    it("the box follows a nudge, and a cancel after transforms puts the cel back byte for byte", () => {
        const setup = setUp();
        const { h, floating, session } = setup;
        const before = bytes(session);
        lift(setup);
        floating.rotate(1);
        floating.flip("vertical");
        floating.setTransform({ x: 2, y: 1, width: 5, height: 7, angle: 20 });
        floating.moveBy(1, 1);
        expect(floating.shown.getState().transform).toEqual({
            x: 3,
            y: 2,
            width: 5,
            height: 7,
            angle: 20,
        });
        expect(floating.cancel()).toBe(true);
        expect(bytes(session)).toEqual(before);
        expect(session.selection?.bounds).toEqual(RECT);
        expect(h.document().history.undoCount).toBe(0);
        expect(floating.shown.getState().transform).toBeNull();
    });
});

describe("the transform box on the overlay", () => {
    /** A 2D context that records the rectangles and lines it is given. */
    function recorder() {
        const calls: string[] = [];
        const context = {
            beginPath: () => calls.push("beginPath"),
            moveTo: (x: number, y: number) => calls.push(`moveTo ${x} ${y}`),
            lineTo: (x: number, y: number) => calls.push(`lineTo ${x} ${y}`),
            closePath: () => calls.push("closePath"),
            stroke: () => calls.push("stroke"),
            rect: (x: number, y: number, w: number, h: number) =>
                calls.push(`rect ${x} ${y} ${w} ${h}`),
            fill: () => calls.push("fill"),
        } as unknown as CanvasRenderingContext2D;
        return { context, calls };
    }

    it("is registered over the ants and the pending shape, under the brush cursor", () => {
        const layer = overlayLayers.find((entry) => entry.id === "transform-box");
        expect(layer?.order).toBe(TRANSFORM_BOX_ORDER);
        const order = (id: string) => overlayLayers.find((entry) => entry.id === id)?.order ?? NaN;
        expect(TRANSFORM_BOX_ORDER).toBeGreaterThan(order("selection-preview"));
        expect(TRANSFORM_BOX_ORDER).toBeLessThan(order("brush-cursor"));
    });

    it("draws the box and its eight handles only while a selection floats in the document shown", () => {
        const setup = setUp();
        const { h, floating, session } = setup;
        const layer = createTransformBoxLayer(floating.shown);
        let redraws = 0;
        const stop = layer.watch!(() => void redraws++);
        const frame = () => {
            const { context, calls } = recorder();
            const document = h.document();
            const mapping = createViewMapping({
                view: document.view,
                docWidth: W,
                docHeight: H,
                ratio: 1,
                left: 0,
                top: 0,
            });
            layer.draw({
                context,
                size: { width: 200, height: 200 },
                document,
                mapping,
                cursor: null,
                theme: { outline: 0, ink: 0xffffff },
            });
            return calls;
        };
        expect(frame()).toEqual([]);
        lift(setup);
        expect(redraws).toBeGreaterThan(0);
        const calls = frame();
        // The outline through the four corners of RECT at 8×, half a pixel in.
        expect(calls.filter((call) => /^(moveTo|lineTo)/.test(call))).toEqual([
            "moveTo 23.5 15.5",
            "lineTo 55.5 15.5",
            "lineTo 55.5 39.5",
            "lineTo 23.5 39.5",
        ]);
        // Eight handles, each a dark square and a light one inside it.
        expect(calls.filter((call) => call.startsWith("rect"))).toHaveLength(16);

        // Another document shown: nothing.
        const other: FloatShown = {
            ...floating.shown.getState(),
            session: createDocument({ name: "o", width: 2, height: 2 }),
        };
        const otherLayer = createTransformBoxLayer({
            getState: () => other,
            subscribe: () => () => undefined,
        } as never);
        const { context, calls: none } = recorder();
        otherLayer.draw({
            context,
            size: { width: 200, height: 200 },
            document: h.document(),
            mapping: createViewMapping({
                view: h.document().view,
                docWidth: W,
                docHeight: H,
                ratio: 1,
                left: 0,
                top: 0,
            }),
            cursor: null,
            theme: { outline: 0, ink: 0xffffff },
        });
        expect(none).toEqual([]);

        floating.apply();
        expect(frame()).toEqual([]);
        expect(session.selection).not.toBeNull();
        stop();
    });

    it("draws nothing for a whole cel lifted with no selection", () => {
        const setup = setUp();
        const { h, floating } = setup;
        h.pipeline.down(point(4.5, 4.5, { button: 0, buttons: 1 }));
        expect(floating.floats()).toBe(true);
        expect(floating.shown.getState().selects).toBe(false);
        h.pipeline.up(point(4.5, 4.5, { button: 0, buttons: 0 }));
        expect(floating.floats()).toBe(false);
    });
});
