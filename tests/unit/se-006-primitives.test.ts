import { describe, expect, it } from "vitest";
import { isKeyboardNavigation } from "@ngne/editor-ui/focus";

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
