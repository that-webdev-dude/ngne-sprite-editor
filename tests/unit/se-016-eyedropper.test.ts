import { describe, expect, it } from "vitest";
import { createEyedropper, SAMPLE_OPTION } from "../../src/app/tools/eyedropper/eyedropper";
import { eyedropperTool } from "../../src/app/tools/eyedropper/eyedropper.tools";
import { pencilTool } from "../../src/app/tools/pencil/pencil.tools";
import { plannedTools } from "../../src/app/tools/planned.tools";
import { toolRegistry } from "../../src/app/tools/toolRegistry";
import { compositeFrame } from "../../src/core/composite";
import type { DocSession } from "../../src/core/model";
import { FRAME, layerId, sprite } from "./se-010-support";
import type { Rgba } from "./se-010-support";
import { at, harness, stroke } from "./se-014-support";
import type { Harness } from "./se-014-support";

// SE-016: the eyedropper through the pointer pipeline of SE-014, driven by synthetic pointer
// sequences: the left button picks into the foreground and the right into the background,
// the exact RGBA of the composite or of the active layer; transparent pixels give alpha 0;
// nothing is painted or recorded, at any zoom step.

const WIDTH = 8;
const HEIGHT = 6;

/** Every pixel different: red and green from the position, blue fixed, opaque. */
function pattern(blue: number): Rgba[] {
    const pixels: Rgba[] = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) pixels.push([x * 30, y * 40, blue, 255]);
    }
    return pixels;
}

/**
 * Two layers: the bottom one holds the pattern, the top one a half-transparent magenta over
 * the left half and transparent pixels elsewhere. The bottom layer is the active one.
 */
function layered(): DocSession {
    const top: Rgba[] = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) top.push(x < WIDTH / 2 ? [255, 0, 255, 128] : [0, 0, 0, 0]);
    }
    const doc = sprite(WIDTH, HEIGHT, [{ pixels: pattern(77) }, { pixels: top }]);
    return { doc, selection: null, activeLayerId: layerId(0), activeFrameId: FRAME };
}

/** One layer, opaque on the top row and transparent below. */
function partlyTransparent(): DocSession {
    const pixels: Rgba[] = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) pixels.push(y === 0 ? [10, 20, 30, 255] : [0, 0, 0, 0]);
    }
    const doc = sprite(WIDTH, HEIGHT, [{ pixels }]);
    return { doc, selection: null, activeLayerId: layerId(0), activeFrameId: FRAME };
}

/** The colour 0xRRGGBBAA of pixel `x, y` of the frame as `compositeFrame` makes it. */
function composited(session: DocSession, x: number, y: number): number {
    const { data, width } = compositeFrame(session.doc, FRAME);
    const at = (y * width + x) * 4;
    return ((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!) >>> 0;
}

/** A pipeline with the eyedropper (on the harness's own stores) selected. */
function eyedropper(session: DocSession, view = { scale: 8, originX: 0, originY: 0 }): Harness {
    const h = harness([pencilTool]);
    h.registry.register(createEyedropper({ editor: h.editor, composites: h.composites }), "test");
    h.tools.select("eyedropper");
    h.editor.getState().setForeground(0x01020304);
    h.editor.getState().setBackground(0x05060708);
    h.open(session, view);
    return h;
}

describe("picking", () => {
    it("a left press takes the composite's exact RGBA into the foreground, a right press into the background", () => {
        const session = layered();
        const h = eyedropper(session);
        // Under the half-transparent magenta: the blend, as the compositor makes it.
        expect(stroke(h, [{ x: 1, y: 2 }])).toBe(true);
        const blended = composited(session, 1, 2);
        expect(blended & 0xff).toBe(255);
        expect(h.editor.getState().foreground).toBe(blended);
        expect(h.editor.getState().background).toBe(0x05060708);
        // Only the bottom layer there: its pixel itself.
        stroke(h, [{ x: 6, y: 4 }], { button: 2 });
        expect(h.editor.getState().background).toBe(
            ((180 << 24) | (160 << 16) | (77 << 8) | 255) >>> 0,
        );
        expect(h.editor.getState().foreground).toBe(blended);
    });

    it("a transparent pixel sets alpha 0: the colour becomes 0x00000000", () => {
        const session = partlyTransparent();
        const h = eyedropper(session);
        stroke(h, [{ x: 3, y: 0 }]);
        expect(h.editor.getState().foreground).toBe(0x0a141eff);
        stroke(h, [{ x: 3, y: 3 }]);
        expect(h.editor.getState().foreground).toBe(0x00000000);
        stroke(h, [{ x: 5, y: 5 }], { button: 2 });
        expect(h.editor.getState().background).toBe(0x00000000);
    });

    it("with Sample set to the active layer, takes that layer's own pixel, not what covers it", () => {
        const session = layered();
        const h = eyedropper(session);
        h.editor.getState().setToolOptions("eyedropper", { sample: "layer" });
        stroke(h, [{ x: 1, y: 2 }]);
        expect(h.editor.getState().foreground).toBe(
            ((30 << 24) | (80 << 16) | (77 << 8) | 255) >>> 0,
        );
        // The top layer active: its half-transparent magenta as stored, and its transparent pixels.
        session.activeLayerId = layerId(1);
        stroke(h, [{ x: 0, y: 0 }]);
        expect(h.editor.getState().foreground).toBe(0xff00ff80);
        stroke(h, [{ x: 7, y: 0 }], { button: 2 });
        expect(h.editor.getState().background).toBe(0x00000000);
    });

    it("an empty cel of the active layer is transparent; a reference layer gives nothing", () => {
        const session = layered();
        session.doc.cels.delete(`${layerId(0)}:${FRAME}`);
        const h = eyedropper(session);
        h.editor.getState().setToolOptions("eyedropper", { sample: "layer" });
        stroke(h, [{ x: 6, y: 1 }]);
        expect(h.editor.getState().foreground).toBe(0);
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
        stroke(h, [{ x: 2, y: 2 }], { button: 2 });
        expect(h.editor.getState().background).toBe(0x05060708);
    });

    it("a drag picks at every sample; the last pixel's colour stays", () => {
        const session = layered();
        const h = eyedropper(session);
        const seen: number[] = [];
        h.editor.subscribe((state) => void seen.push(state.foreground));
        stroke(h, [
            { x: 5, y: 1 },
            { x: 6, y: 1 },
            { x: 7, y: 3 },
        ]);
        expect(seen).toEqual([
            composited(session, 5, 1),
            composited(session, 6, 1),
            composited(session, 7, 3),
        ]);
        expect(h.editor.getState().foreground).toBe(composited(session, 7, 3));
    });

    it("outside the document nothing changes", () => {
        const h = eyedropper(layered(), { scale: 8, originX: 40, originY: 40 });
        stroke(h, [{ x: -2, y: 1 }]);
        stroke(h, [{ x: WIDTH, y: 0 }], { button: 2 });
        expect(h.editor.getState().foreground).toBe(0x01020304);
        expect(h.editor.getState().background).toBe(0x05060708);
    });

    it("paints nothing and records nothing", () => {
        const session = layered();
        const h = eyedropper(session);
        const before = Array.from(session.doc.images.get(`image-${layerId(0)}-${FRAME}`)!.data);
        h.pipeline.down(at(h, { x: 2, y: 2 }, { button: 0 }));
        expect(h.document().history.transaction).toBeNull();
        h.pipeline.up(at(h, { x: 2, y: 2 }, { button: 0, buttons: 0 }));
        expect(h.document().history.undoCount).toBe(0);
        expect(Array.from(session.doc.images.get(`image-${layerId(0)}-${FRAME}`)!.data)).toEqual(
            before,
        );
        expect(h.errors).toEqual([]);
    });

    it("works below 1×: it takes the texel the pointer names, the first of its device pixel", () => {
        const session = layered();
        // 1/2: device pixel 2 shows one of texels 4 and 5 in x, 2 and 3 in y.
        const h = eyedropper(session, { scale: 0.5, originX: 0, originY: 0 });
        h.pipeline.down({
            ...at(h, { x: 0, y: 0 }),
            clientX: 2,
            clientY: 1,
            button: 0,
            buttons: 1,
        });
        h.pipeline.up({ ...at(h, { x: 0, y: 0 }), clientX: 2, clientY: 1, button: 0, buttons: 0 });
        expect(h.editor.getState().foreground).toBe(composited(session, 4, 2));
        expect(h.editor.getState().foreground).not.toBe(composited(session, 5, 3));
        expect(h.status.getState().feedback).toBeNull();
    });
});

describe("in the app", () => {
    it("holds its planned slot and key, samples the composite by default, and is held with Alt from paint tools only", () => {
        const registered = toolRegistry.get("eyedropper");
        const plan = plannedTools.find((entry) => entry.id === "eyedropper");
        expect(registered).toBeDefined();
        expect(registered?.source).toContain("eyedropper.tools.ts");
        expect(registered?.shortcut).toBe(plan?.shortcut);
        expect(registered?.shortcut).toBe("I");
        expect(registered?.icon).toBe(plan?.icon);
        expect(registered?.railOrder).toBe(plan?.railOrder);
        expect(registered?.paints).toBeFalsy();
        expect(registered?.options).toEqual([SAMPLE_OPTION]);
        expect(SAMPLE_OPTION.default).toBe("composite");
        expect(eyedropperTool.hold?.key).toBe("Alt");
        // Every registered tool: Alt takes the eyedropper from it exactly when it paints.
        for (const tool of toolRegistry.list()) {
            expect(eyedropperTool.hold?.when?.(tool), tool.id).toBe(tool.paints === true);
        }
        expect(eyedropperTool.hold?.when?.(null)).toBe(false);
    });
});
