import { describe, expect, it } from "vitest";
import {
    createBucket,
    CONTIGUOUS,
    FILL_SAMPLE,
    TOLERANCE,
} from "../../src/app/tools/bucket/bucket";
import { bucketTool } from "../../src/app/tools/bucket/bucket.tools";
import {
    BRUSH_SHAPE,
    BRUSH_SIZE,
    brushOf,
    hasBrush,
    INK,
    OPACITY,
} from "../../src/app/tools/brush/brushOptions";
import { PAINT_REFUSED } from "../../src/app/tools/paintTarget";
import { createToolPipeline } from "../../src/app/tools/pipeline";
import type { KeyInput, ToolPipeline } from "../../src/app/tools/pipeline";
import { plannedTools } from "../../src/app/tools/planned.tools";
import { dragShape, FILLED } from "../../src/app/tools/shapes/shapeTool";
import { ellipseTool, lineTool, rectangleTool } from "../../src/app/tools/shapes/shapes.tools";
import { createStrokeEcho } from "../../src/app/tools/strokeEcho";
import type { StrokeEcho } from "../../src/app/tools/strokeEcho";
import { toolRegistry } from "../../src/app/tools/toolRegistry";
import type { ToolCursorState, ToolSpec } from "../../src/app/tools/types";
import { compositeFrame } from "../../src/core/composite";
import { celAt, createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, PixelBuffer, Rect } from "../../src/core/model";
import { clonePixelBuffer } from "../../src/core/pixels";
import { paintInk, ShapeStroke } from "../../src/core/raster";
import type { PixelPoint, Shape } from "../../src/core/raster";
import { selectionOf } from "../../src/core/selection";
import { FRAME, celImage, layerId, sprite } from "./se-010-support";
import type { Rgba } from "./se-010-support";
import { at, harness, rgbaAt, stroke } from "./se-014-support";
import type { Harness } from "./se-014-support";
import { maskOf } from "./se-030-support";

// SE-017: the line, rectangle and ellipse tools and the paint bucket through the pointer
// pipeline of SE-014, driven by synthetic pointer sequences. A shape is a rubber band drawn
// into the stroke's transaction: while the button is held the image, the live composite and
// the stroke echo show the shape of the last sample alone, which the release keeps as one
// undo step; Escape takes it back. Shift and Ctrl shape it, from the pointer or the keyboard.
// The bucket fills the area of the pixel pressed, from the layer or the composite. A shape or
// a fill that changes nothing records nothing; with a selection, nothing changes outside it.

const WIDTH = 16;
const HEIGHT = 12;
const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];
const RED = [255, 0, 0, 255];
const p = (x: number, y: number): PixelPoint => ({ x, y });
const NONE = { shift: false, ctrl: false };

function blank(width = WIDTH, height = HEIGHT): DocSession {
    return createDocument({ name: "blank", width, height }, sequentialIds("blank-"));
}

/** One layer whose cel holds a pattern: every pixel differs from its neighbours. */
function patterned(width = WIDTH, height = HEIGHT): DocSession {
    const pixels: Rgba[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) pixels.push([x * 13, y * 17, (x + y) * 5, 255]);
    }
    const doc = sprite(width, height, [{ pixels }]);
    return { doc, selection: null, activeLayerId: layerId(0), activeFrameId: FRAME };
}

/** One layer drawn from rows: "X" black, "." white, " " transparent. */
function drawn(rows: readonly string[]): DocSession {
    const pixels: Rgba[] = [];
    for (const row of rows) {
        for (const cell of row) {
            pixels.push(
                cell === "X" ? [0, 0, 0, 255] : cell === "." ? [255, 255, 255, 255] : [0, 0, 0, 0],
            );
        }
    }
    const doc = sprite(rows[0]!.length, rows.length, [{ pixels }]);
    return { doc, selection: null, activeLayerId: layerId(0), activeFrameId: FRAME };
}

const TOOLS: readonly ToolSpec[] = [lineTool, rectangleTool, ellipseTool, bucketTool];

/** A pipeline with the SE-017 tools and `tool` selected, red on white (the defaults are SE-016's). */
function tools(tool: string): Harness {
    const h = harness(TOOLS);
    h.tools.select(tool);
    h.editor.getState().setForeground(0xff0000ff);
    h.editor.getState().setBackground(0xffffffff);
    return h;
}

function image(session: DocSession): PixelBuffer {
    return celImage(session.doc, session.activeLayerId, session.activeFrameId);
}

/** A transparent image: what an empty cel starts as. */
function empty(width: number, height: number): PixelBuffer {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** What the active cel of `session` becomes with `shape` drawn over `before` by the tool's options. */
function expected(
    h: Harness,
    before: PixelBuffer,
    shape: Shape,
    colour = 0xff0000ff,
): Uint8ClampedArray {
    const tool = h.tools.active()!;
    const values = h.tools.options(tool);
    const result = clonePixelBuffer(before);
    new ShapeStroke(result, before, {
        brush: brushOf(values),
        ink: paintInk("simple", colour, 255),
    }).draw(shape);
    return result.data;
}

/** The frame's composite as the cache holds it now: what the viewport is shown. */
function shown(h: Harness, session: DocSession): PixelBuffer {
    const buffer = h.composites.cacheOf(session)?.get(session.activeFrameId);
    if (!buffer) throw new Error("no composite");
    return buffer;
}

function key(type: "down" | "up", name: string, modifiers: Partial<KeyInput> = {}): KeyInput {
    return {
        type,
        key: name,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        repeat: false,
        ...modifiers,
    };
}

describe("the shape a drag makes", () => {
    it("corner to corner; Shift a square towards the pointer, as large as the drag's larger side", () => {
        expect(dragShape("rectangle", p(2, 3), p(7, 5), NONE, false)).toEqual({
            kind: "rectangle",
            from: p(2, 3),
            to: p(7, 5),
            filled: false,
        });
        expect(
            dragShape("rectangle", p(2, 3), p(7, 5), { shift: true, ctrl: false }, true),
        ).toEqual({
            kind: "rectangle",
            from: p(2, 3),
            to: p(7, 8),
            filled: true,
        });
        expect(
            dragShape("ellipse", p(10, 10), p(8, 3), { shift: true, ctrl: false }, false).to,
        ).toEqual(p(3, 3));
        // No drag: one pixel.
        expect(
            dragShape("ellipse", p(4, 4), p(4, 4), { shift: true, ctrl: false }, false).to,
        ).toEqual(p(4, 4));
    });

    it("Ctrl: the press is the centre, the shape reaching as far on the other side", () => {
        expect(
            dragShape("rectangle", p(10, 10), p(13, 12), { shift: false, ctrl: true }, false),
        ).toMatchObject({
            from: p(7, 8),
            to: p(13, 12),
        });
        expect(
            dragShape("ellipse", p(10, 10), p(13, 12), { shift: true, ctrl: true }, false),
        ).toMatchObject({
            from: p(7, 7),
            to: p(13, 13),
        });
        expect(
            dragShape("line", p(5, 5), p(8, 6), { shift: false, ctrl: true }, false),
        ).toMatchObject({
            from: p(2, 4),
            to: p(8, 6),
        });
    });

    it("a line with Shift snaps to the nearest 45° step: an axis within 22.5° of it, else a diagonal", () => {
        const snapped = (dx: number, dy: number) => {
            const { to } = dragShape(
                "line",
                p(0, 0),
                p(dx, dy),
                { shift: true, ctrl: false },
                false,
            );
            return [to.x, to.y];
        };
        expect(snapped(10, 4)).toEqual([10, 0]); // 21.8°
        expect(snapped(10, 5)).toEqual([10, 10]); // 26.6°
        expect(snapped(-4, 10)).toEqual([0, 10]);
        expect(snapped(-10, -9)).toEqual([-10, -10]);
        expect(snapped(3, -7)).toEqual([7, -7]); // 66.8° from the x axis
        expect(snapped(0, 0)).toEqual([0, 0]);
        // A line is never filled.
        expect(dragShape("line", p(0, 0), p(3, 3), NONE, true).filled).toBe(false);
    });
});

describe("a shape drag is one undo step", () => {
    for (const tool of [lineTool, rectangleTool, ellipseTool]) {
        it(`${tool.label}: the release keeps the shape of the last sample; undo restores the bytes, redo the shape`, () => {
            const h = tools(tool.id);
            const session = patterned();
            const { history } = h.open(session);
            h.tools.setOption(h.tools.active()!, BRUSH_SIZE.key, 2);
            const before = clonePixelBuffer(image(session));
            stroke(h, [p(2, 2), p(9, 5), p(13, 9)]);
            expect(history.undoCount).toBe(1);
            expect(history.undoLabel).toBe(tool.label);
            const after = image(session).data.slice();
            // Each shape tool's id is its kind.
            const kind = tool.id as Shape["kind"];
            expect(after).toEqual(
                expected(h, before, dragShape(kind, p(2, 2), p(13, 9), NONE, false)),
            );
            expect(history.undo()).toBe(true);
            expect(image(session).data).toEqual(before.data);
            expect(history.redo()).toBe(true);
            expect(image(session).data).toEqual(after);
            expect(h.errors).toEqual([]);
        });
    }

    it("on an empty cel: the shape creates it, and undo removes it", () => {
        const h = tools("ellipse");
        const { history, session } = h.open(blank());
        stroke(h, [p(1, 1), p(12, 8)]);
        expect(history.undoCount).toBe(1);
        history.undo();
        expect(celAt(session.doc, session.activeLayerId, session.activeFrameId)).toBeUndefined();
    });
});

describe("the rubber band", () => {
    it("while held, the image and the composite the viewport is shown hold the shape of the last sample alone; the release at that pixel keeps exactly that", () => {
        const h = tools("rectangle");
        const session = patterned();
        const { history } = h.open(session);
        const before = clonePixelBuffer(image(session));
        h.pipeline.down(at(h, p(3, 2), { button: 0 }));
        h.pipeline.move([at(h, p(14, 10))]);
        h.pipeline.move([at(h, p(8, 6))]);
        h.frames.run();
        const preview = image(session).data.slice();
        expect(preview).toEqual(
            expected(h, before, dragShape("rectangle", p(3, 2), p(8, 6), NONE, false)),
        );
        expect(history.transaction).not.toBeNull();
        // The composite shown during the stroke is the document's with the preview in it.
        expect(shown(h, session).data).toEqual(
            compositeFrame(session.doc, session.activeFrameId).data,
        );
        h.pipeline.up(at(h, p(8, 6), { button: 0, buttons: 0 }));
        expect(history.undoCount).toBe(1);
        expect(image(session).data).toEqual(preview);
        expect(shown(h, session).data).toEqual(
            compositeFrame(session.doc, session.activeFrameId).data,
        );
    });

    it("each sample takes the previous shape back: the live composite and the stroke echo show only the last one", () => {
        const h = tools("ellipse");
        let version = 0;
        const echo: StrokeEcho = createStrokeEcho({ nextVersion: () => ++version });
        const composited: Rect[] = [];
        const record = echo.composited.bind(echo);
        echo.composited = (rect) => {
            composited.push({ ...rect });
            record(rect);
        };
        const pipeline: ToolPipeline = createToolPipeline({
            sessions: h.sessions,
            composites: h.composites,
            viewport: { invalidate: () => {} },
            status: h.status,
            editor: h.editor,
            tools: h.tools,
            mapping: () => h.mapping(),
            nextFrame: h.frames.request,
            later: h.timers.set,
            onError: (error) => void h.errors.push(error),
            echo,
        });
        const session = patterned();
        h.open(session);
        h.tools.setOption(h.tools.active()!, FILLED.key, true);
        const before = clonePixelBuffer(image(session));
        pipeline.down(at(h, p(1, 1), { button: 0 }));
        pipeline.move([at(h, p(14, 10))]);
        echo.prepare();
        h.frames.run();
        const big = dragShape("ellipse", p(1, 1), p(14, 10), NONE, true);
        const bigImage = expected(h, before, big);
        // The pixels the big preview changed.
        const bigPixels: PixelPoint[] = [];
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                const at4 = (y * WIDTH + x) * 4;
                if (
                    bigImage[at4] !== before.data[at4] ||
                    bigImage[at4 + 1] !== before.data[at4 + 1]
                ) {
                    bigPixels.push(p(x, y));
                }
            }
        }
        composited.length = 0;
        pipeline.move([at(h, p(4, 3))]);
        echo.prepare();
        const small = dragShape("ellipse", p(1, 1), p(4, 3), NONE, true);
        expect(image(session).data).toEqual(expected(h, before, small));
        // The pixels of the big shape that the small one does not cover were composited again …
        const inside = (point: PixelPoint) =>
            composited.some(
                (rect) =>
                    point.x >= rect.x &&
                    point.y >= rect.y &&
                    point.x < rect.x + rect.width &&
                    point.y < rect.y + rect.height,
            );
        expect(bigPixels.filter((point) => !inside(point))).toEqual([]);
        // … so the live buffer the echo draws from is the document's composite now, everywhere.
        const buffer = echo.target!.buffer;
        expect(buffer.data).toEqual(compositeFrame(session.doc, session.activeFrameId).data);
        expect(echo.regions().length).toBeGreaterThan(0);
        pipeline.up(at(h, p(4, 3), { button: 0, buttons: 0 }));
        expect(h.errors).toEqual([]);
    });

    it("Escape takes the shape back: the pixels, the composite shown, no entry and no cel", () => {
        const h = tools("line");
        const { history, session } = h.open(blank());
        h.pipeline.down(at(h, p(1, 1), { button: 0 }));
        h.pipeline.move([at(h, p(12, 9))]);
        h.frames.run();
        expect(history.transaction).not.toBeNull();
        expect(h.pipeline.cancel()).toBe(true);
        expect(history.undoCount).toBe(0);
        expect(celAt(session.doc, session.activeLayerId, session.activeFrameId)).toBeUndefined();
        expect(shown(h, session).data.every((value) => value === 0)).toBe(true);
        // The release that follows does nothing.
        h.pipeline.up(at(h, p(12, 9), { button: 0, buttons: 0 }));
        expect(history.undoCount).toBe(0);

        const painted = patterned();
        const second = tools("rectangle");
        second.open(painted);
        const before = image(painted).data.slice();
        second.pipeline.down(at(second, p(2, 2), { button: 0 }));
        second.pipeline.move([at(second, p(10, 8))]);
        second.pipeline.cancel();
        expect(image(painted).data).toEqual(before);
        expect(shown(second, painted).data).toEqual(compositeFrame(painted.doc, FRAME).data);
    });

    it("a shape that changes nothing records nothing: over pixels of its colour, or off the document", () => {
        const h = tools("rectangle");
        const session = drawn(["XXXXXX", "XXXXXX", "XXXXXX", "XXXXXX"]);
        const { history } = h.open(session);
        h.editor.getState().setForeground(0x000000ff);
        stroke(h, [p(0, 0), p(5, 3)]);
        expect(history.undoCount).toBe(0);
        // Pressed off the document, dragged over it and back off: nothing left changed.
        h.editor.getState().setForeground(0xff0000ff);
        h.pipeline.down(at(h, p(-5, -5), { button: 0 }));
        h.pipeline.move([at(h, p(4, 2))]);
        expect(history.transaction?.dirty).not.toBeNull();
        h.pipeline.move([at(h, p(-2, -1))]);
        h.pipeline.up(at(h, p(-2, -1), { button: 0, buttons: 0 }));
        expect(history.undoCount).toBe(0);
        expect(image(session).data.every((value, index) => value === BLACK[index % 4])).toBe(true);
        // A line off the document altogether.
        h.tools.select("line");
        stroke(h, [p(-5, 1), p(-1, 3)]);
        expect(history.undoCount).toBe(0);
        expect(h.errors).toEqual([]);
    });
});

describe("modifiers", () => {
    it("Shift held with the pointer: a square; Ctrl: from the centre", () => {
        const h = tools("rectangle");
        const { session } = h.open(blank(20, 20));
        stroke(h, [p(2, 2), p(9, 5)], { shiftKey: true });
        const square = dragShape("rectangle", p(2, 2), p(9, 9), NONE, false);
        expect(image(session).data).toEqual(expected(h, empty(20, 20), square));

        const g = tools("ellipse");
        const centred = g.open(blank(20, 20)).session;
        stroke(g, [p(10, 10), p(14, 12)], { ctrlKey: true });
        const fromCentre = dragShape(
            "ellipse",
            p(10, 10),
            p(14, 12),
            { shift: false, ctrl: true },
            false,
        );
        expect(fromCentre.from).toEqual(p(6, 8));
        expect(image(centred).data).toEqual(expected(g, empty(20, 20), fromCentre));
    });

    it("Shift or Ctrl pressed or released while the button is held draws the shape again at once", () => {
        const h = tools("line");
        const { session, history } = h.open(blank(20, 20));
        const before = empty(20, 20);
        const line = (modifiers: { shift: boolean; ctrl: boolean }) =>
            expected(h, before, dragShape("line", p(2, 2), p(14, 6), modifiers, false));
        h.pipeline.down(at(h, p(2, 2), { button: 0 }));
        h.pipeline.move([at(h, p(14, 6))]);
        expect(image(session).data).toEqual(line(NONE));
        // Shift down: the line snaps to the horizontal, with no pointer move.
        expect(h.pipeline.key(key("down", "Shift", { shiftKey: true }))).toBe(true);
        expect(image(session).data).toEqual(line({ shift: true, ctrl: false }));
        expect(rgbaAt(image(session), 14, 2)).toEqual(RED);
        // Ctrl down as well: from the centre.
        expect(h.pipeline.key(key("down", "Ctrl", { shiftKey: true, ctrlKey: true }))).toBe(true);
        expect(image(session).data).toEqual(line({ shift: true, ctrl: true }));
        // Both up: the drag as it is.
        h.pipeline.key(key("up", "Shift", { ctrlKey: true }));
        h.pipeline.key(key("up", "Ctrl"));
        expect(image(session).data).toEqual(line(NONE));
        // Other keys are not the tool's.
        expect(h.pipeline.key(key("down", "A"))).toBe(false);
        h.pipeline.up(at(h, p(14, 6), { button: 0, buttons: 0 }));
        expect(history.undoCount).toBe(1);
    });
});

describe("colours, brush and fill", () => {
    it("the right button draws in the background colour", () => {
        const h = tools("rectangle");
        const { session } = h.open(blank());
        stroke(h, [p(2, 2), p(6, 5)], { button: 2 });
        expect(rgbaAt(image(session), 2, 2)).toEqual(WHITE);
        expect(rgbaAt(image(session), 6, 5)).toEqual(WHITE);
        expect(rgbaAt(image(session), 4, 3)).toEqual([0, 0, 0, 0]);
    });

    it("the brush's size and shape apply to the outline; Filled covers the inside", () => {
        const h = tools("rectangle");
        const { session } = h.open(blank(20, 16));
        const tool = h.tools.active()!;
        h.tools.setOption(tool, BRUSH_SIZE.key, 3);
        h.tools.setOption(tool, BRUSH_SHAPE.key, "square");
        stroke(h, [p(4, 4), p(14, 11)]);
        const cel = image(session);
        // The 3 px brush centred on the outline: one pixel outside it, one inside.
        expect(rgbaAt(cel, 3, 3)).toEqual(RED);
        expect(rgbaAt(cel, 5, 5)).toEqual(RED);
        expect(rgbaAt(cel, 2, 2)).toEqual([0, 0, 0, 0]);
        expect(rgbaAt(cel, 6, 6)).toEqual([0, 0, 0, 0]);
        h.tools.setOption(tool, FILLED.key, true);
        stroke(h, [p(4, 4), p(14, 11)]);
        expect(rgbaAt(cel, 9, 8)).toEqual(RED);
        expect(rgbaAt(cel, 2, 2)).toEqual([0, 0, 0, 0]);
    });
});

describe("with a selection", () => {
    const rows = Array.from({ length: HEIGHT }, (_, y) =>
        Array.from({ length: WIDTH }, (_, x) =>
            x >= 4 && x < 10 && y >= 3 && y < 8 ? "#" : ".",
        ).join(""),
    );
    const selected = (x: number, y: number) => rows[y]![x] === "#";

    function changedOutside(before: Uint8ClampedArray, after: Uint8ClampedArray): PixelPoint[] {
        const outside: PixelPoint[] = [];
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                const at4 = (y * WIDTH + x) * 4;
                const same = [0, 1, 2, 3].every((c) => before[at4 + c] === after[at4 + c]);
                if (!same && !selected(x, y)) outside.push(p(x, y));
            }
        }
        return outside;
    }

    it("a filled rectangle across the selection's edges changes pixels only inside it, in the preview too", () => {
        const h = tools("rectangle");
        const session = patterned();
        session.selection = selectionOf(maskOf(rows));
        h.open(session);
        h.tools.setOption(h.tools.active()!, FILLED.key, true);
        const before = image(session).data.slice();
        h.pipeline.down(at(h, p(1, 1), { button: 0 }));
        h.pipeline.move([at(h, p(13, 10))]);
        h.frames.run();
        expect(changedOutside(before, image(session).data)).toEqual([]);
        expect(shown(h, session).data).toEqual(compositeFrame(session.doc, FRAME).data);
        h.pipeline.up(at(h, p(13, 10), { button: 0, buttons: 0 }));
        const after = image(session).data;
        expect(changedOutside(before, after)).toEqual([]);
        expect(rgbaAt(image(session), 4, 3)).toEqual(RED);
        expect(rgbaAt(image(session), 9, 7)).toEqual(RED);
    });

    it("the bucket fills only inside it, without crossing it", () => {
        const h = tools("bucket");
        const session = drawn(Array.from({ length: HEIGHT }, () => ".".repeat(WIDTH)));
        // Two selected areas joined only through unselected pixels.
        const two = rows.map((row, y) => (y === 10 ? "##.........#####" : row));
        session.selection = selectionOf(maskOf(two));
        const { history } = h.open(session);
        const before = image(session).data.slice();
        stroke(h, [p(5, 4)]);
        expect(history.undoCount).toBe(1);
        const after = image(session).data;
        expect(changedOutside(before, after)).toEqual([]);
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                expect(rgbaAt(image(session), x, y), `${x}, ${y}`).toEqual(
                    selected(x, y) ? RED : WHITE,
                );
            }
        }
    });
});

/** A closed black frame on white with a white inside, and a white pocket elsewhere. */
const FRAMED = [
    "................",
    ".XXXXXXX........",
    ".X.....X........",
    ".X.....X...XXX..",
    ".X.....X...X.X..",
    ".XXXXXXX...XXX..",
    "................",
];

describe("the paint bucket", () => {
    it("a click fills the contiguous area of the pixel under it: one undo step, which undo takes back", () => {
        const h = tools("bucket");
        const session = drawn(FRAMED);
        const { history } = h.open(session);
        const before = image(session).data.slice();
        expect(stroke(h, [p(4, 3)])).toBe(true);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Paint bucket");
        for (let y = 0; y < FRAMED.length; y++) {
            for (let x = 0; x < 16; x++) {
                const inside = x >= 2 && x <= 6 && y >= 2 && y <= 4;
                expect(rgbaAt(image(session), x, y), `${x}, ${y}`).toEqual(
                    inside ? RED : FRAMED[y]![x] === "X" ? BLACK : WHITE,
                );
            }
        }
        history.undo();
        expect(image(session).data).toEqual(before);
    });

    it("Contiguous off fills every pixel of the colour; a tolerance takes near colours", () => {
        const h = tools("bucket");
        const session = drawn(FRAMED);
        h.open(session);
        h.tools.setOption(h.tools.active()!, CONTIGUOUS.key, false);
        stroke(h, [p(0, 0)]);
        for (let y = 0; y < FRAMED.length; y++) {
            for (let x = 0; x < 16; x++) {
                expect(rgbaAt(image(session), x, y)).toEqual(FRAMED[y]![x] === "X" ? BLACK : RED);
            }
        }

        const g = tools("bucket");
        const near = drawn(["....", "...."]);
        const cel = image(near);
        cel.data.set([254, 255, 255, 255], 4); // pixel 1, 0: off by one
        cel.data.set([250, 255, 255, 255], 8); // pixel 2, 0: off by five
        const { history } = g.open(near);
        g.tools.setOption(g.tools.active()!, TOLERANCE.key, 4);
        stroke(g, [p(0, 0)]);
        expect(history.undoCount).toBe(1);
        expect(rgbaAt(cel, 1, 0)).toEqual(RED);
        expect(rgbaAt(cel, 2, 0)).toEqual([250, 255, 255, 255]);
        expect(rgbaAt(cel, 3, 0)).toEqual(RED);
    });

    it("Sample: the active layer's own pixels, or the frame as composited", () => {
        const make = () => {
            const pixels: Rgba[] = [];
            for (const row of FRAMED) {
                for (const cell of row)
                    pixels.push(cell === "X" ? [0, 0, 0, 255] : [255, 255, 255, 255]);
            }
            // The frame below, an empty layer above it as the active one.
            const doc = sprite(16, FRAMED.length, [{ pixels }, {}]);
            return {
                doc,
                selection: null,
                activeLayerId: layerId(1),
                activeFrameId: FRAME,
            } as DocSession;
        };
        // Active layer (the default): the empty layer is one transparent area.
        const h = tools("bucket");
        const layer = make();
        h.open(layer);
        expect(h.tools.options(h.tools.active()!)[FILL_SAMPLE.key]).toBe("layer");
        stroke(h, [p(4, 3)]);
        const all = celImage(layer.doc, layerId(1), FRAME);
        expect(all.data.every((value, index) => value === RED[index % 4])).toBe(true);
        // Composite: the area of the frame inside the black outline, painted on the top layer.
        const g = tools("bucket");
        const composite = make();
        g.open(composite);
        g.tools.setOption(g.tools.active()!, FILL_SAMPLE.key, "composite");
        stroke(g, [p(4, 3)]);
        const top = celImage(composite.doc, layerId(1), FRAME);
        for (let y = 0; y < FRAMED.length; y++) {
            for (let x = 0; x < 16; x++) {
                const inside = x >= 2 && x <= 6 && y >= 2 && y <= 4;
                expect(rgbaAt(top, x, y), `${x}, ${y}`).toEqual(inside ? RED : [0, 0, 0, 0]);
            }
        }
        // The layer below is unchanged.
        expect(rgbaAt(celImage(composite.doc, layerId(0), FRAME), 4, 3)).toEqual(WHITE);
    });

    it("with no cache for the session it composites the frame itself", () => {
        const h = tools("bucket");
        const session = drawn(FRAMED);
        h.open(session);
        const bucket = createBucket({ composites: { cacheOf: () => null } });
        h.registry.register({ ...bucket, id: "se017.bucket" }, "test");
        h.tools.select("se017.bucket");
        h.tools.setOption(h.tools.active()!, FILL_SAMPLE.key, "composite");
        stroke(h, [p(12, 4)]);
        expect(rgbaAt(image(session), 12, 4)).toEqual(RED);
        expect(rgbaAt(image(session), 4, 3)).toEqual(WHITE);
    });

    it("a fill that changes nothing records nothing; a click outside the document fills nothing", () => {
        const h = tools("bucket");
        const session = drawn(FRAMED);
        const { history } = h.open(session);
        h.editor.getState().setForeground(0xffffffff);
        stroke(h, [p(4, 3)]);
        expect(history.undoCount).toBe(0);
        h.editor.getState().setForeground(0xff0000ff);
        stroke(h, [p(-1, 3)]);
        stroke(h, [p(16, 0)]);
        expect(history.undoCount).toBe(0);
        expect(h.errors).toEqual([]);
    });

    it("the right button fills with the background; a drag after the press fills nothing more", () => {
        const h = tools("bucket");
        h.editor.getState().setBackground(0x00ff00ff);
        const session = drawn(FRAMED);
        const { history } = h.open(session);
        stroke(h, [p(4, 3), p(0, 0), p(12, 4)], { button: 2 });
        expect(history.undoCount).toBe(1);
        expect(rgbaAt(image(session), 4, 3)).toEqual([0, 255, 0, 255]);
        expect(rgbaAt(image(session), 0, 0)).toEqual(WHITE);
        expect(rgbaAt(image(session), 12, 4)).toEqual(WHITE);
    });

    it("paints, so it is refused below 1×", () => {
        const h = tools("bucket");
        const session = drawn(FRAMED);
        const { history } = h.open(session, { scale: 0.5, originX: 0, originY: 0 });
        expect(h.pipeline.down(at(h, p(4, 3), { button: 0 }))).toBe(false);
        expect(h.status.getState().feedback).toBe(PAINT_REFUSED.overview);
        expect(history.undoCount).toBe(0);
    });
});

describe("in the app", () => {
    const ids = ["bucket", "line", "rectangle", "ellipse"];

    it("the bucket, line, rectangle and ellipse hold their planned slots and keys, and paint", () => {
        for (const id of ids) {
            const plan = plannedTools.find((entry) => entry.id === id);
            const tool = toolRegistry.get(id);
            expect(tool, id).toBeDefined();
            expect(tool?.paints, id).toBe(true);
            expect(tool?.shortcut, id).toBe(plan?.shortcut);
            expect(tool?.railOrder, id).toBe(plan?.railOrder);
            expect(tool?.icon, id).toBe(plan?.icon);
            expect(toolRegistry.railSlots().find((slot) => slot.id === id)?.tool, id).toBe(tool);
        }
    });

    it("list their options in the context bar's order, the shape tools with the brush", () => {
        const keys = (id: string) => toolRegistry.get(id)?.options.map((option) => option.key);
        expect(keys("line")).toEqual([BRUSH_SIZE.key, BRUSH_SHAPE.key, INK.key, OPACITY.key]);
        expect(keys("rectangle")).toEqual([
            BRUSH_SIZE.key,
            BRUSH_SHAPE.key,
            FILLED.key,
            INK.key,
            OPACITY.key,
        ]);
        expect(keys("ellipse")).toEqual(keys("rectangle"));
        expect(keys("bucket")).toEqual([
            CONTIGUOUS.key,
            FILL_SAMPLE.key,
            TOLERANCE.key,
            INK.key,
            OPACITY.key,
        ]);
        for (const id of ["line", "rectangle", "ellipse"]) {
            const tool = toolRegistry.get(id)!;
            // The very option specs of the brush tools: the brush cursor follows them.
            expect(hasBrush(tool), id).toBe(true);
            expect(tool.hint, id).toMatch(/^Shift: .+ · Ctrl: from the centre$/);
        }
        expect(hasBrush(toolRegistry.get("bucket")!)).toBe(false);
    });

    it("the shape tools hide the system cursor over the document; the bucket shows a crosshair", () => {
        const state = (overDocument: boolean): ToolCursorState => ({
            overDocument,
            pressed: false,
            modifiers: { shift: false, ctrl: false, alt: false, meta: false },
        });
        for (const id of ["line", "rectangle", "ellipse"]) {
            const cursor = toolRegistry.get(id)?.cursor;
            if (typeof cursor !== "function") throw new Error(`${id}: no cursor function`);
            expect(cursor(state(true)), id).toBe("none");
            expect(cursor(state(false)), id).toBe("crosshair");
        }
        expect(toolRegistry.get("bucket")?.cursor).toBe("crosshair");
    });

    it("each keeps its own option values", () => {
        const h = tools("rectangle");
        h.tools.setOption(h.tools.registry.get("rectangle")!, BRUSH_SIZE.key, 5);
        expect(h.tools.options(h.tools.registry.get("rectangle")!)[BRUSH_SIZE.key]).toBe(5);
        expect(h.tools.options(h.tools.registry.get("ellipse")!)[BRUSH_SIZE.key]).toBe(1);
        expect(h.tools.options(h.tools.registry.get("line")!)[BRUSH_SIZE.key]).toBe(1);
    });
});
