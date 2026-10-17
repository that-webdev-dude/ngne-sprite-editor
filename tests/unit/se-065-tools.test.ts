import { describe, expect, it } from "vitest";
import { createToolState } from "../../src/app/tools/activeTool";
import {
    BRUSH_SHAPE,
    BRUSH_SIZE,
    brushOf,
    INK,
    OPACITY,
} from "../../src/app/tools/brush/brushOptions";
import { contourTool } from "../../src/app/tools/contour/contour.tools";
import { CURVE_HINT, curveTool } from "../../src/app/tools/curve/curve.tools";
import { PAINT_REFUSED } from "../../src/app/tools/paintTarget";
import type { PointerInput } from "../../src/app/tools/pipeline";
import { plannedTools } from "../../src/app/tools/planned.tools";
import { POLYGON_HINT, polygonTool } from "../../src/app/tools/polygon/polygon.tools";
import { FILLED } from "../../src/app/tools/shapes/shapeTool";
import { spraySeeds, sprayTool } from "../../src/app/tools/spray/spray.tools";
import { createSprayTool, SPRAY_DENSITY, SPRAY_RADIUS } from "../../src/app/tools/spray/sprayTool";
import { toolRegistry } from "../../src/app/tools/toolRegistry";
import type { ToolSpec } from "../../src/app/tools/types";
import { createEditorStore } from "../../src/app/state/editor";
import { compositeFrame } from "../../src/core/composite";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import { clonePixelBuffer } from "../../src/core/pixels";
import { ContourStroke, paintInk, ShapeStroke, SprayStroke } from "../../src/core/raster";
import type { PathShape, PixelPoint } from "../../src/core/raster";
import { selectionOf } from "../../src/core/selection";
import { readSpecKeyTable } from "../e2e/se-007-spec-keys";
import { FRAME, celImage, layerId, sprite } from "./se-010-support";
import type { Rgba } from "./se-010-support";
import { at, harness, rgbaAt, stroke } from "./se-014-support";
import type { Harness } from "./se-014-support";
import { maskOf } from "./se-030-support";

// SE-065: the curve, the polygon, the contour and the spray through the pointer pipeline of
// SE-014, driven by synthetic pointer sequences (SPEC §7.1, Curve, contour, polygon and spray).
// The curve and the polygon are gestures of several presses whose preview is the result, kept
// by their last release (the curve), Enter or a double click (`closeGesture`); the contour
// fills at its release what the polygon through the same points fills; the spray with a fixed
// seed draws the same stroke twice. Each is one undo step labelled with its name, Escape takes
// it back, and paint stays inside the selection and off a guarded layer. The app's rail holds
// them as variants of the pencil's, the line's and the rectangle's slots.

const WIDTH = 24;
const HEIGHT = 16;
const RED = 0xff0000ff;
const GREEN = 0x00ff00ff;
const p = (x: number, y: number): PixelPoint => ({ x, y });

/** One layer whose cel holds a pattern: every pixel differs from its neighbours. */
function patterned(width = WIDTH, height = HEIGHT): DocSession {
    const pixels: Rgba[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) pixels.push([x * 9, y * 15, (x + y) * 5, 255]);
    }
    const doc = sprite(width, height, [{ pixels }]);
    return { doc, selection: null, activeLayerId: layerId(0), activeFrameId: FRAME };
}

function blank(width = WIDTH, height = HEIGHT): DocSession {
    return createDocument({ name: "blank", width, height }, sequentialIds("blank-"));
}

function image(session: DocSession): PixelBuffer {
    return celImage(session.doc, session.activeLayerId, session.activeFrameId);
}

/** Seeds that count up from `first`. */
function counting(first: number) {
    let next = first;
    return { next: () => next++ };
}

const TOOLS: readonly ToolSpec[] = [curveTool, polygonTool, contourTool];

/** A pipeline with the SE-065 tools (the spray seeded from `seeds`), `tool` selected, red on green. */
function tools(tool: string, seeds = counting(1)): Harness {
    const h = harness([...TOOLS, createSprayTool(seeds)]);
    h.tools.select(tool);
    h.editor.getState().setForeground(RED);
    h.editor.getState().setBackground(GREEN);
    return h;
}

/** A press and a release on `pixel`. */
function click(h: Harness, pixel: PixelPoint, fields: Partial<PointerInput> = {}): void {
    const button = fields.button ?? 0;
    h.pipeline.down(at(h, pixel, { ...fields, button, buttons: button === 2 ? 2 : 1 }));
    h.pipeline.up(at(h, pixel, { ...fields, button, buttons: 0 }));
}

/** The pointer moved to `pixel` with no button held. */
function hover(h: Harness, pixel: PixelPoint): void {
    h.pipeline.move([at(h, pixel, { buttons: 0 })]);
}

/** What `before` becomes with `shape` drawn by the active tool's options in `colour`. */
function drawnShape(h: Harness, before: PixelBuffer, shape: PathShape, colour = RED) {
    const values = h.tools.options(h.tools.active()!);
    const result = clonePixelBuffer(before);
    new ShapeStroke(result, before, {
        brush: brushOf(values),
        ink: paintInk("simple", colour, 255),
    }).draw(shape);
    return Array.from(result.data);
}

/** A curve gesture: a drag from `start` to `end`, a click on each control point. */
function curveGesture(
    h: Harness,
    start: PixelPoint,
    end: PixelPoint,
    c1: PixelPoint,
    c2: PixelPoint,
) {
    h.pipeline.down(at(h, start, { button: 0 }));
    h.pipeline.move([at(h, end, { buttons: 1 })]);
    h.pipeline.up(at(h, end, { button: 0, buttons: 0 }));
    hover(h, c1);
    click(h, c1);
    hover(h, c2);
    click(h, c2);
}

describe("curve", () => {
    const START = p(2, 13);
    const END = p(21, 12);
    const C1 = p(4, 1);
    const C2 = p(18, 2);

    it("a drag and two clicks draw the curve start, controls, end and keep it as one undo step", () => {
        const h = tools("curve");
        const session = patterned();
        const { history } = h.open(session);
        const before = clonePixelBuffer(image(session));
        curveGesture(h, START, END, C1, C2);
        expect(h.pipeline.stroking).toBe(false);
        expect(h.pipeline.gesture).toBe(false);
        expect(Array.from(image(session).data)).toEqual(
            drawnShape(h, before, { kind: "curve", points: [START, C1, C2, END] }),
        );
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Curve");
        expect(history.transaction).toBeNull();
        history.undo();
        expect(Array.from(image(session).data)).toEqual(Array.from(before.data));
        history.redo();
        expect(Array.from(image(session).data)).toEqual(
            drawnShape(h, before, { kind: "curve", points: [START, C1, C2, END] }),
        );
        expect(h.errors).toEqual([]);
    });

    it("shows each step as it goes: the line while dragging, both controls on the pointer, then the second", () => {
        const h = tools("curve");
        const session = patterned();
        h.open(session);
        const before = clonePixelBuffer(image(session));
        const shows = (points: PixelPoint[]) =>
            expect(Array.from(image(session).data)).toEqual(
                drawnShape(h, before, { kind: "curve", points }),
            );
        h.pipeline.down(at(h, START, { button: 0 }));
        expect(h.pipeline.gesture).toBe(true);
        shows([START, START, START, START]);
        h.pipeline.move([at(h, p(10, 10), { buttons: 1 })]);
        shows([START, p(10, 10), p(10, 10), p(10, 10)]);
        h.pipeline.up(at(h, END, { button: 0, buttons: 0 }));
        shows([START, END, END, END]);
        hover(h, p(9, 3));
        shows([START, p(9, 3), p(9, 3), END]);
        // The second press and its drag move both control points; its release fixes the first.
        h.pipeline.down(at(h, p(8, 4), { button: 0 }));
        shows([START, p(8, 4), p(8, 4), END]);
        h.pipeline.move([at(h, C1, { buttons: 1 })]);
        h.pipeline.up(at(h, C1, { button: 0, buttons: 0 }));
        shows([START, C1, C1, END]);
        hover(h, p(15, 8));
        shows([START, C1, p(15, 8), END]);
        // The live composite follows the preview between the presses too.
        h.frames.run();
        const composite = h.composites.cacheOf(session)?.get(FRAME);
        expect(composite && Array.from(composite.data)).toEqual(
            Array.from(compositeFrame(session.doc, FRAME).data),
        );
        // The third press and its drag move the second; its release keeps the curve.
        h.pipeline.down(at(h, p(16, 5), { button: 0 }));
        shows([START, C1, p(16, 5), END]);
        h.pipeline.move([at(h, C2, { buttons: 1 })]);
        expect(h.pipeline.gesture).toBe(true);
        h.pipeline.up(at(h, C2, { button: 0, buttons: 0 }));
        shows([START, C1, C2, END]);
        expect(h.pipeline.gesture).toBe(false);
        expect(h.document().history.undoCount).toBe(1);
    });

    it("Enter keeps the curve as shown: after the drag, the straight line", () => {
        const h = tools("curve");
        const session = patterned();
        const { history } = h.open(session);
        const before = clonePixelBuffer(image(session));
        h.pipeline.down(at(h, START, { button: 0 }));
        h.pipeline.up(at(h, END, { button: 0, buttons: 0 }));
        hover(h, C1);
        expect(h.pipeline.closeGesture()).toBe(true);
        expect(Array.from(image(session).data)).toEqual(
            drawnShape(h, before, { kind: "curve", points: [START, C1, C1, END] }),
        );
        expect(history.undoCount).toBe(1);
        // A new curve begins at the next press.
        click(h, p(3, 3));
        expect(h.pipeline.gesture).toBe(true);
        h.pipeline.cancel();
        expect(history.undoCount).toBe(1);
    });

    it("Escape, a change of tool and a pointer cancel take the curve back and record nothing", () => {
        const h = tools("curve");
        const session = patterned();
        const { history } = h.open(session);
        const before = Array.from(image(session).data);
        h.pipeline.down(at(h, START, { button: 0 }));
        h.pipeline.up(at(h, END, { button: 0, buttons: 0 }));
        hover(h, C1);
        expect(h.pipeline.cancel()).toBe(true);
        expect(Array.from(image(session).data)).toEqual(before);
        h.pipeline.down(at(h, START, { button: 0 }));
        h.pipeline.up(at(h, END, { button: 0, buttons: 0 }));
        click(h, C1);
        h.tools.select("polygon");
        expect(h.pipeline.stroking).toBe(false);
        expect(Array.from(image(session).data)).toEqual(before);
        expect(history.undoCount).toBe(0);
        expect(history.transaction).toBeNull();
    });

    it("the right button draws in the background colour; later presses keep the first press's colour", () => {
        const h = tools("curve");
        const session = patterned();
        h.open(session);
        const before = clonePixelBuffer(image(session));
        h.pipeline.down(at(h, START, { button: 2, buttons: 2 }));
        h.pipeline.up(at(h, END, { button: 2, buttons: 0 }));
        click(h, C1);
        click(h, C2, { button: 2 });
        expect(Array.from(image(session).data)).toEqual(
            drawnShape(h, before, { kind: "curve", points: [START, C1, C2, END] }, GREEN),
        );
    });
});

describe("polygon", () => {
    const VERTICES = [p(2, 2), p(20, 3), p(12, 7), p(19, 13), p(3, 12)];

    it("clicks add vertices; Enter closes the polygon through them as one undo step", () => {
        const h = tools("polygon");
        const session = patterned();
        const { history } = h.open(session);
        const before = clonePixelBuffer(image(session));
        for (const vertex of VERTICES) click(h, vertex);
        expect(h.pipeline.gesture).toBe(true);
        expect(history.undoCount).toBe(0);
        expect(h.pipeline.closeGesture()).toBe(true);
        expect(Array.from(image(session).data)).toEqual(
            drawnShape(h, before, { kind: "polygon", points: VERTICES, filled: false }),
        );
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Polygon");
        expect(h.pipeline.gesture).toBe(false);
        history.undo();
        expect(Array.from(image(session).data)).toEqual(Array.from(before.data));
    });

    it("runs through the vertices and the pointer until it is closed; a drag adds its press and its release", () => {
        const h = tools("polygon");
        const session = patterned();
        h.open(session);
        const before = clonePixelBuffer(image(session));
        const shows = (points: PixelPoint[]) =>
            expect(Array.from(image(session).data)).toEqual(
                drawnShape(h, before, { kind: "polygon", points, filled: false }),
            );
        click(h, p(2, 2));
        shows([p(2, 2)]);
        hover(h, p(20, 3));
        shows([p(2, 2), p(20, 3)]);
        h.pipeline.down(at(h, p(20, 3), { button: 0 }));
        h.pipeline.move([at(h, p(14, 6), { buttons: 1 })]);
        shows([p(2, 2), p(20, 3), p(14, 6)]);
        h.pipeline.up(at(h, p(12, 7), { button: 0, buttons: 0 }));
        shows([p(2, 2), p(20, 3), p(12, 7)]);
        hover(h, p(5, 13));
        shows([p(2, 2), p(20, 3), p(12, 7), p(5, 13)]);
        // A double click: its two presses on one pixel add one vertex; then it closes.
        click(h, p(5, 13));
        click(h, p(5, 13));
        hover(h, p(22, 1));
        h.pipeline.closeGesture();
        shows([p(2, 2), p(20, 3), p(12, 7), p(5, 13)]);
    });

    it("Filled adds the inside by the even-odd rule, in the preview and when closed", () => {
        const h = tools("polygon");
        h.tools.setOption(h.tools.active()!, FILLED.key, true);
        h.tools.setOption(h.tools.active()!, BRUSH_SIZE.key, 2);
        const session = patterned();
        h.open(session);
        const before = clonePixelBuffer(image(session));
        for (const vertex of VERTICES.slice(0, 4)) click(h, vertex);
        hover(h, VERTICES[4]);
        expect(Array.from(image(session).data)).toEqual(
            drawnShape(h, before, { kind: "polygon", points: VERTICES, filled: true }),
        );
        h.pipeline.closeGesture();
        expect(Array.from(image(session).data)).toEqual(
            drawnShape(h, before, { kind: "polygon", points: VERTICES.slice(0, 4), filled: true }),
        );
    });

    it("fewer than 3 vertices draw their line; Escape and a change of tool take it back", () => {
        const h = tools("polygon");
        const session = patterned();
        const { history } = h.open(session);
        const before = clonePixelBuffer(image(session));
        click(h, p(1, 1));
        click(h, p(9, 5));
        h.pipeline.closeGesture();
        expect(Array.from(image(session).data)).toEqual(
            drawnShape(h, before, { kind: "polygon", points: [p(1, 1), p(9, 5)], filled: false }),
        );
        expect(history.undoCount).toBe(1);
        const kept = Array.from(image(session).data);
        click(h, p(3, 3));
        click(h, p(15, 3));
        click(h, p(15, 9));
        h.pipeline.cancel();
        expect(Array.from(image(session).data)).toEqual(kept);
        click(h, p(3, 3));
        click(h, p(15, 3));
        h.tools.select("curve");
        expect(Array.from(image(session).data)).toEqual(kept);
        expect(history.undoCount).toBe(1);
    });
});

describe("contour", () => {
    const PATH = [p(3, 2), p(12, 1), p(20, 4), p(13, 7), p(19, 13), p(6, 14), p(9, 8)];

    function drag(h: Harness, path: readonly PixelPoint[], fields: Partial<PointerInput> = {}) {
        stroke(h, path, fields);
    }

    it("the release closes the path and fills it: what the polygon tool's filled polygon through the same points covers", () => {
        const h = tools("contour");
        h.tools.setOption(h.tools.active()!, BRUSH_SIZE.key, 3);
        const session = patterned();
        const { history } = h.open(session);
        drag(h, PATH);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Contour");

        const other = tools("polygon");
        other.tools.setOption(other.tools.active()!, BRUSH_SIZE.key, 3);
        other.tools.setOption(other.tools.active()!, FILLED.key, true);
        const twin = patterned();
        other.open(twin);
        for (const point of PATH) click(other, point);
        other.pipeline.closeGesture();
        expect(Array.from(image(session).data)).toEqual(Array.from(image(twin).data));
        expect(Array.from(image(session).data)).not.toEqual(Array.from(image(patterned()).data));
    });

    it("draws the path while the button is held, and fills at the release", () => {
        const h = tools("contour");
        const session = patterned();
        h.open(session);
        const before = clonePixelBuffer(image(session));
        h.pipeline.down(at(h, PATH[0], { button: 0 }));
        for (const point of PATH.slice(1)) h.pipeline.move([at(h, point, { buttons: 1 })]);
        const path = clonePixelBuffer(before);
        const expected = new ContourStroke(path, before, {
            brush: brushOf(h.tools.options(h.tools.active()!)),
            ink: paintInk("simple", RED, 255),
        });
        for (const point of PATH) expected.to(point);
        expect(Array.from(image(session).data)).toEqual(Array.from(path.data));
        h.pipeline.up(at(h, PATH[PATH.length - 1], { button: 0, buttons: 0 }));
        expected.close();
        expect(Array.from(image(session).data)).toEqual(Array.from(path.data));
    });

    it("Escape during the drag takes it back; the right button fills with the background", () => {
        const h = tools("contour");
        const session = patterned();
        const { history } = h.open(session);
        const before = Array.from(image(session).data);
        h.pipeline.down(at(h, PATH[0], { button: 0 }));
        h.pipeline.move([at(h, PATH[1], { buttons: 1 }), at(h, PATH[2], { buttons: 1 })]);
        h.pipeline.cancel();
        expect(Array.from(image(session).data)).toEqual(before);
        expect(history.undoCount).toBe(0);
        drag(h, [p(4, 4), p(14, 4), p(14, 12), p(4, 12)], { button: 2 });
        expect(rgbaAt(image(session), 9, 8)).toEqual([0, 255, 0, 255]);
        expect(rgbaAt(image(session), 4, 4)).toEqual([0, 255, 0, 255]);
    });
});

describe("spray", () => {
    const PATH = [p(6, 6), p(12, 7), p(17, 11), p(17, 11), p(9, 13)];

    function sprayOnce(seed: number): { session: DocSession; h: Harness } {
        const h = tools("spray", counting(seed));
        const session = patterned();
        h.open(session);
        stroke(h, PATH);
        return { session, h };
    }

    it("lists the brush, radius and density, then ink and opacity; one seed per stroke from its source", () => {
        expect(sprayTool.options?.map((option) => option.key)).toEqual([
            BRUSH_SIZE.key,
            BRUSH_SHAPE.key,
            SPRAY_RADIUS.key,
            SPRAY_DENSITY.key,
            INK.key,
            OPACITY.key,
        ]);
        expect([SPRAY_RADIUS.min, SPRAY_RADIUS.max, SPRAY_RADIUS.default]).toEqual([1, 64, 8]);
        expect([SPRAY_DENSITY.min, SPRAY_DENSITY.max, SPRAY_DENSITY.default]).toEqual([1, 100, 20]);
        const seeds: number[] = [];
        const h = harness([
            createSprayTool({ next: () => (seeds.push(seeds.length), seeds.length) }),
        ]);
        h.tools.select("spray");
        h.open(patterned());
        stroke(h, [p(3, 3)]);
        stroke(h, [p(9, 9)]);
        expect(seeds).toEqual([0, 1]);
    });

    it("with a fixed seed is reproducible: the same seed and samples draw the same stroke", () => {
        const first = sprayOnce(5);
        const again = sprayOnce(5);
        expect(Array.from(image(again.session).data)).toEqual(
            Array.from(image(first.session).data),
        );
        // It is the core's stroke with that seed and the options.
        const before = image(patterned());
        const expected = clonePixelBuffer(before);
        const values = first.h.tools.options(first.h.tools.active()!);
        const spray = new SprayStroke(expected, before, {
            brush: brushOf(values),
            ink: paintInk("simple", RED, 255),
            radius: SPRAY_RADIUS.default,
            density: SPRAY_DENSITY.default,
            seed: 5,
        });
        spray.start(PATH[0]);
        for (const point of PATH.slice(1)) spray.to(point);
        expect(Array.from(image(first.session).data)).toEqual(Array.from(expected.data));
        const other = sprayOnce(6);
        expect(Array.from(image(other.session).data)).not.toEqual(
            Array.from(image(first.session).data),
        );
    });

    it("one stroke is one undo step; undo and redo put back the very pixels", () => {
        const { session, h } = sprayOnce(11);
        const { history } = h.document();
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Spray");
        const sprayed = Array.from(image(session).data);
        history.undo();
        expect(Array.from(image(session).data)).toEqual(Array.from(image(patterned()).data));
        history.redo();
        expect(Array.from(image(session).data)).toEqual(sprayed);
    });

    it("takes its radius and density from the options; Escape takes the stroke back", () => {
        const h = tools("spray", counting(3));
        const spray = h.tools.active()!;
        h.tools.setOption(spray, SPRAY_RADIUS.key, 2);
        h.tools.setOption(spray, SPRAY_DENSITY.key, 100);
        const session = blank();
        const { history } = h.open(session);
        stroke(h, [p(10, 8)]);
        // Every offset of the disk of radius 2, 13 dots: the brush of 1 px lands within it.
        const painted: PixelPoint[] = [];
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++)
                if (rgbaAt(image(session), x, y)[3] !== 0) painted.push(p(x, y));
        }
        expect(painted.length).toBeGreaterThan(0);
        for (const { x, y } of painted) expect((x - 10) ** 2 + (y - 8) ** 2).toBeLessThanOrEqual(4);
        const kept = Array.from(image(session).data);
        h.pipeline.down(at(h, p(4, 4), { button: 0 }));
        h.pipeline.move([at(h, p(14, 4), { buttons: 1 })]);
        h.pipeline.cancel();
        expect(Array.from(image(session).data)).toEqual(kept);
        expect(history.undoCount).toBe(1);
    });

    it("the app's spray takes its seeds from `spraySeeds`", () => {
        const next = spraySeeds.next;
        try {
            spraySeeds.next = () => 5;
            const h = harness([sprayTool]);
            h.tools.select("spray");
            h.editor.getState().setForeground(RED);
            const session = patterned();
            h.open(session);
            stroke(h, PATH);
            expect(Array.from(image(session).data)).toEqual(
                Array.from(image(sprayOnce(5).session).data),
            );
        } finally {
            spraySeeds.next = next;
        }
    });
});

describe("selection clipping and layer guards", () => {
    /** Selected: the rectangle 6..15 × 4..10. */
    const rows = Array.from({ length: HEIGHT }, (_, y) =>
        Array.from({ length: WIDTH }, (_, x) =>
            x >= 6 && x <= 15 && y >= 4 && y <= 10 ? "#" : ".",
        ).join(""),
    );
    const isSelected = ({ x, y }: PixelPoint) => rows[y][x] === "#";

    /** Each tool's way through a document, across the selection's edges. */
    const draws: [string, (h: Harness) => void][] = [
        ["curve", (h) => curveGesture(h, p(1, 14), p(22, 2), p(2, 1), p(20, 15))],
        [
            "polygon",
            (h) => {
                h.tools.setOption(h.tools.active()!, FILLED.key, true);
                for (const vertex of [p(1, 1), p(22, 2), p(20, 14), p(2, 13)]) click(h, vertex);
                h.pipeline.closeGesture();
            },
        ],
        ["contour", (h) => stroke(h, [p(1, 1), p(22, 2), p(20, 14), p(2, 13)])],
        [
            "spray",
            (h) => {
                h.tools.setOption(h.tools.active()!, SPRAY_DENSITY.key, 100);
                stroke(h, [p(1, 7), p(22, 7)]);
            },
        ],
    ];

    for (const [id, draw] of draws) {
        it(`${id}: changes pixels only inside the selection, the preview included`, () => {
            const h = tools(id);
            const session = patterned();
            session.selection = selectionOf(maskOf(rows));
            const { history } = h.open(session);
            const before = Array.from(image(session).data);
            draw(h);
            expect(history.undoCount).toBe(1);
            const after = Array.from(image(session).data);
            let inside = 0;
            for (let y = 0; y < HEIGHT; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    const at4 = (y * WIDTH + x) * 4;
                    const same = [0, 1, 2, 3].every((c) => before[at4 + c] === after[at4 + c]);
                    if (!same) {
                        expect(isSelected(p(x, y)), `${x}, ${y}`).toBe(true);
                        inside++;
                    }
                }
            }
            expect(inside).toBeGreaterThan(0);
        });

        for (const [guard, change, message] of [
            [
                "locked",
                (s: DocSession) => void (s.doc.layers[0].locked = true),
                PAINT_REFUSED.locked,
            ],
            [
                "hidden",
                (s: DocSession) => void (s.doc.layers[0].visible = false),
                PAINT_REFUSED.hidden,
            ],
        ] as const) {
            it(`${id}: refused on a ${guard} layer with a status-bar message, no pixel changed`, () => {
                const h = tools(id);
                const session = patterned();
                const { history } = h.open(session);
                change(session);
                const before = Array.from(image(session).data);
                draw(h);
                expect(h.pipeline.stroking).toBe(false);
                expect(history.undoCount).toBe(0);
                expect(history.transaction).toBeNull();
                expect(Array.from(image(session).data)).toEqual(before);
                expect(h.status.getState().feedback).toBe(message);
            });
        }

        it(`${id}: refused on a reference layer and below 1×`, () => {
            const h = tools(id);
            const session = patterned();
            h.open(session);
            session.doc.layers.push({
                id: "reference",
                name: "Reference",
                kind: "reference",
                visible: true,
                locked: false,
                opacity: 128,
                sourceId: "source",
                x: 0,
                y: 0,
                scale: 1,
                placement: "behind",
            });
            session.activeLayerId = "reference";
            expect(h.pipeline.down(at(h, p(3, 3), { button: 0 }))).toBe(false);
            expect(h.status.getState().feedback).toBe(PAINT_REFUSED.reference);
            const zoomed = tools(id);
            zoomed.open(patterned(), { scale: 0.5, originX: 0, originY: 0 });
            expect(zoomed.pipeline.down(at(zoomed, p(3, 3), { button: 0 }))).toBe(false);
            expect(zoomed.status.getState().feedback).toBe(PAINT_REFUSED.overview);
        });
    }
});

describe("a tool closing its own gesture (ToolContext.closeGesture)", () => {
    it("from a release: onClose, then kept and committed; from a press: the press ends with it", () => {
        const calls: string[] = [];
        let presses = 0;
        const probe: ToolSpec = {
            id: "probe",
            label: "Probe",
            paints: true,
            onDown(context, pointer) {
                presses++;
                context.openGesture();
                const { paint } = context;
                if (paint) {
                    paint.image.data.set(
                        [1, 2, 3, 255],
                        (pointer.pixel.y * paint.image.width + pointer.pixel.x) * 4,
                    );
                    paint.markDirty({
                        x: pointer.pixel.x,
                        y: pointer.pixel.y,
                        width: 1,
                        height: 1,
                    });
                }
                if (presses === 4) context.closeGesture();
            },
            onUp(context) {
                if (presses === 2) context.closeGesture();
            },
            onClose: () => void calls.push("close"),
            onCommit: (_context, recorded) => void calls.push(`commit ${recorded}`),
            onCancel: () => void calls.push("cancel"),
        };
        const h = harness([probe]);
        h.tools.select("probe");
        const { history } = h.open(blank());
        click(h, p(1, 1));
        expect(h.pipeline.gesture).toBe(true);
        click(h, p(2, 1));
        expect(h.pipeline.gesture).toBe(false);
        expect(calls).toEqual(["close", "commit true"]);
        expect(history.undoCount).toBe(1);
        // Closed from a press: the press is not the pipeline's any more, its release is ignored.
        click(h, p(3, 1));
        expect(h.pipeline.down(at(h, p(4, 1), { button: 0 }))).toBe(false);
        expect(h.pipeline.stroking).toBe(false);
        h.pipeline.up(at(h, p(4, 1), { button: 0, buttons: 0 }));
        expect(calls).toEqual(["close", "commit true", "close", "commit true"]);
        expect(history.undoCount).toBe(2);
        expect(h.errors).toEqual([]);
    });
});

describe("in the app", () => {
    const canvasKeys = readSpecKeyTable()
        .bindings.filter((binding) => binding.context === "canvas")
        .map((binding) => binding.chord);
    const slotOfTool = (id: string) =>
        toolRegistry.railSlots().find((slot) => slot.variants.some((tool) => tool.id === id));

    for (const [id, slot, key, label] of [
        ["spray", "pencil", "Shift+B", "Spray"],
        ["curve", "line", "Shift+L", "Curve"],
        ["contour", "rectangle", "D", "Contour"],
        ["polygon", "rectangle", "Shift+D", "Polygon"],
    ] as const) {
        it(`${label}: a variant of the ${slot}'s slot on ${key}, a paint tool with the brush cursor`, () => {
            const tool = toolRegistry.get(id);
            expect(tool, id).toBeDefined();
            expect(tool?.variantOf).toBe(slot);
            expect(tool?.shortcut).toBe(key);
            expect(canvasKeys).toContain(key);
            expect(tool?.label).toBe(label);
            expect(tool?.paints).toBe(true);
            expect(tool?.icon).toBeDefined();
            expect(slotOfTool(id)?.id).toBe(slot);
            expect(slotOfTool(id)?.variants[0]?.id).toBe(slot);
            expect(typeof tool?.cursor).toBe("function");
        });
    }

    it("keeps the planned slots of the rail: the variants take none of their own", () => {
        expect(toolRegistry.railSlots().map((slot) => slot.id)).toEqual(
            plannedTools.map((plan) => plan.id),
        );
    });

    it("a key pressed again switches within its slot only among its letter: B, L and D", () => {
        const state = createToolState(createEditorStore(), toolRegistry);
        const next = (id: string) => state.nextVariant(id)?.id ?? null;
        expect(next("pencil")).toBe("spray");
        expect(next("spray")).toBe("pencil");
        expect(next("line")).toBe("curve");
        expect(next("curve")).toBe("line");
        expect(next("contour")).toBe("polygon");
        expect(next("polygon")).toBe("contour");
        // U is the rectangle's alone in its slot.
        expect(next("rectangle")).toBeNull();
    });

    it("the curve and the polygon name their gesture's keys in the hint", () => {
        expect(curveTool.hint).toBe(CURVE_HINT);
        expect(CURVE_HINT).toContain("Enter");
        expect(polygonTool.hint).toBe(POLYGON_HINT);
        expect(POLYGON_HINT).toContain("Enter or double-click: close");
    });
});
