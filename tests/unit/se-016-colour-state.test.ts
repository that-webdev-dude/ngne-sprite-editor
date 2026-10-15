import { describe, expect, it } from "vitest";
import {
    createEditorStore,
    DEFAULT_BACKGROUND,
    DEFAULT_FOREGROUND,
} from "../../src/app/state/editor";
import type { ColourSlot } from "../../src/app/state/editor";
import { hsvToRgb, packRgba, unpackRgba } from "../../src/core/color";
import {
    alphaAfterKey,
    cssColour,
    fractionAlong,
    hueAfterKey,
    svAfterKey,
} from "../../src/ui/colour/pickerMath";

// SE-016: the foreground and background colours of the editor store with the HSV the colour
// panel edits, swap and reset; and the pointer and key arithmetic of the panel's controls.

/** What the saturation/value field does at a pointer position: s and v, the hue kept. */
function dragTo(
    store: ReturnType<typeof createEditorStore>,
    slot: ColourSlot,
    s: number,
    v: number,
) {
    const state = store.getState();
    const stored = slot === "foreground" ? state.foregroundHsv : state.backgroundHsv;
    state.setColourHsv(slot, { ...stored, s, v }, state[slot] & 0xff);
}

describe("colour state", () => {
    it("starts black on white; reset restores that", () => {
        const store = createEditorStore();
        expect(store.getState()).toMatchObject({
            foreground: DEFAULT_FOREGROUND,
            background: DEFAULT_BACKGROUND,
            foregroundHsv: { s: 0, v: 0 },
            backgroundHsv: { s: 0, v: 1 },
        });
        store.getState().setForeground(0x336699ff);
        store.getState().setBackground(0x11223344);
        store.getState().resetColours();
        expect(store.getState().foreground).toBe(0x000000ff);
        expect(store.getState().background).toBe(0xffffffff);
    });

    it("swaps the colours and the HSV the panel keeps for each", () => {
        const store = createEditorStore();
        store.getState().setColourHsv("foreground", { h: 210, s: 0, v: 0.5 }, 200);
        store.getState().setBackground(0xff000080);
        const before = store.getState();
        store.getState().swapColours();
        const after = store.getState();
        expect(after.foreground).toBe(before.background);
        expect(after.background).toBe(before.foreground);
        expect(after.foregroundHsv).toEqual(before.backgroundHsv);
        // The grey keeps the hue it was given, through the swap.
        expect(after.backgroundHsv).toEqual({ h: 210, s: 0, v: 0.5 });
        store.getState().swapColours();
        expect(store.getState().foreground).toBe(before.foreground);
    });

    it("sets a colour from HSV exactly and stores its RGB rounded, with the alpha given", () => {
        const store = createEditorStore();
        store.getState().setColourHsv("background", { h: 30, s: 1, v: 1 }, 128);
        expect(store.getState().background).toBe(packRgba(255, 128, 0, 128));
        expect(store.getState().backgroundHsv).toEqual({ h: 30, s: 1, v: 1 });
        // 360° stays 360° (the right end of the hue strip), the same red as 0°.
        store.getState().setColourHsv("foreground", { h: 360, s: 1, v: 1 }, 255);
        expect(store.getState().foregroundHsv.h).toBe(360);
        expect(store.getState().foreground).toBe(0xff0000ff);
        // Out of range: clamped.
        store.getState().setColourHsv("foreground", { h: 400, s: 2, v: -1 }, 300);
        expect(store.getState().foregroundHsv).toEqual({ h: 360, s: 1, v: 0 });
        expect(store.getState().foreground).toBe(0x000000ff);
    });

    it("dragging in the SV field does not change the stored hue when saturation or value reach 0", () => {
        const store = createEditorStore();
        store.getState().setColourHsv("foreground", { h: 200, s: 0.8, v: 0.9 }, 255);
        // To the left edge: saturation 0, a grey.
        dragTo(store, "foreground", 0, 0.6);
        expect(store.getState().foregroundHsv.h).toBe(200);
        expect(unpackRgba(store.getState().foreground)).toMatchObject({ r: 153, g: 153, b: 153 });
        // Down to the bottom: value 0, black; the saturation of the pointer is kept as well.
        dragTo(store, "foreground", 0.3, 0);
        expect(store.getState().foregroundHsv).toEqual({ h: 200, s: 0.3, v: 0 });
        expect(store.getState().foreground).toBe(0x000000ff);
        dragTo(store, "foreground", 0, 0);
        expect(store.getState().foregroundHsv.h).toBe(200);
        // Back into the field: the colour has the hue again.
        dragTo(store, "foreground", 1, 1);
        const { r, g, b } = hsvToRgb(200, 1, 1);
        expect(store.getState().foreground).toBe(packRgba(r, g, b, 255));
        // The background is not touched by the foreground's drag, and keeps its own hue too.
        store.getState().setColourHsv("background", { h: 40, s: 1, v: 1 }, 255);
        dragTo(store, "background", 0, 0);
        expect(store.getState().backgroundHsv.h).toBe(40);
        expect(store.getState().foregroundHsv.h).toBe(200);
    });

    it("a grey or black set as a colour (the eyedropper, the hex field) keeps the hue the panel had", () => {
        const store = createEditorStore();
        store.getState().setColourHsv("foreground", { h: 120, s: 0.5, v: 0.5 }, 255);
        store.getState().setForeground(0x808080ff);
        expect(store.getState().foregroundHsv).toEqual({ h: 120, s: 0, v: 128 / 255 });
        store.getState().setColour("foreground", 0x00000000);
        expect(store.getState().foregroundHsv).toEqual({ h: 120, s: 0, v: 0 });
        store.getState().setColour("foreground", 0x0000ffff);
        expect(store.getState().foregroundHsv).toEqual({ h: 240, s: 1, v: 1 });
    });

    it("tells subscribers once per change", () => {
        const store = createEditorStore();
        let calls = 0;
        store.subscribe(() => calls++);
        store.getState().setColour("background", 0x123456ff);
        store.getState().setColourHsv("foreground", { h: 1, s: 1, v: 1 }, 255);
        store.getState().swapColours();
        store.getState().resetColours();
        expect(calls).toBe(4);
    });
});

describe("picker arithmetic", () => {
    it("maps a pointer position to a fraction of a box, clamped to it", () => {
        expect(fractionAlong(150, 100, 200)).toBe(0.25);
        expect(fractionAlong(50, 100, 200)).toBe(0);
        expect(fractionAlong(400, 100, 200)).toBe(1);
        expect(fractionAlong(10, 0, 0)).toBe(0);
    });

    it("steps the hue in degrees and alpha by one, ten with Shift, within their ranges", () => {
        expect(hueAfterKey(200, "ArrowRight", false)).toBe(201);
        expect(hueAfterKey(200, "ArrowUp", true)).toBe(210);
        expect(hueAfterKey(200.6, "ArrowLeft", false)).toBe(200);
        expect(hueAfterKey(355, "ArrowRight", true)).toBe(360);
        expect(hueAfterKey(3, "ArrowDown", true)).toBe(0);
        expect(hueAfterKey(100, "Home", false)).toBe(0);
        expect(hueAfterKey(100, "End", false)).toBe(360);
        expect(hueAfterKey(100, "PageUp", false)).toBe(110);
        expect(hueAfterKey(100, "Enter", false)).toBeNull();
        expect(alphaAfterKey(255, "ArrowRight", false)).toBe(255);
        expect(alphaAfterKey(250, "ArrowLeft", true)).toBe(240);
        expect(alphaAfterKey(5, "PageDown", false)).toBe(0);
        expect(alphaAfterKey(5, "End", false)).toBe(255);
        expect(alphaAfterKey(5, "a", false)).toBeNull();
    });

    it("steps saturation with left and right and value with up and down, in whole percent", () => {
        const hsv = { h: 77, s: 0.503, v: 0.5 };
        expect(svAfterKey(hsv, "ArrowRight", false)).toEqual({ h: 77, s: 0.51, v: 0.5 });
        expect(svAfterKey(hsv, "ArrowLeft", true)).toEqual({ h: 77, s: 0.4, v: 0.5 });
        expect(svAfterKey(hsv, "ArrowUp", false)).toEqual({ h: 77, s: 0.503, v: 0.51 });
        expect(svAfterKey(hsv, "ArrowDown", true)).toEqual({ h: 77, s: 0.503, v: 0.4 });
        expect(svAfterKey(hsv, "PageUp", false)).toEqual({ h: 77, s: 0.503, v: 0.6 });
        expect(svAfterKey(hsv, "Home", false)).toEqual({ h: 77, s: 0, v: 0.5 });
        expect(svAfterKey(hsv, "End", false)).toEqual({ h: 77, s: 1, v: 0.5 });
        expect(svAfterKey({ h: 0, s: 1, v: 0 }, "ArrowDown", false)).toEqual({ h: 0, s: 1, v: 0 });
        expect(svAfterKey(hsv, "Tab", false)).toBeNull();
    });

    it("writes a colour for CSS with its alpha", () => {
        expect(cssColour(0x336699ff)).toBe("rgb(51 102 153 / 1)");
        expect(cssColour(0x33669980)).toBe("rgb(51 102 153 / 0.502)");
        expect(cssColour(0x336699ff, 0)).toBe("rgb(51 102 153 / 0)");
    });
});
