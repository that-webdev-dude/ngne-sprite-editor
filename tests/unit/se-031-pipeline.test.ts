import { describe, expect, it } from "vitest";
import { createToolPipeline } from "../../src/app/tools/pipeline";
import type { ToolPipeline } from "../../src/app/tools/pipeline";
import type { ToolSpec } from "../../src/app/tools/types";
import { celAt, createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";
import { at, DOT, harness, rgbaAt } from "./se-014-support";
import type { Harness } from "./se-014-support";

// SE-031: the gesture of the pointer pipeline (SPEC §7.1, Selection tools; §7.8 `gesture`). A
// tool that calls `openGesture` keeps its stroke open past the release: the next presses are
// its own, the moves between them reach `onHover`, Enter or a double click (`closeGesture`)
// keep it, and Escape, a pointer cancel during a press, the document left or a change of the
// active tool cancel it. Strokes of other tools are as SE-014 made them.

const BLACK = [0, 0, 0, 255];
const CLEAR = [0, 0, 0, 0];

function blank(width = 8, height = 6): DocSession {
    return createDocument({ name: "blank", width, height }, sequentialIds("blank-"));
}

/** A gesture tool that records its handlers and, with `paints`, writes each press's pixel. */
function gestureTool(paints = false) {
    const calls: string[] = [];
    const tool: ToolSpec = {
        id: "gesture",
        label: "Gesture",
        paints,
        onDown(context, pointer) {
            calls.push(`down ${pointer.pixel.x},${pointer.pixel.y} ${pointer.button}`);
            context.openGesture();
            const { paint } = context;
            if (!paint) return;
            const at = (pointer.pixel.y * paint.image.width + pointer.pixel.x) * 4;
            paint.image.data.set([0, 0, 0, 255], at);
            paint.markDirty({ ...pointer.pixel, width: 1, height: 1 });
        },
        onMove: (_context, pointer) =>
            void calls.push(`move ${pointer.pixel.x},${pointer.pixel.y}`),
        onUp: (_context, pointer) => void calls.push(`up ${pointer.pixel.x},${pointer.pixel.y}`),
        onHover: (_context, pointer) =>
            void calls.push(`hover ${pointer.pixel.x},${pointer.pixel.y}`),
        onClose: () => void calls.push("close"),
        onCancel: () => void calls.push("cancel"),
        onCommit: (_context, recorded) => void calls.push(`commit ${recorded}`),
    };
    return { tool, calls };
}

/**
 * The harness's stores with a pipeline of the test's own that reports its gestures, and
 * `tool` selected.
 */
function setUp(tool: ToolSpec): { h: Harness; pipeline: ToolPipeline; gestures: boolean[] } {
    const h = harness([tool]);
    h.tools.select(tool.id);
    // The harness's own pipeline stands by; this one reports when a gesture opens and ends.
    const gestures: boolean[] = [];
    const pipeline = createToolPipeline({
        sessions: h.sessions,
        composites: h.composites,
        viewport: { invalidate() {} },
        status: h.status,
        editor: h.editor,
        tools: h.tools,
        mapping: () => h.mapping(),
        nextFrame: h.frames.request,
        later: h.timers.set,
        onError: (error) => void h.errors.push(error),
        gesture: (open) => void gestures.push(open),
    });
    return { h, pipeline, gestures };
}

/** A click (press and release) on `pixel` with the left button, or `button`. */
function click(h: Harness, pipeline: ToolPipeline, pixel: { x: number; y: number }, button = 0) {
    const buttons = button === 2 ? 2 : 1;
    const began = pipeline.down(at(h, pixel, { button, buttons }));
    pipeline.up(at(h, pixel, { button, buttons: 0 }));
    return began;
}

describe("a gesture of several presses", () => {
    it("stays open past the release, takes the next presses and the moves between them, and is kept when closed", () => {
        const { tool, calls } = gestureTool();
        const { h, pipeline, gestures } = setUp(tool);
        h.open(blank());

        expect(click(h, pipeline, { x: 1, y: 1 })).toBe(true);
        expect(pipeline.stroking).toBe(true);
        expect(pipeline.gesture).toBe(true);
        expect(pipeline.hovering).toBe(true);
        expect(pipeline.strokePointer).toBeNull();
        expect(gestures).toEqual([true]);

        // Moves with no button held: hovering.
        pipeline.move([
            at(h, { x: 2, y: 1 }, { buttons: 0 }),
            at(h, { x: 3, y: 2 }, { buttons: 0 }),
        ]);
        // The next press, with the right button this time, and a drag.
        expect(pipeline.down(at(h, { x: 3, y: 2 }, { button: 2, buttons: 2 }))).toBe(true);
        expect(pipeline.hovering).toBe(false);
        expect(pipeline.strokePointer).toBe(1);
        pipeline.move([at(h, { x: 4, y: 2 }, { buttons: 2 })]);
        pipeline.up(at(h, { x: 4, y: 3 }, { button: 2, buttons: 0 }));
        expect(pipeline.gesture).toBe(true);

        expect(pipeline.closeGesture()).toBe(true);
        expect(pipeline.stroking).toBe(false);
        expect(pipeline.gesture).toBe(false);
        expect(gestures).toEqual([true, false]);
        expect(calls).toEqual([
            "down 1,1 primary",
            "up 1,1",
            "hover 2,1",
            "hover 3,2",
            "down 3,2 secondary",
            "move 4,2",
            "up 4,3",
            "close",
            "commit false",
        ]);
        // Nothing open: nothing more to close.
        expect(pipeline.closeGesture()).toBe(false);
        expect(h.errors).toEqual([]);
    });

    it("keeps a painting gesture's pixels in one transaction, committed as one entry at the close", () => {
        const { tool } = gestureTool(true);
        const { h, pipeline } = setUp(tool);
        const { session, history } = h.open(blank());
        click(h, pipeline, { x: 1, y: 1 });
        click(h, pipeline, { x: 5, y: 3 });
        expect(history.transaction).not.toBeNull();
        expect(history.undoCount).toBe(0);
        pipeline.closeGesture();
        expect(history.transaction).toBeNull();
        expect(history.undoCount).toBe(1);
        const cel = celAt(session.doc, session.activeLayerId, session.activeFrameId);
        const image = session.doc.images.get(cel!.imageId)!;
        expect(rgbaAt(image, 1, 1)).toEqual(BLACK);
        expect(rgbaAt(image, 5, 3)).toEqual(BLACK);
        history.undo();
        expect(celAt(session.doc, session.activeLayerId, session.activeFrameId)).toBeUndefined();
    });

    it("closes with the button held: the release that follows finds no stroke", () => {
        const { tool, calls } = gestureTool();
        const { h, pipeline } = setUp(tool);
        h.open(blank());
        click(h, pipeline, { x: 1, y: 1 });
        pipeline.down(at(h, { x: 2, y: 2 }, { button: 0 }));
        pipeline.closeGesture();
        pipeline.up(at(h, { x: 2, y: 2 }, { button: 0, buttons: 0 }));
        expect(calls).toEqual([
            "down 1,1 primary",
            "up 1,1",
            "down 2,2 primary",
            "close",
            "commit false",
        ]);
        expect(pipeline.stroking).toBe(false);
    });

    for (const [name, end] of [
        ["Escape (cancel)", ({ pipeline }: Ended) => pipeline.cancel()],
        ["another selected tool", ({ h }: Ended) => h.tools.select(DOT)],
        ["a held tool", ({ h }: Ended) => h.tools.hold(DOT)],
        [
            "another active document",
            ({ h }: Ended) =>
                h.open(createDocument({ name: "other", width: 4, height: 4 }, sequentialIds("o-"))),
        ],
        ["its document closed", ({ h }: Ended) => h.sessions.getState().close(h.document().id)],
    ] as const) {
        it(`is cancelled by ${name}: the pixels as before, no entry`, () => {
            const { tool, calls } = gestureTool(true);
            const { h, pipeline, gestures } = setUp(tool);
            const { session, history } = h.open(blank());
            click(h, pipeline, { x: 1, y: 1 });
            end({ h, pipeline });
            expect(pipeline.stroking).toBe(false);
            expect(pipeline.gesture).toBe(false);
            expect(gestures).toEqual([true, false]);
            expect(calls.at(-1)).toBe("cancel");
            expect(history.transaction).toBeNull();
            expect(history.undoCount).toBe(0);
            expect(
                celAt(session.doc, session.activeLayerId, session.activeFrameId),
            ).toBeUndefined();
        });
    }

    it("is cancelled by a pointer cancel during a press only: between presses there is no stroke pointer", () => {
        const { tool, calls } = gestureTool();
        const { h, pipeline } = setUp(tool);
        h.open(blank());
        click(h, pipeline, { x: 1, y: 1 });
        // What `attachToolPointer` does at a pointer cancel or a lost capture.
        const pointerCancel = (pointerId: number) => {
            if (pointerId === pipeline.strokePointer) pipeline.cancel();
        };
        pointerCancel(1);
        expect(pipeline.gesture).toBe(true);
        pipeline.down(at(h, { x: 2, y: 1 }, { button: 0 }));
        pointerCancel(1);
        expect(pipeline.gesture).toBe(false);
        expect(calls.at(-1)).toBe("cancel");
    });

    it("leaves a stroke that is no gesture to the tool of its press, whatever the tool becomes", () => {
        const { tool } = gestureTool();
        const { h, pipeline, gestures } = setUp(tool);
        const { session, history } = h.open(blank());
        h.tools.select(DOT);
        pipeline.down(at(h, { x: 1, y: 1 }, { button: 0 }));
        h.tools.select("gesture");
        expect(pipeline.stroking).toBe(true);
        pipeline.up(at(h, { x: 1, y: 1 }, { button: 0, buttons: 0 }));
        expect(history.undoCount).toBe(1);
        expect(gestures).toEqual([]);
        // No gesture: no hover, no close.
        expect(pipeline.hovering).toBe(false);
        expect(pipeline.closeGesture()).toBe(false);
        const cel = celAt(session.doc, session.activeLayerId, session.activeFrameId);
        const image = session.doc.images.get(cel!.imageId)!;
        expect(rgbaAt(image, 1, 1)).toEqual(BLACK);
        expect(rgbaAt(image, 2, 1)).toEqual(CLEAR);
    });

    it("ignores the middle button and a second press while one is held", () => {
        const { tool, calls } = gestureTool();
        const { h, pipeline } = setUp(tool);
        h.open(blank());
        click(h, pipeline, { x: 1, y: 1 });
        expect(pipeline.down(at(h, { x: 2, y: 2 }, { button: 1, buttons: 4 }))).toBe(false);
        expect(pipeline.down(at(h, { x: 2, y: 2 }, { button: 0 }))).toBe(true);
        expect(pipeline.down(at(h, { x: 3, y: 3 }, { button: 0, pointerId: 2 }))).toBe(false);
        expect(calls).toEqual(["down 1,1 primary", "up 1,1", "down 2,2 primary"]);
    });

    it("cancels the gesture when a handler throws, with one error", () => {
        const failing: ToolSpec = {
            id: "failing",
            label: "Failing",
            onDown: (context) => context.openGesture(),
            onHover() {
                throw new Error("broken hover");
            },
        };
        const { h, pipeline, gestures } = setUp(failing);
        h.open(blank());
        click(h, pipeline, { x: 1, y: 1 });
        pipeline.move([at(h, { x: 2, y: 1 }, { buttons: 0 })]);
        expect(pipeline.stroking).toBe(false);
        expect(gestures).toEqual([true, false]);
        expect(h.errors).toHaveLength(1);
    });

    it("opens no gesture after its stroke ended", () => {
        let late: (() => void) | null = null;
        const tool: ToolSpec = {
            id: "late",
            label: "Late",
            onDown(context) {
                late = () => context.openGesture();
            },
        };
        const { h, pipeline, gestures } = setUp(tool);
        h.open(blank());
        click(h, pipeline, { x: 1, y: 1 });
        late!();
        expect(pipeline.gesture).toBe(false);
        expect(gestures).toEqual([]);
    });
});

interface Ended {
    h: Harness;
    pipeline: ToolPipeline;
}
