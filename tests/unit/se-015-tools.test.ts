import { describe, expect, it } from "vitest";
import {
    BRUSH_SHAPE,
    BRUSH_SIZE,
    INK,
    OPACITY,
    PIXEL_PERFECT,
} from "../../src/app/tools/brush/brushOptions";
import { lastStrokeEnd } from "../../src/app/tools/brush/freehandTool";
import { eraserTool } from "../../src/app/tools/eraser/eraser.tools";
import { pencilTool } from "../../src/app/tools/pencil/pencil.tools";
import { plannedTools } from "../../src/app/tools/planned.tools";
import { toolRegistry } from "../../src/app/tools/toolRegistry";
import type { ToolCursorState } from "../../src/app/tools/types";
import { createEditorStore } from "../../src/app/state/editor";
import { celAt, createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";
import { linePixels } from "../../src/core/raster";
import type { PixelPoint } from "../../src/core/raster";
import { FRAME, celImage, layerId, sprite } from "./se-010-support";
import type { Rgba } from "./se-010-support";
import { at, harness, rgbaAt, stroke } from "./se-014-support";
import type { Harness } from "./se-014-support";

// SE-015: the pencil and the eraser through the pointer pipeline of SE-014, driven by
// synthetic pointer sequences: one stroke is one undo step and undo restores the bytes; the
// buttons, Shift-click lines, the brush options and the eraser's two buttons.

const WIDTH = 16;
const HEIGHT = 12;
const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

function blank(width = WIDTH, height = HEIGHT): DocSession {
    return createDocument({ name: "blank", width, height }, sequentialIds("blank-"));
}

/** One layer whose cel holds a pattern: every pixel differs from its neighbours. */
function patterned(): DocSession {
    const pixels: Rgba[] = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) pixels.push([x * 13, y * 17, (x + y) * 5, 255]);
    }
    const doc = sprite(WIDTH, HEIGHT, [{ pixels }]);
    return { doc, selection: null, activeLayerId: layerId(0), activeFrameId: FRAME };
}

/** A pipeline with the pencil and the eraser registered and `tool` selected. */
function tools(tool: "pencil" | "eraser" = "pencil"): Harness {
    const h = harness([pencilTool, eraserTool]);
    h.tools.select(tool);
    return h;
}

function image(session: DocSession) {
    return celImage(session.doc, session.activeLayerId, session.activeFrameId);
}

/** The pixels of `session`'s active cel that are `rgba`. */
function pixelsOf(session: DocSession, rgba: readonly number[]): PixelPoint[] {
    const cel = image(session);
    const found: PixelPoint[] = [];
    for (let y = 0; y < cel.height; y++) {
        for (let x = 0; x < cel.width; x++) {
            if (rgbaAt(cel, x, y).every((value, index) => value === rgba[index])) {
                found.push({ x, y });
            }
        }
    }
    return found;
}

describe("one stroke is one undo step", () => {
    it("a pencil stroke over painted pixels; undo restores them byte for byte, redo the stroke", () => {
        const h = tools();
        const session = patterned();
        const { history } = h.open(session);
        h.tools.setOption(h.tools.active()!, BRUSH_SIZE.key, 3);
        const before = image(session).data.slice();
        stroke(h, [
            { x: 1, y: 1 },
            { x: 9, y: 4 },
            { x: 14, y: 10 },
            { x: 2, y: 9 },
        ]);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Pencil");
        const after = image(session).data.slice();
        expect(after).not.toEqual(before);
        expect(history.undo()).toBe(true);
        expect(image(session).data).toEqual(before);
        expect(history.redo()).toBe(true);
        expect(image(session).data).toEqual(after);
    });

    it("a stroke on an empty cel creates it; undo removes it again", () => {
        const h = tools();
        const { history, session } = h.open(blank());
        stroke(h, [
            { x: 0, y: 0 },
            { x: 5, y: 3 },
        ]);
        expect(history.undoCount).toBe(1);
        expect(pixelsOf(session, BLACK)).toEqual(linePixels({ x: 0, y: 0 }, { x: 5, y: 3 }));
        history.undo();
        expect(celAt(session.doc, session.activeLayerId, session.activeFrameId)).toBeUndefined();
    });

    it("an eraser stroke over transparent pixels changes nothing and records nothing", () => {
        const h = tools("eraser");
        const { history, session } = h.open(blank());
        stroke(h, [
            { x: 2, y: 2 },
            { x: 8, y: 6 },
        ]);
        expect(history.undoCount).toBe(0);
        expect(celAt(session.doc, session.activeLayerId, session.activeFrameId)).toBeUndefined();
    });
});

describe("buttons and colours", () => {
    it("the pencil paints the foreground with the left button and the background with the right", () => {
        const h = tools();
        const { session } = h.open(blank());
        h.editor.getState().setForeground(0x11223344);
        h.editor.getState().setBackground(0xaabbccff);
        stroke(h, [{ x: 1, y: 1 }]);
        stroke(h, [{ x: 3, y: 1 }], { button: 2 });
        expect(rgbaAt(image(session), 1, 1)).toEqual([0x11, 0x22, 0x33, 0x44]);
        expect(rgbaAt(image(session), 3, 1)).toEqual([0xaa, 0xbb, 0xcc, 0xff]);
    });

    it("the eraser makes pixels transparent with the left button and erases to the background with the right", () => {
        const h = tools("eraser");
        const session = patterned();
        const { history } = h.open(session);
        h.editor.getState().setBackground(0xffffffff);
        stroke(h, [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
        ]);
        expect(pixelsOf(session, CLEAR)).toEqual(linePixels({ x: 0, y: 0 }, { x: 4, y: 0 }));
        stroke(
            h,
            [
                { x: 0, y: 2 },
                { x: 3, y: 2 },
            ],
            { button: 2 },
        );
        expect(pixelsOf(session, WHITE)).toEqual(linePixels({ x: 0, y: 2 }, { x: 3, y: 2 }));
        expect(history.undoLabel).toBe("Eraser");
        expect(history.undoCount).toBe(2);
    });

    it("the eraser's right button composites the background at the eraser's opacity", () => {
        const h = tools("eraser");
        const session = patterned();
        h.open(session);
        h.editor.getState().setBackground(0xffffffff);
        h.tools.setOption(h.tools.active()!, OPACITY.key, 0);
        const before = rgbaAt(image(session), 5, 5);
        stroke(h, [{ x: 5, y: 5 }], { button: 2 });
        expect(rgbaAt(image(session), 5, 5)).toEqual(before);
    });
});

describe("Shift-click", () => {
    it("draws a straight line from the end of the last stroke", () => {
        const h = tools();
        const { history, session } = h.open(blank());
        stroke(h, [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
        ]);
        expect(lastStrokeEnd(session)).toEqual({ x: 2, y: 2 });
        stroke(h, [{ x: 12, y: 7 }], { shiftKey: true });
        expect(history.undoCount).toBe(2);
        expect(pixelsOf(session, BLACK)).toEqual(
            [{ x: 1, y: 1 }, ...linePixels({ x: 2, y: 2 }, { x: 12, y: 7 })].sort(
                (a, b) => a.y - b.y || a.x - b.x,
            ),
        );
        expect(lastStrokeEnd(session)).toEqual({ x: 12, y: 7 });
    });

    it("follows the pointer while held: only the line to the release remains", () => {
        const h = tools();
        const { session } = h.open(blank());
        stroke(h, [{ x: 0, y: 0 }]);
        h.pipeline.down(at(h, { x: 15, y: 0 }, { button: 0, shiftKey: true }));
        h.pipeline.move([at(h, { x: 15, y: 11 }, { shiftKey: true })]);
        h.pipeline.up(at(h, { x: 6, y: 11 }, { button: 0, buttons: 0, shiftKey: true }));
        expect(pixelsOf(session, BLACK)).toEqual(
            linePixels({ x: 0, y: 0 }, { x: 6, y: 11 }).sort((a, b) => a.y - b.y || a.x - b.x),
        );
    });

    it("with no stroke before on the document, starts at the press", () => {
        const h = tools();
        const { session } = h.open(blank());
        expect(lastStrokeEnd(session)).toBeNull();
        stroke(
            h,
            [
                { x: 3, y: 3 },
                { x: 7, y: 3 },
            ],
            { shiftKey: true },
        );
        expect(pixelsOf(session, BLACK)).toEqual(linePixels({ x: 3, y: 3 }, { x: 7, y: 3 }));
    });

    it("a cancelled stroke leaves the last end where it was", () => {
        const h = tools();
        const { session } = h.open(blank());
        stroke(h, [{ x: 4, y: 4 }]);
        h.pipeline.down(at(h, { x: 9, y: 9 }, { button: 0 }));
        h.pipeline.cancel();
        expect(lastStrokeEnd(session)).toEqual({ x: 4, y: 4 });
    });
});

describe("brush options", () => {
    it("the pencil lists size, shape, pixel-perfect, ink and opacity; the eraser all but ink", () => {
        expect(pencilTool.options).toEqual([BRUSH_SIZE, BRUSH_SHAPE, PIXEL_PERFECT, INK, OPACITY]);
        expect(eraserTool.options).toEqual([BRUSH_SIZE, BRUSH_SHAPE, PIXEL_PERFECT, OPACITY]);
        expect(BRUSH_SIZE).toMatchObject({ min: 1, max: 64, default: 1 });
        expect(OPACITY).toMatchObject({ min: 0, max: 255, default: 255 });
        expect(INK.kind === "choice" && INK.choices.map((choice) => choice.value)).toEqual([
            "simple",
            "alpha",
            "lockAlpha",
        ]);
    });

    it("keeps each tool's values: the eraser's size is its own", () => {
        const h = tools();
        h.tools.setOption(h.registry.get("pencil")!, BRUSH_SIZE.key, 8);
        expect(h.tools.options(h.registry.get("pencil")!)[BRUSH_SIZE.key]).toBe(8);
        expect(h.tools.options(h.registry.get("eraser")!)[BRUSH_SIZE.key]).toBe(1);
    });

    it("paints with the brush's size and shape", () => {
        const h = tools();
        const { session } = h.open(blank());
        const pencil = h.tools.active()!;
        h.tools.setOption(pencil, BRUSH_SIZE.key, 4);
        h.tools.setOption(pencil, BRUSH_SHAPE.key, "square");
        stroke(h, [{ x: 5, y: 5 }]);
        const square = pixelsOf(session, BLACK);
        expect(square).toHaveLength(16);
        expect(square[0]).toEqual({ x: 3, y: 3 });
        expect(square.at(-1)).toEqual({ x: 6, y: 6 });
        h.tools.setOption(pencil, BRUSH_SHAPE.key, "circle");
        h.editor.getState().setForeground(0xffffffff);
        stroke(h, [{ x: 5, y: 5 }]);
        // The circle of 4 leaves the square's corners black.
        expect(pixelsOf(session, WHITE)).toHaveLength(12);
        expect(pixelsOf(session, BLACK)).toEqual([
            { x: 3, y: 3 },
            { x: 6, y: 3 },
            { x: 3, y: 6 },
            { x: 6, y: 6 },
        ]);
    });

    it("pixel-perfect removes the corners of a slow staircase", () => {
        const h = tools();
        const { session } = h.open(blank());
        h.tools.setOption(h.tools.active()!, PIXEL_PERFECT.key, true);
        const path = [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 2, y: 1 },
            { x: 2, y: 2 },
            { x: 3, y: 2 },
            { x: 3, y: 3 },
        ];
        stroke(h, path);
        expect(pixelsOf(session, BLACK)).toEqual([
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 2, y: 2 },
            { x: 3, y: 3 },
        ]);
    });

    it("the ink and opacity options apply: alpha compositing at half opacity", () => {
        const h = tools();
        const session = patterned();
        h.open(session);
        const pencil = h.tools.active()!;
        h.tools.setOption(pencil, INK.key, "alpha");
        h.tools.setOption(pencil, OPACITY.key, 128);
        const before = rgbaAt(image(session), 4, 4);
        stroke(h, [{ x: 4, y: 4 }]);
        // Over an opaque pixel: Rc = Bc + trunc((0 - Bc) * 128 / 255).
        expect(rgbaAt(image(session), 4, 4)).toEqual([
            ...before.slice(0, 3).map((value) => value + Math.trunc((-value * 128) / 255)),
            255,
        ]);
    });
});

describe("a fast drag through the pipeline", () => {
    it("a diagonal drag across 64 × 64 at 2000 px/s, four coalesced samples per event, leaves no gap", () => {
        const h = tools();
        const { session } = h.open(blank(64, 64), { scale: 8, originX: 0, originY: 0 });
        // Client positions along the diagonal from the centre of texel 0, 0 to that of 63, 63,
        // one sample every 4 ms at 2000 px/s along the drag.
        const end = 63 * 8 + 4;
        const length = Math.hypot(end - 4, end - 4);
        const count = Math.ceil(length / (2000 * 0.004));
        const samples = Array.from({ length: count + 1 }, (_, index) => {
            const position = 4 + ((end - 4) * index) / count;
            return { ...at(h, { x: 0, y: 0 }), clientX: position, clientY: position };
        });
        expect(samples[1]!.clientX - samples[0]!.clientX).toBeGreaterThan(5);
        h.pipeline.down({ ...samples[0]!, button: 0 });
        for (let index = 1; index < samples.length; index += 4) {
            h.pipeline.move(samples.slice(index, index + 4));
        }
        h.pipeline.up({ ...samples.at(-1)!, button: 0, buttons: 0 });
        expect(pixelsOf(session, BLACK)).toEqual(
            Array.from({ length: 64 }, (_, index) => ({ x: index, y: index })),
        );
    });
});

describe("in the app", () => {
    it("the pencil and the eraser hold their planned slots and keys; the pencil is the default tool", () => {
        for (const id of ["pencil", "eraser"]) {
            const plan = plannedTools.find((entry) => entry.id === id);
            const tool = toolRegistry.get(id);
            expect(tool, id).toBeDefined();
            expect(tool?.paints, id).toBe(true);
            expect(tool?.shortcut, id).toBe(plan?.shortcut);
            expect(tool?.railOrder, id).toBe(plan?.railOrder);
            expect(tool?.icon, id).toBe(plan?.icon);
            expect(toolRegistry.railSlots().find((slot) => slot.id === id)?.tool, id).toBe(tool);
        }
        expect(toolRegistry.get(createEditorStore().getState().tool)).toBe(
            toolRegistry.get("pencil"),
        );
    });

    it("hides the system cursor over the document and shows a crosshair beside it", () => {
        const state = (overDocument: boolean): ToolCursorState => ({
            overDocument,
            pressed: false,
            modifiers: { shift: false, ctrl: false, alt: false, meta: false },
        });
        for (const tool of [pencilTool, eraserTool]) {
            const cursor = tool.cursor;
            expect(typeof cursor).toBe("function");
            if (typeof cursor !== "function") continue;
            expect(cursor(state(true))).toBe("none");
            expect(cursor(state(false))).toBe("crosshair");
        }
    });
});
