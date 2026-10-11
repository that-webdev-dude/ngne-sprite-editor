import { describe, expect, it } from "vitest";
import { isKeyboardNavigation } from "../../src/ui/focus/modality";
import {
    formatNumber,
    normalizeNumber,
    parseNumber,
    scrubNumber,
    stepNumber,
} from "../../src/ui/primitives/numberMath";
import { resizeByDrag, resizeByKey } from "../../src/ui/primitives/splitterMath";
import type { SplitterAxis } from "../../src/ui/primitives/splitterMath";

describe("number field values (DESIGN §4)", () => {
    const range = { min: 1, max: 64 };

    it("steps by 1 with the arrow keys and by 10 with Shift", () => {
        expect(stepNumber(8, 1, range)).toBe(9);
        expect(stepNumber(8, -1, range)).toBe(7);
        expect(stepNumber(8, 1, range, true)).toBe(18);
        expect(stepNumber(8, -1, range, true)).toBe(1);
    });

    it("stays inside the range", () => {
        expect(stepNumber(64, 1, range)).toBe(64);
        expect(stepNumber(1, -1, range)).toBe(1);
        expect(normalizeNumber(500, range)).toBe(64);
        expect(normalizeNumber(-3, {})).toBe(-3);
    });

    it("uses the step size and keeps its decimals", () => {
        const half = { min: 0, max: 2, step: 0.5 };
        expect(stepNumber(0.5, 1, half)).toBe(1);
        expect(stepNumber(0.5, 1, half, true)).toBe(2);
        expect(stepNumber(0.1, 2, { step: 0.1 })).toBe(0.3);
        expect(formatNumber(1, half)).toBe("1.0");
        expect(formatNumber(12, {})).toBe("12");
    });

    it("scrubs one step per two pixels of label drag, ten with Shift", () => {
        expect(scrubNumber(10, 0, range)).toBe(10);
        expect(scrubNumber(10, 1, range)).toBe(10);
        expect(scrubNumber(10, 20, range)).toBe(20);
        expect(scrubNumber(10, -6, range)).toBe(7);
        expect(scrubNumber(10, 4, range, true)).toBe(30);
        expect(scrubNumber(10, 4000, range)).toBe(64);
    });

    it("parses typed text and rejects what is not a number", () => {
        expect(parseNumber(" 12 ", range)).toBe(12);
        expect(parseNumber("200", range)).toBe(64);
        expect(parseNumber("2.6", range)).toBe(3);
        expect(parseNumber("0,5", { step: 0.5 })).toBe(0.5);
        expect(parseNumber("", range)).toBeNull();
        expect(parseNumber("12px", range)).toBeNull();
        expect(parseNumber("Infinity", range)).toBeNull();
    });
});

describe("splitter sizes (DESIGN §4, §8)", () => {
    const dock: SplitterAxis = { orientation: "vertical", growth: -1, min: 220, max: 360 };
    const timeline: SplitterAxis = { orientation: "horizontal", growth: -1, min: 120, max: 360 };
    const pane: SplitterAxis = { orientation: "vertical", growth: 1, min: 80, max: 320 };

    it("follows the pointer and stops at the limits", () => {
        expect(resizeByDrag(264, -30, dock)).toBe(294);
        expect(resizeByDrag(264, 30, dock)).toBe(234);
        expect(resizeByDrag(264, -500, dock)).toBe(360);
        expect(resizeByDrag(264, 500, dock)).toBe(220);
        expect(resizeByDrag(160, 12.4, pane)).toBe(172);
    });

    it("moves the line the way the arrow key points", () => {
        expect(resizeByKey(264, "ArrowLeft", dock)).toBe(272);
        expect(resizeByKey(264, "ArrowRight", dock)).toBe(256);
        expect(resizeByKey(200, "ArrowUp", timeline)).toBe(208);
        expect(resizeByKey(200, "ArrowDown", timeline)).toBe(192);
        expect(resizeByKey(160, "ArrowRight", pane)).toBe(168);
        expect(resizeByKey(160, "ArrowRight", pane, true)).toBe(192);
    });

    it("goes to the limits with Home and End and ignores other keys", () => {
        expect(resizeByKey(264, "Home", dock)).toBe(220);
        expect(resizeByKey(264, "End", dock)).toBe(360);
        expect(resizeByKey(264, "ArrowUp", dock)).toBeNull();
        expect(resizeByKey(200, "ArrowLeft", timeline)).toBeNull();
        expect(resizeByKey(264, "a", dock)).toBeNull();
    });
});

describe("focus modality (DESIGN §3.3: ring on keyboard focus only)", () => {
    it("treats navigation keys as keyboard use", () => {
        expect(isKeyboardNavigation({ key: "Tab", typing: false })).toBe(true);
        expect(isKeyboardNavigation({ key: "ArrowRight", typing: false })).toBe(true);
        expect(isKeyboardNavigation({ key: "Enter", typing: false })).toBe(true);
    });

    it("ignores modifiers pressed for a pointer gesture", () => {
        for (const key of ["Shift", "Control", "Alt", "Meta"]) {
            expect(isKeyboardNavigation({ key, typing: false })).toBe(false);
        }
    });

    it("ignores typing in a text field, but not Tab out of it", () => {
        expect(isKeyboardNavigation({ key: "5", typing: true })).toBe(false);
        expect(isKeyboardNavigation({ key: "ArrowUp", typing: true })).toBe(false);
        expect(isKeyboardNavigation({ key: "Tab", typing: true })).toBe(true);
    });
});
