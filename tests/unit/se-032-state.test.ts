import { describe, expect, it } from "vitest";
import { createFloatingState } from "../../src/app/selection/floatingState";
import type { FloatingState } from "../../src/app/selection/floatingState";
import { createMoveTool, MOVE_HINT, MOVE_TOOL_ID } from "../../src/app/selection/move/moveTool";
import { PAINT_REFUSED } from "../../src/app/tools/paintTarget";
import { createStrokeEcho } from "../../src/app/tools/strokeEcho";
import { frameKey } from "../../src/app/viewport/viewportLink";
import { compositeFrame } from "../../src/core/composite";
import { contentOfImage } from "../../src/core/floating";
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
        // Below 1× it moves: whole texels, whatever a device pixel shows.
        layer.visible = true;
        h.sessions.getState().setView(h.document().id, { scale: 0.5 });
        expect(stroke(h, [{ x: 1, y: 1 }])).toBe(true);
        expect(h.status.getState().feedback).toBeNull();
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
