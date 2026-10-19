import { describe, expect, it } from "vitest";
import { createReferencePreview } from "../../src/app/references/referencePreview";
import type { ReferencePreviewStore } from "../../src/app/references/referencePreview";
import {
    MOVE_REFERENCE_LABEL,
    SCALE_REFERENCE_LABEL,
} from "../../src/app/references/referenceMove";
import { REFERENCE_CORNERS } from "../../src/app/references/referenceTransform";
import type { ReferenceCorner } from "../../src/app/references/referenceTransform";
import { createFloatingState } from "../../src/app/selection/floatingState";
import type { FloatingState } from "../../src/app/selection/floatingState";
import { createMoveTool, MOVE_TOOL_ID } from "../../src/app/selection/move/moveTool";
import { HANDLES } from "../../src/app/selection/transform/handles";
import type { PointerInput } from "../../src/app/tools/pipeline";
import { PAINT_REFUSED } from "../../src/app/tools/paintTarget";
import { createStrokeEcho } from "../../src/app/tools/strokeEcho";
import { setLayerLockedCommand } from "../../src/core/layers";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, ReferenceLayer } from "../../src/core/model";
import { addReferenceLayerCommand } from "../../src/core/references";
import { harness } from "./se-014-support";
import type { Harness } from "./se-014-support";

// SE-046: the Move tool on a reference layer (SPEC §7.6), through the pointer pipeline of
// SE-014. A press drags the active reference layer by whole document pixels, a press on a
// corner of its box scales it about the opposite corner; the drag is shown through the
// preview and recorded at the release as one undo step. A cancel leaves the layer as it was;
// a locked or hidden layer does not move and the status bar says why.

const W = 16;
const H = 12;
const SCALE = 8;
/** Source size: fitted to the 16 × 12 canvas at 16 / 30, from y = 1.733… (fractional). */
const SOURCE = { width: 30, height: 16 };

interface Setup {
    h: Harness;
    floating: FloatingState;
    preview: ReferencePreviewStore;
    session: DocSession;
    layer: () => ReferenceLayer;
}

function setUp(): Setup {
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
    const preview = createReferencePreview();
    h.registry.register(
        createMoveTool({
            floating,
            ratio: () => 1,
            references: { preview, sourceSize: () => SOURCE },
        }),
        "test",
    );
    h.tools.select(MOVE_TOOL_ID);
    const session = createDocument({ name: "r", width: W, height: H }, sequentialIds("r-"));
    h.open(session, { scale: SCALE, originX: 0, originY: 0 });
    h.document().history.execute(
        addReferenceLayerCommand(session, {
            sourceId: "src",
            sourceWidth: SOURCE.width,
            sourceHeight: SOURCE.height,
            newId: () => "ref",
        }),
    );
    session.activeLayerId = "ref";
    h.sessions.getState().touch(h.document().id);
    const layer = () => session.doc.layers.find((entry) => entry.id === "ref") as ReferenceLayer;
    return { h, floating, preview, session, layer };
}

/** A pointer input at document position `x, y` (with its fraction). */
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

function press(h: Harness, x: number, y: number): boolean {
    return h.pipeline.down(point(x, y, { button: 0, buttons: 1 }));
}

function release(h: Harness, x: number, y: number): void {
    h.pipeline.up(point(x, y, { button: 0, buttons: 0 }));
}

function geometry(layer: ReferenceLayer) {
    return { x: layer.x, y: layer.y, scale: layer.scale };
}

/** A corner of the layer's box in document pixels. */
function cornerOf(layer: ReferenceLayer, corner: ReferenceCorner) {
    const { h, v } = HANDLES[corner];
    return {
        x: layer.x + (h > 0 ? SOURCE.width * layer.scale : 0),
        y: layer.y + (v > 0 ? SOURCE.height * layer.scale : 0),
    };
}

describe("the Move tool on a reference layer", () => {
    it("drags it by whole document pixels: (10, 4) changes x and y by exactly that, one undo step, undo restores", () => {
        const { h, preview, session, layer } = setUp();
        const start = geometry(layer());
        expect(start.y % 1).not.toBe(0);
        const steps = h.document().history.undoCount;

        expect(press(h, 2.3, 3.6)).toBe(true);
        h.pipeline.move([point(7.9, 5.1)]);
        // Shown through the preview meanwhile; the document is unchanged until the release.
        expect(preview.getState()).toMatchObject({ session, layerId: "ref", x: start.x + 5 });
        expect(geometry(layer())).toEqual(start);
        h.pipeline.move([point(12.1, 7.2)]);
        expect(preview.getState()).toMatchObject({ x: start.x + 10, y: start.y + 4 });
        release(h, 12.1, 7.2);

        expect(geometry(layer())).toEqual({ x: start.x + 10, y: start.y + 4, scale: start.scale });
        expect(preview.getState()).toBeNull();
        expect(h.document().history.undoCount).toBe(steps + 1);
        expect(h.document().history.undoLabel).toBe(MOVE_REFERENCE_LABEL);
        expect(h.status.getState().feedback).toBeNull();
        expect(h.document().history.transaction).toBeNull();

        h.document().history.undo();
        expect(geometry(layer())).toEqual(start);
        expect(h.document().history.undoCount).toBe(steps);
    });

    it("scales it uniformly by each corner, the opposite corner fixed within 0.01 document pixels", () => {
        for (const corner of REFERENCE_CORNERS) {
            const { h, layer } = setUp();
            const start = geometry(layer());
            const opposite = REFERENCE_CORNERS[(REFERENCE_CORNERS.indexOf(corner) + 2) % 4]!;
            const fixed = cornerOf(layer(), opposite);
            const from = cornerOf(layer(), corner);
            const { h: sx, v: sy } = HANDLES[corner];
            const steps = h.document().history.undoCount;
            // Within the handle's reach, a little off the corner itself.
            expect(press(h, from.x + 0.25, from.y - 0.25)).toBe(true);
            h.pipeline.move([point(from.x + 0.25 + sx * 4, from.y - 0.25 + sy * 1)]);
            release(h, from.x + 0.25 + sx * 4, from.y - 0.25 + sy * 1);

            const after = layer();
            expect(after.scale, corner).not.toBeCloseTo(start.scale, 3);
            expect(after.scale, corner).toBeGreaterThan(start.scale);
            const moved = cornerOf(after, opposite);
            expect(Math.abs(moved.x - fixed.x), corner).toBeLessThanOrEqual(0.01);
            expect(Math.abs(moved.y - fixed.y), corner).toBeLessThanOrEqual(0.01);
            // The axis that changed more decides: 4 px on 16 is more than 1 px on 8.533.
            expect(after.scale, corner).toBeCloseTo((start.scale * (16 + 4)) / 16, 9);
            expect(h.document().history.undoCount).toBe(steps + 1);
            expect(h.document().history.undoLabel).toBe(SCALE_REFERENCE_LABEL);
            h.document().history.undo();
            expect(geometry(layer())).toEqual(start);
        }
    });

    it("moves, not scales, from the middle of a side: only corners are handles", () => {
        const { h, layer } = setUp();
        const start = geometry(layer());
        // The middle of the top side.
        press(h, 8, start.y);
        h.pipeline.move([point(10, start.y + 1)]);
        release(h, 10, start.y + 1);
        expect(geometry(layer())).toEqual({ x: start.x + 2, y: start.y + 1, scale: start.scale });
    });

    it("shrinking past the opposite corner stops at a longer side of one document pixel", () => {
        const { h, layer } = setUp();
        const fixed = cornerOf(layer(), "nw");
        const from = cornerOf(layer(), "se");
        press(h, from.x, from.y);
        h.pipeline.move([point(-40, -40)]);
        release(h, -40, -40);
        expect(layer().scale).toBeCloseTo(1 / SOURCE.width, 12);
        expect(cornerOf(layer(), "nw")).toEqual(fixed);
    });

    it("Escape or a pointer cancel during the drag shows it as before and records nothing", () => {
        const { h, preview, layer } = setUp();
        const start = geometry(layer());
        const steps = h.document().history.undoCount;
        for (const at of [{ x: 3, y: 4 }, cornerOf(layer(), "se")]) {
            press(h, at.x, at.y);
            h.pipeline.move([point(at.x + 3, at.y + 2)]);
            expect(preview.getState()).not.toBeNull();
            expect(h.pipeline.cancel()).toBe(true);
            expect(preview.getState()).toBeNull();
            expect(geometry(layer())).toEqual(start);
            expect(h.document().history.undoCount).toBe(steps);
        }
    });

    it("a drag that ends where it began records nothing", () => {
        const { h, preview, layer } = setUp();
        const start = geometry(layer());
        const steps = h.document().history.undoCount;
        press(h, 3, 4);
        h.pipeline.move([point(6, 6)]);
        h.pipeline.move([point(3.4, 4.2)]);
        release(h, 3.4, 4.2);
        expect(geometry(layer())).toEqual(start);
        expect(preview.getState()).toBeNull();
        expect(h.document().history.undoCount).toBe(steps);
    });

    it("a locked or hidden reference layer does not move, and the status bar says why", () => {
        const { h, preview, layer } = setUp();
        const start = geometry(layer());
        const steps = h.document().history.undoCount;
        for (const [flag, message] of [
            ["locked", PAINT_REFUSED.locked],
            ["visible", PAINT_REFUSED.hidden],
        ] as const) {
            const target = layer();
            target.locked = flag === "locked";
            target.visible = flag !== "visible";
            h.status.getState().setFeedback(null);
            press(h, 3, 4);
            expect(preview.getState()).toBeNull();
            h.pipeline.move([point(9, 9)]);
            release(h, 9, 9);
            expect(h.status.getState().feedback).toBe(message);
            expect(geometry(layer())).toEqual(start);
            expect(preview.getState()).toBeNull();
            expect(h.document().history.undoCount).toBe(steps);
        }
    });

    it("a layer locked during the drag is refused at the release with the lock's reason", () => {
        const { h, preview, session, layer } = setUp();
        const start = geometry(layer());
        press(h, 3, 4);
        h.pipeline.move([point(6, 6)]);
        h.document().history.execute(setLayerLockedCommand(session, "ref", true)!);
        const steps = h.document().history.undoCount;
        release(h, 6, 6);
        expect(h.status.getState().feedback).toBe(PAINT_REFUSED.locked);
        expect(geometry(layer())).toEqual(start);
        expect(preview.getState()).toBeNull();
        expect(h.document().history.undoCount).toBe(steps);
    });

    it("an undo during the drag acts on the document as it is; the release records from there", () => {
        const { h, layer } = setUp();
        // An earlier drag, then a second one during which that one is undone.
        press(h, 1, 1);
        release(h, 3, 1);
        const moved = geometry(layer());
        expect(moved.x).not.toBe(0);
        press(h, 5, 5);
        h.pipeline.move([point(5, 7)]);
        h.document().history.undo();
        const undone = geometry(layer());
        release(h, 5, 7);
        // The drag's start was read at its press: (moved) + (0, 2), one step over the undo.
        expect(geometry(layer())).toEqual({ ...moved, y: moved.y + 2 });
        h.document().history.undo();
        expect(geometry(layer())).toEqual(undone);
    });
});
