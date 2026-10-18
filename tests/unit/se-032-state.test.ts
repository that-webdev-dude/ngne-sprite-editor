import { describe, expect, it } from "vitest";
import { createFloatingState } from "../../src/app/selection/floatingState";
import type { FloatingState } from "../../src/app/selection/floatingState";
import { createMoveTool, MOVE_HINT, MOVE_TOOL_ID } from "../../src/app/selection/move/moveTool";
import { PAINT_REFUSED } from "../../src/app/tools/paintTarget";
import { createStrokeEcho } from "../../src/app/tools/strokeEcho";
import { frameKey } from "../../src/app/viewport/viewportLink";
import { compositeFrame } from "../../src/core/composite";
import { contentOfImage } from "../../src/core/floating";
import { AllocationError } from "../../src/core/history";
import type { PixelAllocator } from "../../src/core/history";
import { celAt, celKey, createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import { rectMask, selectionOf } from "../../src/core/selection";
import { at, harness, rgbaAt, stroke } from "./se-014-support";
import type { Harness } from "./se-014-support";

// SE-032: the floating selection of the app (`floatingState.ts`) and the Move tool, through
// the pointer pipeline of SE-014 on stores of their own. The float is shown through the
// live-stroke path for as long as it lasts, over several drags: the composite cache holds the
// frame with the float, the viewport is told once per animation frame, the echo follows it;
// a composite made from the document after an eviction still shows it. The `floating`
// context is on exactly while it exists. A press outside applies it; a cancel puts the cel
// back byte for byte.

const W = 10;
const H = 8;

function pattern(): PixelBuffer {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            data.set([20 + x * 20, 20 + y * 25, (x * 11 + y * 7) & 255, 255], (y * W + x) * 4);
        }
    }
    return { width: W, height: H, data };
}

function documentWith(image: PixelBuffer | null, prefix = "m-"): DocSession {
    const session = createDocument({ name: "move", width: W, height: H }, sequentialIds(prefix));
    if (image) {
        session.doc.images.set("img", image);
        session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
            imageId: "img",
            opacity: 255,
        });
    }
    return session;
}

interface Setup {
    h: Harness;
    floating: FloatingState;
    contexts: boolean[];
    echo: ReturnType<typeof createStrokeEcho>;
    session: DocSession;
}

/** The SE-014 harness with the Move tool selected and a floating state on its stores. */
function setUp(image: PixelBuffer | null = pattern()): Setup {
    const h = harness();
    const contexts: boolean[] = [];
    let version = 0;
    const echo = createStrokeEcho({ nextVersion: () => ++version });
    const floating = createFloatingState({
        sessions: h.sessions,
        composites: h.composites,
        viewport: { invalidate: (keys) => void h.invalidated.push(keys) },
        nextFrame: h.frames.request,
        echo,
        context: (active) => void contexts.push(active),
        onError: (error) => void h.errors.push(error),
    });
    h.registry.register(createMoveTool({ floating }), "test");
    h.tools.select(MOVE_TOOL_ID);
    const session = documentWith(image);
    h.open(session);
    return { h, floating, contexts, echo, session };
}

function bytes(session: DocSession): number[] | null {
    const cel = celAt(session.doc, session.activeLayerId, session.activeFrameId);
    const image = cel ? session.doc.images.get(cel.imageId) : undefined;
    return image ? Array.from(image.data) : null;
}

/** `before` with the pixels of the rectangle moved by `dx`, `dy` (the source transparent). */
function movedRect(
    before: number[],
    rect: { x: number; y: number; width: number; height: number },
    dx: number,
    dy: number,
): number[] {
    const after = [...before];
    const inside = (x: number, y: number) =>
        x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++)
            if (inside(x, y)) after.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 4);
    }
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (!inside(x, y)) continue;
            const tx = x + dx;
            const ty = y + dy;
            if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
            const from = (y * W + x) * 4;
            after.splice((ty * W + tx) * 4, 4, ...before.slice(from, from + 4));
        }
    }
    return after;
}

describe("the Move tool", () => {
    it("lifts the selection at a press, moves it by the drag, keeps it floating; a press outside applies it as one step", () => {
        const { h, floating, contexts, session } = setUp();
        expect(h.tools.active()?.hint).toBe(MOVE_HINT);
        expect(h.tools.active()?.cursor).toBe("move");
        const rect = { x: 2, y: 3, width: 3, height: 2 };
        session.selection = selectionOf(rectMask(W, H, rect));
        const before = bytes(session)!;

        stroke(h, [
            { x: 3, y: 4 },
            { x: 5, y: 3 },
            { x: 6, y: 2 },
        ]);
        expect(floating.floats()).toBe(true);
        expect(contexts).toEqual([true]);
        expect(h.document().history.transaction).not.toBeNull();
        expect(bytes(session)).toEqual(movedRect(before, rect, 3, -2));
        expect(session.selection?.bounds).toEqual({ x: 5, y: 1, width: 3, height: 2 });

        // A second drag from a pixel of the float moves it on.
        stroke(h, [
            { x: 7, y: 2 },
            { x: 7, y: 3 },
        ]);
        expect(bytes(session)).toEqual(movedRect(before, rect, 3, -1));
        expect(h.document().history.undoCount).toBe(0);

        // A press outside applies it, and does nothing more.
        stroke(h, [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
        ]);
        expect(floating.floats()).toBe(false);
        expect(contexts).toEqual([true, false]);
        expect(bytes(session)).toEqual(movedRect(before, rect, 3, -1));
        const { history } = h.document();
        expect(history.transaction).toBeNull();
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Move");
        history.undo();
        expect(bytes(session)).toEqual(before);
        expect(session.selection?.bounds).toEqual(rect);
        expect(h.errors).toEqual([]);
    });

    it("moves the whole cel without a selection: one step per drag, applied at the release", () => {
        const { h, floating, contexts, session } = setUp();
        const before = bytes(session)!;
        stroke(h, [
            { x: 4, y: 4 },
            { x: 2, y: 5 },
        ]);
        expect(floating.floats()).toBe(false);
        expect(contexts).toEqual([true, false]);
        expect(bytes(session)).toEqual(
            movedRect(before, { x: 0, y: 0, width: W, height: H }, -2, 1),
        );
        expect(session.selection).toBeNull();
        expect(h.document().history.undoCount).toBe(1);
        // An empty cel has nothing to move: no float, no step.
        const empty = setUp(null);
        stroke(empty.h, [
            { x: 1, y: 1 },
            { x: 3, y: 3 },
        ]);
        expect(empty.contexts).toEqual([]);
        expect(empty.h.document().history.undoCount).toBe(0);
        expect(empty.session.doc.cels.size).toBe(0);
    });

    it("a cancel during the drag that lifted the float cancels the float; during a later drag it moves back", () => {
        const { h, floating, session } = setUp();
        const rect = { x: 1, y: 1, width: 2, height: 2 };
        session.selection = selectionOf(rectMask(W, H, rect));
        const before = bytes(session)!;

        h.pipeline.down(at(h, { x: 1, y: 1 }, { button: 0, buttons: 1 }));
        h.pipeline.move([at(h, { x: 4, y: 4 })]);
        expect(bytes(session)).not.toEqual(before);
        h.pipeline.cancel();
        expect(floating.floats()).toBe(false);
        expect(bytes(session)).toEqual(before);
        expect(h.document().history.transaction).toBeNull();

        stroke(h, [
            { x: 1, y: 1 },
            { x: 2, y: 1 },
        ]);
        const afterFirst = bytes(session);
        h.pipeline.down(at(h, { x: 2, y: 1 }, { button: 0, buttons: 1 }));
        h.pipeline.move([at(h, { x: 6, y: 6 })]);
        h.pipeline.cancel();
        expect(floating.floats()).toBe(true);
        expect(bytes(session)).toEqual(afterFirst);
        floating.cancel();
        expect(bytes(session)).toEqual(before);
    });

    it("is refused on a locked, hidden or reference layer, with the status bar saying so", () => {
        const { h, floating, session } = setUp();
        const layer = session.doc.layers[0]!;
        layer.locked = true;
        stroke(h, [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
        ]);
        expect(h.status.getState().feedback).toBe(PAINT_REFUSED.locked);
        expect(floating.floats()).toBe(false);
        layer.locked = false;
        layer.visible = false;
        stroke(h, [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
        ]);
        expect(h.status.getState().feedback).toBe(PAINT_REFUSED.hidden);
        expect(h.document().history.undoCount).toBe(0);
        // A reference layer (SE-046 gives the Move tool reference layers), with a selection
        // and without one.
        layer.visible = true;
        session.doc.layers.push({
            kind: "reference",
            id: "ref",
            name: "Reference",
            visible: true,
            locked: false,
            opacity: 255,
            sourceId: "src",
            x: 0,
            y: 0,
            scale: 1,
            placement: "behind",
        });
        const pixelLayer = session.activeLayerId;
        session.activeLayerId = "ref";
        const before = bytes({ ...session, activeLayerId: pixelLayer });
        for (const selection of [
            null,
            selectionOf(rectMask(W, H, { x: 1, y: 1, width: 2, height: 2 })),
        ]) {
            session.selection = selection;
            h.status.getState().setFeedback(null);
            stroke(h, [
                { x: 1, y: 1 },
                { x: 3, y: 2 },
            ]);
            expect(h.status.getState().feedback).toBe(PAINT_REFUSED.reference);
            expect(floating.floats()).toBe(false);
            expect(h.document().history.transaction).toBeNull();
        }
        expect(h.document().history.undoCount).toBe(0);
        expect(bytes({ ...session, activeLayerId: pixelLayer })).toEqual(before);
        session.activeLayerId = pixelLayer;
        session.doc.layers.pop();
        session.selection = null;
        // Below 1× it moves: whole texels, whatever a device pixel shows.
        h.sessions.getState().setView(h.document().id, { scale: 0.5 });
        expect(stroke(h, [{ x: 1, y: 1 }])).toBe(true);
        expect(h.status.getState().feedback).toBeNull();
    });

    it("moves with either button: a right-button drag lifts and moves as the left one does", () => {
        const { h, floating, session } = setUp();
        const rect = { x: 2, y: 3, width: 3, height: 2 };
        session.selection = selectionOf(rectMask(W, H, rect));
        const before = bytes(session)!;
        expect(
            stroke(
                h,
                [
                    { x: 3, y: 4 },
                    { x: 4, y: 2 },
                ],
                { button: 2 },
            ),
        ).toBe(true);
        expect(floating.floats()).toBe(true);
        expect(bytes(session)).toEqual(movedRect(before, rect, 1, -2));
        // A second right-button drag from a pixel of the float moves it on.
        stroke(
            h,
            [
                { x: 4, y: 2 },
                { x: 6, y: 3 },
            ],
            { button: 2 },
        );
        expect(bytes(session)).toEqual(movedRect(before, rect, 3, -1));
        floating.apply();
        expect(h.document().history.undoLabel).toBe("Move");
        expect(bytes(session)).toEqual(movedRect(before, rect, 3, -1));
        // Without a selection the right button moves the whole cel, applied at the release.
        const whole = bytes(session)!;
        session.selection = null;
        stroke(
            h,
            [
                { x: 5, y: 5 },
                { x: 4, y: 5 },
            ],
            { button: 2 },
        );
        expect(floating.floats()).toBe(false);
        expect(bytes(session)).toEqual(
            movedRect(whole, { x: 0, y: 0, width: W, height: H }, -1, 0),
        );
        expect(h.document().history.undoCount).toBe(2);
        expect(h.errors).toEqual([]);
    });

    it("follows the last sample of each pointer event: the float moves once per event, and a release among the samples ends the drag there", () => {
        const { h, floating, session } = setUp();
        const rect = { x: 0, y: 0, width: 2, height: 2 };
        session.selection = selectionOf(rectMask(W, H, rect));
        const before = bytes(session)!;
        h.pipeline.down(at(h, { x: 0, y: 0 }, { button: 0, buttons: 1 }));
        const float = floating.float!;
        const positions: string[] = [];
        const moveTo = float.moveTo.bind(float);
        float.moveTo = (x, y) => {
            positions.push(`${x},${y}`);
            return moveTo(x, y);
        };
        // Four coalesced samples of one event: one move, to the last.
        h.pipeline.move([
            at(h, { x: 1, y: 0 }),
            at(h, { x: 2, y: 1 }),
            at(h, { x: 3, y: 1 }),
            at(h, { x: 4, y: 2 }),
        ]);
        expect(positions).toEqual(["4,2"]);
        expect(bytes(session)).toEqual(movedRect(before, rect, 4, 2));
        // A sample whose buttons no longer hold the left one ends the drag at it.
        h.pipeline.move([
            at(h, { x: 5, y: 2 }),
            at(h, { x: 6, y: 3 }, { buttons: 0 }),
            at(h, { x: 8, y: 5 }, { buttons: 0 }),
        ]);
        expect(h.pipeline.stroking).toBe(false);
        expect(positions).toEqual(["4,2", "6,3"]);
        expect(bytes(session)).toEqual(movedRect(before, rect, 6, 3));
        expect(floating.floats()).toBe(true);
        floating.cancel();
        expect(bytes(session)).toEqual(before);
    });
});

describe("the display of a float", () => {
    it("composites the frame with the float in the cache, tells the viewport once per animation frame and survives an eviction", () => {
        const { h, floating, session } = setUp();
        const rect = { x: 0, y: 0, width: 3, height: 3 };
        session.selection = selectionOf(rectMask(W, H, rect));
        const frameId = h.document().session.doc.frames[0]!.id;
        const expected = () => Array.from(compositeFrame(session.doc, frameId).data);
        const cached = () => Array.from(h.composites.cache!.get(frameId).data);

        floating.lift(h.document());
        h.invalidated.length = 0;
        floating.moveBy(2, 2);
        floating.moveBy(1, 0);
        // The first move is shown at once, the second in the next animation frame.
        expect(h.invalidated).toEqual([[frameKey(frameId)]]);
        h.frames.run();
        expect(h.invalidated).toEqual([[frameKey(frameId)], [frameKey(frameId)]]);
        expect(cached()).toEqual(expected());

        // The cache lets every composite go (its budget, another reader): a composite made
        // from the document has the float, and the next move hands the live buffer back.
        h.composites.cache!.clear();
        expect(cached()).toEqual(expected());
        expect(rgbaAt(h.composites.cache!.get(frameId), 3, 2)).toEqual(rgbaAt(pattern(), 0, 0));
        floating.moveBy(0, 1);
        h.frames.run();
        expect(cached()).toEqual(expected());
        expect(rgbaAt(h.composites.cache!.get(frameId), 3, 3)).toEqual(rgbaAt(pattern(), 0, 0));

        floating.apply();
        h.frames.run();
        expect(cached()).toEqual(expected());
        expect(h.document().history.undoCount).toBe(1);
    });

    it("echoes the float over several drags and releases the echo when it is applied", () => {
        const { h, echo, session } = setUp();
        session.selection = selectionOf(rectMask(W, H, { x: 0, y: 0, width: 2, height: 2 }));
        stroke(h, [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
        ]);
        expect(echo.stroking).toBe(true);
        expect(echo.waiting()).toBeGreaterThan(0);
        stroke(h, [
            { x: 2, y: 0 },
            { x: 2, y: 3 },
        ]);
        expect(echo.stroking).toBe(true);
        expect(echo.target?.session).toBe(session);
        // Applied: the echo ends with its last regions drawn.
        stroke(h, [{ x: 9, y: 7 }]);
        expect(echo.stroking).toBe(false);
    });

    it("tells the session store of the moved selection once per animation frame", () => {
        const { h, floating, session } = setUp();
        session.selection = selectionOf(rectMask(W, H, { x: 0, y: 0, width: 2, height: 2 }));
        floating.lift(h.document());
        const revision = h.document().revision;
        floating.moveBy(1, 0);
        floating.moveBy(1, 0);
        floating.moveBy(1, 0);
        expect(h.document().revision).toBe(revision);
        h.frames.run();
        expect(h.document().revision).toBe(revision + 1);
        expect(h.document().session.selection?.bounds.x).toBe(3);
        floating.cancel();
    });

    it("shows a paste at once", () => {
        const { h, floating, session } = setUp(null);
        const frameId = session.doc.frames[0]!.id;
        h.invalidated.length = 0;
        const image = pattern();
        floating.paste(h.document(), contentOfImage(image), 0, 0);
        expect(h.invalidated).toEqual([[frameKey(frameId)]]);
        expect(Array.from(h.composites.cache!.get(frameId).data)).toEqual(Array.from(image.data));
        expect(session.selection?.bounds).toEqual({ x: 0, y: 0, width: W, height: H });
        floating.cancel();
        expect(session.doc.cels.size).toBe(0);
        expect(session.selection).toBeNull();
    });
});

describe("the float and its document", () => {
    it("is applied to its own document when another one becomes active, and dropped when its document closes", () => {
        const { h, floating, contexts, session } = setUp();
        const before = bytes(session)!;
        const rect = { x: 0, y: 0, width: 2, height: 2 };
        session.selection = selectionOf(rectMask(W, H, rect));
        floating.lift(h.document());
        floating.moveBy(4, 4);
        const first = h.document();
        h.open(documentWith(null, "other-"));
        expect(contexts).toEqual([true, false]);
        expect(first.history.transaction).toBeNull();
        expect(first.history.undoCount).toBe(1);
        expect(bytes(session)).toEqual(movedRect(before, rect, 4, 4));

        h.sessions.getState().activate(first.id);
        first.session.selection = selectionOf(rectMask(W, H, rect));
        floating.lift(h.document());
        floating.moveBy(1, 1);
        h.sessions.getState().close(first.id);
        expect(floating.floats(first)).toBe(false);
        expect(contexts).toEqual([true, false, true, false]);
        expect(h.errors).toEqual([]);
    });
});

// SE-032 review: how a float lands — a step of the selection alone (G), a discard (H), and the
// failures (F) — as the viewport and the editor see it.
describe("the landing of a float", () => {
    it("a step of the selection alone tells the viewport: nudged, then applied within one animation frame, the viewport reads the cel as it is", () => {
        // Transparent pixels selected beside an opaque column: moved over it they hide it,
        // moved on past it they leave everything as it was; only the selection moved.
        const image: PixelBuffer = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
        for (let y = 0; y < H; y++) image.data.set([200, 40, 10, 255], (y * W + 2) * 4);
        const { h, floating, session } = setUp(image);
        const frameId = session.doc.frames[0]!.id;
        const original = bytes(session);
        session.selection = selectionOf(rectMask(W, H, { x: 0, y: 0, width: 2, height: 2 }));
        floating.lift(h.document());
        h.invalidated.length = 0;
        floating.moveBy(1, 0);
        // Shown at once: the column's top pixels are hidden by the transparent ones.
        expect(h.invalidated).toEqual([[frameKey(frameId)]]);
        expect(rgbaAt(h.composites.cache!.get(frameId), 2, 0)).toEqual([0, 0, 0, 0]);
        floating.moveBy(4, 0);
        // In the same animation frame: not shown yet.
        expect(h.invalidated).toHaveLength(1);

        expect(floating.apply()).toBe("landed");
        const { history } = h.document();
        expect(history.undoLabel).toBe("Move");
        expect(bytes(session)).toEqual(original);
        expect(session.selection?.bounds).toEqual({ x: 5, y: 0, width: 2, height: 2 });
        // No frame was touched by the step, yet the viewport is told, and what it reads is the
        // column whole again.
        expect(h.invalidated).toEqual([[frameKey(frameId)], [frameKey(frameId)]]);
        expect(rgbaAt(h.composites.cache!.get(frameId), 2, 0)).toEqual([200, 40, 10, 255]);
        expect(Array.from(h.composites.cache!.get(frameId).data)).toEqual(
            Array.from(compositeFrame(session.doc, frameId).data),
        );
        expect(h.errors).toEqual([]);
    });

    it("a discard (Delete while floating) shows what lies under the float at once, as one step", () => {
        const { h, floating, contexts, session } = setUp();
        const frameId = session.doc.frames[0]!.id;
        const before = bytes(session)!;
        const rect = { x: 0, y: 0, width: 3, height: 3 };
        session.selection = selectionOf(rectMask(W, H, rect));
        floating.lift(h.document());
        floating.moveBy(4, 2);
        h.frames.run();
        h.invalidated.length = 0;

        expect(floating.discard("Delete")).toBe("landed");
        expect(contexts).toEqual([true, false]);
        expect(bytes(session)).toEqual(movedRect(before, rect, 100, 0));
        expect(session.selection).toBeNull();
        const { history } = h.document();
        expect(history.undoLabel).toBe("Delete");
        expect(history.undoCount).toBe(1);
        expect(h.invalidated.length).toBeGreaterThan(0);
        expect(Array.from(h.composites.cache!.get(frameId).data)).toEqual(
            Array.from(compositeFrame(session.doc, frameId).data),
        );
        // The place the float covered shows the cel as it was there.
        expect(rgbaAt(h.composites.cache!.get(frameId), 5, 3)).toEqual(rgbaAt(pattern(), 5, 3));
        expect(floating.discard("Delete")).toBe("none");
        expect(h.errors).toEqual([]);
    });

    it("a step that cannot be stored: the float is taken back and shown so, onError hears of it, and apply says it failed", () => {
        const { h, floating, contexts } = setUp(null);
        let failing = false;
        const allocate: PixelAllocator = (length) => {
            if (failing) throw new RangeError("out of memory");
            return new Uint8ClampedArray(length);
        };
        const session = documentWith(pattern(), "alloc-");
        const document = h.sessions.getState().open(session, {
            view: { scale: 8, originX: 0, originY: 0 },
            history: { allocate },
        });
        const frameId = session.doc.frames[0]!.id;
        const selection = selectionOf(rectMask(W, H, { x: 1, y: 1, width: 3, height: 2 }));
        session.selection = selection;
        const before = bytes(session);
        floating.lift(document);
        floating.moveBy(2, 2);
        failing = true;
        expect(floating.apply()).toBe("failed");
        expect(h.errors).toHaveLength(1);
        expect(h.errors[0]).toBeInstanceOf(AllocationError);
        expect(floating.floats()).toBe(false);
        expect(contexts.at(-1)).toBe(false);
        expect(bytes(session)).toEqual(before);
        expect(session.selection).toBe(selection);
        expect(document.history.undoCount).toBe(0);
        expect(document.history.transaction).toBeNull();
        expect(Array.from(h.composites.cache!.get(frameId).data)).toEqual(
            Array.from(compositeFrame(session.doc, frameId).data),
        );
    });

    it("a listener of the history that throws after the step was recorded: the step and its selection stay, shown; onError hears of it, and apply says it failed", () => {
        const { h, floating, session } = setUp();
        const frameId = session.doc.frames[0]!.id;
        const before = bytes(session)!;
        const rect = { x: 1, y: 1, width: 2, height: 2 };
        session.selection = selectionOf(rectMask(W, H, rect));
        floating.lift(h.document());
        floating.moveBy(3, 1);
        const { history } = h.document();
        const stop = history.subscribe(() => {
            throw new Error("listener failed");
        });
        h.frames.run();
        h.invalidated.length = 0;
        expect(floating.apply()).toBe("failed");
        stop();
        expect(h.errors.map(String)).toEqual(["Error: listener failed"]);
        expect(floating.floats()).toBe(false);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Move");
        expect(bytes(session)).toEqual(movedRect(before, rect, 3, 1));
        expect(session.selection?.bounds).toEqual({ x: 4, y: 2, width: 2, height: 2 });
        // Shown as the step left it, though a listener that tells the viewport may not have run.
        expect(h.invalidated).toEqual([[frameKey(frameId)]]);
        expect(Array.from(h.composites.cache!.get(frameId).data)).toEqual(
            Array.from(compositeFrame(session.doc, frameId).data),
        );
        history.undo();
        expect(bytes(session)).toEqual(before);
        expect(session.selection?.bounds).toEqual(rect);
    });
});
