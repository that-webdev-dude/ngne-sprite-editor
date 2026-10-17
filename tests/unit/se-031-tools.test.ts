import { describe, expect, it } from "vitest";
import { CONTIGUOUS, FILL_SAMPLE, TOLERANCE } from "../../src/app/tools/bucket/bucket";
import { POLYGON_LASSO_HINT } from "../../src/app/selection/tools/lasso";
import { pendingSelection } from "../../src/app/selection/tools/pendingShape";
import {
    ellipseMarqueeTool,
    freehandLassoTool,
    polygonLasso,
    rectangleMarqueeTool,
    wandTool,
} from "../../src/app/selection/tools/selection.tools";
import { SELECTION_HINT, SELECTION_MODE } from "../../src/app/selection/tools/selectionMode";
import { createWand } from "../../src/app/selection/tools/wand";
import { createPendingStore } from "../../src/app/selection/tools/pendingShape";
import type { PointerInput } from "../../src/app/tools/pipeline";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, Selection } from "../../src/core/model";
import { createMask, selectCommand, selectionOf } from "../../src/core/selection";
import { FRAME, layerId, referenceLayer, sprite } from "./se-010-support";
import type { Rgba } from "./se-010-support";
import { at, harness, stroke } from "./se-014-support";
import type { Harness } from "./se-014-support";
import { maskOf, rowsOf } from "./se-030-support";

// SE-031: the selection tools through the pointer pipeline of SE-014, driven by synthetic
// pointer sequences (SPEC §7.1, Selection tools). Each completed gesture is one history step
// labelled with the tool's name, which undo takes back exactly; Escape during a gesture
// changes nothing. The expected masks are drawn here as text, not computed by `core/selection`.

const WIDTH = 12;
const HEIGHT = 10;
const p = (x: number, y: number) => ({ x, y });

function blank(width = WIDTH, height = HEIGHT): DocSession {
    return createDocument({ name: "blank", width, height }, sequentialIds("blank-"));
}

/** The rows of a `WIDTH` × `HEIGHT` mask with the rectangle `x0..x1` × `y0..y1` set. */
function rectRows(x0: number, y0: number, x1: number, y1: number, width = WIDTH, height = HEIGHT) {
    return Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) =>
            x >= x0 && x <= x1 && y >= y0 && y <= y1 ? "#" : ".",
        ).join(""),
    );
}

/** `rows` (each `pattern.length` wide or less) placed at `x, y` on a blank mask. */
function placed(pattern: readonly string[], x: number, y: number, width = WIDTH, height = HEIGHT) {
    return Array.from({ length: height }, (_, row) =>
        Array.from({ length: width }, (_, column) =>
            pattern[row - y]?.[column - x] === "#" ? "#" : ".",
        ).join(""),
    );
}

/** The selection of the active document as rows; null for none. */
function selected(h: Harness): string[] | null {
    const { selection } = h.document().session;
    return selection ? rowsOf(selection.mask) : null;
}

function select(h: Harness, rows: readonly string[]): void {
    const { session, history } = h.document();
    history.execute(selectCommand(session, maskOf(rows), "replace", "Select")!);
}

const SHIFT: Partial<PointerInput> = { shiftKey: true };
const ALT: Partial<PointerInput> = { altKey: true };
const BOTH: Partial<PointerInput> = { shiftKey: true, altKey: true };

/** A harness with the app's selection tools registered and `id` selected. */
function tools(id: string): Harness {
    const h = harness([
        rectangleMarqueeTool,
        ellipseMarqueeTool,
        freehandLassoTool,
        polygonLasso,
        wandTool,
    ]);
    h.tools.select(id);
    return h;
}

describe("the tools", () => {
    it("lists the mode first and names the modifiers in the hint; the wand lists its flood options", () => {
        for (const tool of [rectangleMarqueeTool, ellipseMarqueeTool, freehandLassoTool]) {
            expect(
                tool.options?.map((option) => option.key),
                tool.id,
            ).toEqual([SELECTION_MODE.key]);
            expect(tool.hint, tool.id).toBe(SELECTION_HINT);
            expect(tool.paints, tool.id).toBeFalsy();
            expect(tool.cursor, tool.id).toBe("crosshair");
        }
        expect(polygonLasso.hint).toBe(POLYGON_LASSO_HINT);
        expect(POLYGON_LASSO_HINT).toContain(SELECTION_HINT);
        // DESIGN §5.2: mode toggles · tolerance.
        expect(wandTool.options?.map((option) => option.key)).toEqual([
            SELECTION_MODE.key,
            CONTIGUOUS.key,
            FILL_SAMPLE.key,
            TOLERANCE.key,
        ]);
        expect(SELECTION_MODE.default).toBe("replace");
        expect(SELECTION_MODE.choices.map((choice) => choice.value)).toEqual([
            "replace",
            "add",
            "subtract",
            "intersect",
        ]);
    });
});

describe("rectangular and elliptical marquee", () => {
    it("selects the rectangle of the press and the release, both pixels included, as one undo step", () => {
        const h = tools("marquee");
        const { history } = h.open(blank());
        stroke(h, [p(2, 1), p(4, 2), p(5, 3)]);
        expect(selected(h)).toEqual(rectRows(2, 1, 5, 3));
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Rectangular marquee");
        history.undo();
        expect(h.document().session.selection).toBeNull();
        // Dragged the other way: the same rectangle.
        stroke(h, [p(5, 3), p(2, 1)]);
        expect(selected(h)).toEqual(rectRows(2, 1, 5, 3));
    });

    it("selects the filled ellipse that fits the rectangle", () => {
        const h = tools("ellipse-marquee");
        h.open(blank(12, 12));
        stroke(h, [p(1, 2), p(9, 10)]);
        // The 9 × 9 outline of SE-017's golden, filled.
        const filled = [
            "...###...",
            "..#####..",
            ".#######.",
            "#########",
            "#########",
            "#########",
            ".#######.",
            "..#####..",
            "...###...",
        ];
        expect(selected(h)).toEqual(placed(filled, 1, 2, 12, 12));
        expect(h.document().history.undoLabel).toBe("Elliptical marquee");
    });

    it("clips a shape that reaches past the document's edge, and selects nothing wholly beside it", () => {
        const h = tools("marquee");
        h.open(blank());
        stroke(h, [p(-3, 7), p(2, 14)]);
        expect(selected(h)).toEqual(rectRows(0, 7, 2, 9));
        stroke(h, [p(-6, -4), p(-2, -1)]);
        expect(selected(h)).toBeNull();
    });

    it("a click selects nothing: with Replace it deselects, with nothing selected it records nothing", () => {
        const h = tools("marquee");
        const { history } = h.open(blank());
        stroke(h, [p(3, 3)]);
        expect(history.undoCount).toBe(0);
        select(h, rectRows(1, 1, 4, 4));
        stroke(h, [p(3, 3)]);
        expect(selected(h)).toBeNull();
        expect(history.undoCount).toBe(2);
        // Away and back to the pressed pixel is a drag: one pixel.
        stroke(h, [p(6, 6), p(7, 6), p(6, 6)]);
        expect(selected(h)).toEqual(rectRows(6, 6, 6, 6));
    });

    it("combines by the modifiers held at the press: Shift adds, Alt subtracts, both intersect", () => {
        const h = tools("marquee");
        h.open(blank());
        stroke(h, [p(1, 1), p(4, 4)]);
        stroke(h, [p(3, 3), p(6, 5)], SHIFT);
        const union = rectRows(1, 1, 4, 4).map((row, y) =>
            [...row]
                .map((cell, x) =>
                    cell === "#" || (x >= 3 && x <= 6 && y >= 3 && y <= 5) ? "#" : ".",
                )
                .join(""),
        );
        expect(selected(h)).toEqual(union);
        stroke(h, [p(0, 0), p(11, 2)], ALT);
        expect(selected(h)).toEqual(union.map((row, y) => (y <= 2 ? ".".repeat(WIDTH) : row)));
        stroke(h, [p(4, 0), p(11, 9)], BOTH);
        expect(selected(h)).toEqual(rectRows(4, 3, 6, 5));
        expect(h.document().history.undoCount).toBe(4);
    });

    it("combines by the Mode option without modifiers; the modifiers stand in for it", () => {
        const h = tools("marquee");
        h.open(blank());
        h.tools.setOption(h.tools.active()!, SELECTION_MODE.key, "add");
        stroke(h, [p(1, 1), p(2, 2)]);
        stroke(h, [p(5, 5), p(6, 6)]);
        expect(selected(h)).toEqual(
            rectRows(1, 1, 2, 2).map((row, y) =>
                [...row]
                    .map((cell, x) =>
                        cell === "#" || (x >= 5 && x <= 6 && y >= 5 && y <= 6) ? "#" : ".",
                    )
                    .join(""),
            ),
        );
        h.tools.setOption(h.tools.active()!, SELECTION_MODE.key, "subtract");
        stroke(h, [p(5, 5), p(6, 6)]);
        expect(selected(h)).toEqual(rectRows(1, 1, 2, 2));
        // Shift at the press: add, whatever the option.
        stroke(h, [p(8, 8), p(8, 8), p(9, 8)], SHIFT);
        expect(selected(h)?.[8]).toBe("........##..");
        expect(selected(h)?.slice(0, 8)).toEqual(rectRows(1, 1, 2, 2).slice(0, 8));
        // The other tools keep their own Mode.
        expect(h.tools.options(h.tools.registry.get("ellipse-marquee")!)[SELECTION_MODE.key]).toBe(
            "replace",
        );
    });

    it("reads the modifiers at the press only", () => {
        const h = tools("marquee");
        h.open(blank());
        select(h, rectRows(0, 0, 2, 2));
        h.pipeline.down(at(h, p(5, 5), { button: 0 }));
        h.pipeline.move([at(h, p(6, 6), { buttons: 1, shiftKey: true })]);
        h.pipeline.up(at(h, p(7, 6), { button: 0, buttons: 0, shiftKey: true }));
        expect(selected(h)).toEqual(rectRows(5, 5, 7, 6));
    });

    it("shows the pending rectangle from the first move off the pressed pixel, and none after", () => {
        const h = tools("marquee");
        const { session } = h.open(blank());
        h.pipeline.down(at(h, p(2, 2), { button: 0 }));
        expect(pendingSelection.get()).toBeNull();
        h.pipeline.move([at(h, p(4, 3), { buttons: 1 })]);
        expect(pendingSelection.get()).toEqual({
            session,
            shape: { kind: "rectangle", rect: { x: 2, y: 2, width: 3, height: 2 } },
        });
        h.pipeline.up(at(h, p(4, 3), { button: 0, buttons: 0 }));
        expect(pendingSelection.get()).toBeNull();
    });

    it("Escape during the drag changes nothing and drops the pending shape", () => {
        const h = tools("ellipse-marquee");
        const { history } = h.open(blank());
        select(h, rectRows(1, 1, 3, 3));
        h.pipeline.down(at(h, p(4, 4), { button: 0 }));
        h.pipeline.move([at(h, p(9, 8), { buttons: 1 })]);
        expect(pendingSelection.get()).not.toBeNull();
        expect(h.pipeline.cancel()).toBe(true);
        expect(pendingSelection.get()).toBeNull();
        expect(selected(h)).toEqual(rectRows(1, 1, 3, 3));
        expect(history.undoCount).toBe(1);
    });

    it("selects with the right button, on a locked or hidden layer, and below 1×", () => {
        const h = tools("marquee");
        const session = blank();
        session.doc.layers[0]!.locked = true;
        session.doc.layers[0]!.visible = false;
        h.open(session);
        stroke(h, [p(1, 1), p(2, 3)], { button: 2 });
        expect(selected(h)).toEqual(rectRows(1, 1, 2, 3));
        const overview = createDocument(
            { name: "overview", width: WIDTH, height: HEIGHT },
            sequentialIds("overview-"),
        );
        h.open(overview, { scale: 0.5, originX: 0, originY: 0 });
        stroke(h, [p(2, 2), p(5, 4)]);
        expect(selected(h)).toEqual(rectRows(2, 2, 5, 4));
        expect(h.status.getState().feedback).toBeNull();
    });
});

describe("lasso", () => {
    it("selects the polygon through the press, the samples and the release", () => {
        const h = tools("lasso");
        const { history } = h.open(blank());
        stroke(h, [p(1, 1), p(7, 1), p(7, 1), p(1, 7)]);
        // The diagonal side from (7, 1) to (1, 7) and everything above it.
        const triangle = Array.from({ length: HEIGHT }, (_, y) =>
            Array.from({ length: WIDTH }, (_, x) =>
                y >= 1 && y <= 7 && x >= 1 && x <= 8 - y ? "#" : ".",
            ).join(""),
        );
        expect(selected(h)).toEqual(triangle);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Lasso");
    });

    it("a path of fewer than 3 points selects nothing", () => {
        const h = tools("lasso");
        const { history } = h.open(blank());
        select(h, rectRows(1, 1, 3, 3));
        stroke(h, [p(5, 5), p(5, 5), p(8, 5)], SHIFT);
        expect(selected(h)).toEqual(rectRows(1, 1, 3, 3));
        expect(history.undoCount).toBe(1);
        stroke(h, [p(5, 5)]);
        expect(selected(h)).toBeNull();
    });

    it("shows its path so far, and Escape takes it back", () => {
        const h = tools("lasso");
        const { session } = h.open(blank());
        h.pipeline.down(at(h, p(1, 1), { button: 0 }));
        h.pipeline.move([at(h, p(5, 1), { buttons: 1 }), at(h, p(5, 4), { buttons: 1 })]);
        expect(pendingSelection.get()).toEqual({
            session,
            shape: { kind: "polygon", points: [p(1, 1), p(5, 1), p(5, 4)] },
        });
        h.pipeline.cancel();
        expect(pendingSelection.get()).toBeNull();
        expect(session.selection).toBeNull();
        expect(h.document().history.undoCount).toBe(0);
    });
});

describe("polygon lasso", () => {
    /** A click: a press and a release on `pixel`. */
    const click = (
        h: Harness,
        pixel: { x: number; y: number },
        fields: Partial<PointerInput> = {},
    ) => {
        h.pipeline.down(at(h, pixel, { button: 0, ...fields }));
        h.pipeline.up(at(h, pixel, { button: 0, buttons: 0, ...fields }));
    };

    it("adds a vertex per click and selects the polygon when closed, as one undo step", () => {
        const h = tools("polygon-lasso");
        const { history } = h.open(blank());
        click(h, p(1, 1));
        expect(h.pipeline.gesture).toBe(true);
        click(h, p(6, 1));
        click(h, p(6, 4));
        click(h, p(1, 4));
        expect(h.document().session.selection).toBeNull();
        expect(h.pipeline.closeGesture()).toBe(true);
        expect(selected(h)).toEqual(rectRows(1, 1, 6, 4));
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Polygon lasso");
        expect(h.pipeline.gesture).toBe(false);
    });

    it("adds the press and the release of a drag; a click on the last vertex (a double click) adds none", () => {
        const h = tools("polygon-lasso");
        const { session } = h.open(blank());
        h.pipeline.down(at(h, p(1, 1), { button: 0 }));
        h.pipeline.move([at(h, p(3, 1), { buttons: 1 })]);
        h.pipeline.up(at(h, p(7, 1), { button: 0, buttons: 0 }));
        click(h, p(7, 7));
        click(h, p(7, 7));
        expect(pendingSelection.get()?.shape).toEqual({
            kind: "polygon",
            points: [p(1, 1), p(7, 1), p(7, 7)],
        });
        h.pipeline.closeGesture();
        // The side from (7, 7) back to (1, 1) and everything above it.
        const triangle = Array.from({ length: HEIGHT }, (_, y) =>
            Array.from({ length: WIDTH }, (_, x) =>
                y >= 1 && y <= 7 && x >= y && x <= 7 ? "#" : ".",
            ).join(""),
        );
        expect(rowsOf(session.selection!.mask)).toEqual(triangle);
    });

    it("follows the pointer between the clicks: the pending polygon runs on to it, the closed one does not", () => {
        const h = tools("polygon-lasso");
        const { session } = h.open(blank());
        click(h, p(1, 1));
        h.pipeline.move([at(h, p(4, 1), { buttons: 0 })]);
        expect(pendingSelection.get()?.shape).toEqual({
            kind: "polygon",
            points: [p(1, 1), p(4, 1)],
        });
        click(h, p(4, 1));
        h.pipeline.move([at(h, p(4, 6), { buttons: 0 }), at(h, p(1, 6), { buttons: 0 })]);
        expect(pendingSelection.get()).toEqual({
            session,
            shape: { kind: "polygon", points: [p(1, 1), p(4, 1), p(1, 6)] },
        });
        // Closed through its two vertices: fewer than 3, nothing selected.
        h.pipeline.closeGesture();
        expect(session.selection).toBeNull();
        expect(h.document().history.undoCount).toBe(0);
        expect(pendingSelection.get()).toBeNull();
    });

    it("fewer than 3 vertices select nothing, which with Replace deselects", () => {
        const h = tools("polygon-lasso");
        const { history } = h.open(blank());
        select(h, rectRows(1, 1, 3, 3));
        click(h, p(5, 5));
        click(h, p(8, 5));
        h.pipeline.closeGesture();
        expect(selected(h)).toBeNull();
        expect(history.undoCount).toBe(2);
    });

    it("takes the mode from the first press", () => {
        const h = tools("polygon-lasso");
        h.open(blank());
        select(h, rectRows(0, 0, 1, 1));
        click(h, p(5, 5), SHIFT);
        click(h, p(7, 5), ALT);
        click(h, p(7, 7));
        click(h, p(5, 7));
        h.pipeline.closeGesture();
        expect(selected(h)).toEqual(
            rectRows(0, 0, 1, 1).map((row, y) =>
                [...row]
                    .map((cell, x) =>
                        cell === "#" || (x >= 5 && x <= 7 && y >= 5 && y <= 7) ? "#" : ".",
                    )
                    .join(""),
            ),
        );
    });

    it("Escape and a change of tool take the polygon back", () => {
        const h = tools("polygon-lasso");
        const { history } = h.open(blank());
        click(h, p(1, 1));
        click(h, p(6, 1));
        click(h, p(6, 4));
        h.pipeline.cancel();
        expect(h.pipeline.gesture).toBe(false);
        expect(pendingSelection.get()).toBeNull();
        click(h, p(1, 1));
        click(h, p(6, 1));
        click(h, p(6, 4));
        h.tools.select("marquee");
        expect(h.pipeline.gesture).toBe(false);
        expect(pendingSelection.get()).toBeNull();
        expect(h.document().session.selection).toBeNull();
        expect(history.undoCount).toBe(0);
    });
});

describe("magic wand", () => {
    const R: Rgba = [255, 0, 0, 255];
    const G: Rgba = [0, 255, 0, 255];
    const r: Rgba = [250, 4, 2, 255];
    const _: Rgba = [0, 0, 0, 0];

    /** Pixels from rows: R red, r near red, G green, _ transparent. */
    function pixels(rows: readonly string[]): Rgba[] {
        const colours: Record<string, Rgba> = { R, r, G, _ };
        return rows.flatMap((row) => [...row].map((cell) => colours[cell]!));
    }

    const ROWS = ["RRGG_rRR", "RRGG__RR", "GGGG__GG", "RRRR__RR"];

    function session(rows = ROWS, layers?: Parameters<typeof sprite>[2]): DocSession {
        const width = rows[0]!.length;
        const doc = sprite(width, rows.length, layers ?? [{ pixels: pixels(rows) }]);
        return {
            doc,
            selection: null,
            activeLayerId: layerId(doc.layers.length - 1),
            activeFrameId: FRAME,
        };
    }

    it("picks the area joined to the pressed pixel, as one undo step at the release", () => {
        const h = tools("wand");
        const { history } = h.open(session());
        h.pipeline.down(at(h, p(0, 0), { button: 0 }));
        expect(h.document().session.selection).toBeNull();
        h.pipeline.up(at(h, p(0, 0), { button: 0, buttons: 0 }));
        expect(selected(h)).toEqual(["##......", "##......", "........", "........"]);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Magic wand");
    });

    it("picks every matching pixel without Contiguous, and near colours within the tolerance", () => {
        const h = tools("wand");
        h.open(session());
        h.tools.setOption(h.tools.active()!, CONTIGUOUS.key, false);
        stroke(h, [p(0, 0)]);
        expect(selected(h)).toEqual(["##....##", "##....##", "........", "####..##"]);
        h.tools.setOption(h.tools.active()!, TOLERANCE.key, 5);
        stroke(h, [p(0, 0)]);
        expect(selected(h)).toEqual(["##...###", "##....##", "........", "####..##"]);
    });

    it("is not limited by the selection: the mode decides, Intersect keeping the part inside", () => {
        const h = tools("wand");
        h.open(session());
        // Contiguous: the red block (0, 0)–(1, 1) reaches past the selection, column 0.
        select(h, ["#.......", "#.......", "#.......", "#......."]);
        stroke(h, [p(0, 0)]);
        expect(selected(h)).toEqual(["##......", "##......", "........", "........"]);
        // Not contiguous: the red pixels of columns 6 and 7 too, beyond columns 0 to 3.
        h.tools.setOption(h.tools.active()!, CONTIGUOUS.key, false);
        select(h, ["####....", "####....", "####....", "####...."]);
        stroke(h, [p(0, 0)]);
        expect(selected(h)).toEqual(["##....##", "##....##", "........", "####..##"]);
        h.tools.setOption(h.tools.active()!, CONTIGUOUS.key, true);
        select(h, ["........", "........", "##......", "##......"]);
        stroke(h, [p(2, 2)], BOTH);
        expect(selected(h)).toEqual(["........", "........", "##......", "........"]);
    });

    it("samples the active layer as stored, or the composite", () => {
        const h = tools("wand");
        // The top layer, active, is red on the left half and empty on the right.
        h.open(
            session(ROWS, [
                { pixels: pixels(["GGGGGGGG", "GGGGGGGG", "GGGGGGGG", "GGGGGGGG"]) },
                { pixels: pixels(["RRRR____", "RRRR____", "RRRR____", "RRRR____"]) },
            ]),
        );
        stroke(h, [p(6, 1)]);
        expect(selected(h)).toEqual(["....####", "....####", "....####", "....####"]);
        h.tools.setOption(h.tools.active()!, FILL_SAMPLE.key, "composite");
        stroke(h, [p(1, 1)]);
        expect(selected(h)).toEqual(["####....", "####....", "####....", "####...."]);
    });

    it("finds an empty cel transparent, and does nothing with a reference layer active", () => {
        const h = tools("wand");
        const empty = session(ROWS, [{ pixels: pixels(ROWS) }, {}]);
        const { history } = h.open(empty);
        stroke(h, [p(3, 2)]);
        expect(selected(h)).toEqual(["########", "########", "########", "########"]);
        empty.doc.layers.push(referenceLayer("reference", "front"));
        empty.activeLayerId = "reference";
        stroke(h, [p(3, 2)]);
        expect(selected(h)).toEqual(["########", "########", "########", "########"]);
        expect(history.undoCount).toBe(1);
    });

    it("a press outside the document picks nothing; Escape before the release changes nothing", () => {
        const h = tools("wand");
        const { history } = h.open(session());
        select(h, ["##......", "##......", "........", "........"]);
        h.pipeline.down(at(h, p(2, 0), { button: 0 }));
        expect(pendingSelection.get()?.shape.kind).toBe("mask");
        h.pipeline.cancel();
        expect(pendingSelection.get()).toBeNull();
        expect(selected(h)).toEqual(["##......", "##......", "........", "........"]);
        stroke(h, [p(-2, 1)]);
        expect(selected(h)).toBeNull();
        expect(history.undoCount).toBe(2);
    });

    it("takes the composite from the cache's frame", () => {
        const h = harness();
        const pending = createPendingStore();
        const wand = createWand({ composites: h.composites }, pending);
        h.registry.register({ ...wand, id: "test.wand" });
        h.tools.select("test.wand");
        h.tools.setOption(h.tools.active()!, FILL_SAMPLE.key, "composite");
        const opened = h.open(session());
        const composite = h.composites.cacheOf(opened.session)!.get(FRAME);
        // What the cache holds is what the wand reads.
        composite.data.fill(0);
        stroke(h, [p(0, 0)]);
        expect(selected(h)).toEqual(["########", "########", "########", "########"]);
        expect(pending.get()).toBeNull();
    });
});

describe("one undo step per gesture", () => {
    it("restores the selection before each gesture exactly", () => {
        const h = tools("marquee");
        const { session, history } = h.open(blank());
        const masks: (Selection | null)[] = [session.selection];
        stroke(h, [p(1, 1), p(5, 5)]);
        masks.push(session.selection);
        h.tools.select("lasso");
        stroke(h, [p(3, 0), p(9, 3), p(3, 8)], ALT);
        masks.push(session.selection);
        h.tools.select("wand");
        stroke(h, [p(0, 9)], SHIFT);
        masks.push(session.selection);
        expect(history.undoCount).toBe(3);
        for (let index = masks.length - 1; index > 0; index--) {
            expect(session.selection).toBe(masks[index]);
            history.undo();
        }
        expect(session.selection).toBe(masks[0]);
        // Sanity: the masks were different selections.
        expect(new Set(masks.map((mask) => (mask ? rowsOf(mask.mask).join() : "none"))).size).toBe(
            4,
        );
        expect(selectionOf(createMask(WIDTH, HEIGHT))).toBeNull();
    });
});
