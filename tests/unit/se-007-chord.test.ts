import { describe, expect, it } from "vitest";
import {
    ChordError,
    chordFromEvent,
    chordKey,
    chordModifiers,
    eventKey,
    formatChord,
    normalizeChord,
} from "../../src/app/commands/chord";
import type { KeyEventLike } from "../../src/app/commands/chord";
import {
    isBrowserChord,
    isCharacterChord,
    isNativeKeyChord,
    isTextEditingChord,
} from "../../src/app/keymap/keyClasses";

// SE-007: chord notation and chord matching (SPEC §7.8).

function press(key: string, modifiers: string = ""): KeyEventLike {
    return {
        key,
        ctrlKey: modifiers.includes("c"),
        altKey: modifiers.includes("a"),
        shiftKey: modifiers.includes("s"),
        metaKey: modifiers.includes("m"),
    };
}

describe("chord notation", () => {
    it("writes a chord in one canonical form", () => {
        expect(normalizeChord("ctrl+shift+z")).toBe("Ctrl+Shift+Z");
        expect(normalizeChord("Shift+Ctrl+Z")).toBe("Ctrl+Shift+Z");
        expect(normalizeChord("Control+Alt+n")).toBe("Ctrl+Alt+N");
        expect(normalizeChord(" Alt + W ")).toBe("Alt+W");
        expect(normalizeChord("b")).toBe("B");
        expect(normalizeChord("0")).toBe("0");
        expect(normalizeChord("?")).toBe("?");
        expect(normalizeChord("f6")).toBe("F6");
        expect(normalizeChord("shift+f6")).toBe("Shift+F6");
        expect(normalizeChord("delete")).toBe("Delete");
        expect(normalizeChord("arrowleft")).toBe("ArrowLeft");
        expect(normalizeChord("Shift+ArrowLeft")).toBe("Shift+ArrowLeft");
        expect(normalizeChord("space")).toBe("Space");
        expect(normalizeChord("Ctrl+Plus")).toBe("Ctrl++");
    });

    it("keeps a canonical chord unchanged", () => {
        for (const chord of ["Ctrl+Shift+Z", "Alt", "?", "Ctrl++", "+", "Shift+Tab", "F12"]) {
            expect(normalizeChord(chord), chord).toBe(chord);
        }
    });

    it("takes a modifier on its own as the key of a hold binding", () => {
        expect(normalizeChord("alt")).toBe("Alt");
        expect(normalizeChord("Control")).toBe("Ctrl");
        expect(chordKey("Alt")).toBe("Alt");
        expect(chordModifiers("Alt")).toEqual({
            ctrl: false,
            alt: false,
            shift: false,
            meta: false,
        });
    });

    it("rejects chords it cannot read", () => {
        for (const chord of ["", "Ctrl+", "Ctrl+Shift", "Hyper+A", "Ctrl+Ctrl+A", "Foo", "A+B"]) {
            expect(() => normalizeChord(chord), chord).toThrow(ChordError);
        }
    });

    it("rejects Shift with a digit or a symbol, which already is the shifted character", () => {
        expect(() => normalizeChord("Shift+1")).toThrow(/Shift is not written with "1"/);
        expect(() => normalizeChord("Shift+?")).toThrow(ChordError);
        expect(normalizeChord("Ctrl+1")).toBe("Ctrl+1");
    });

    it("splits a canonical chord into key and modifiers", () => {
        expect(chordKey("Ctrl+Shift+Z")).toBe("Z");
        expect(chordKey("Ctrl++")).toBe("+");
        expect(chordKey("ArrowLeft")).toBe("ArrowLeft");
        expect(chordModifiers("Ctrl+Shift+Z")).toEqual({
            ctrl: true,
            alt: false,
            shift: true,
            meta: false,
        });
        expect(chordModifiers("Ctrl++").ctrl).toBe(true);
    });

    it("formats a chord for menus", () => {
        expect(formatChord("Ctrl+Shift+Z")).toBe("Ctrl+Shift+Z");
        expect(formatChord("Shift+ArrowLeft")).toBe("Shift+←");
        expect(formatChord("ArrowDown")).toBe("↓");
        expect(formatChord("Escape")).toBe("Esc");
        expect(formatChord("Shift+F6")).toBe("Shift+F6");
    });
});

describe("chord matching", () => {
    it("reads letters in upper case with Shift as a modifier", () => {
        expect(chordFromEvent(press("b"))).toBe("B");
        expect(chordFromEvent(press("U", "s"))).toBe("Shift+U");
        expect(chordFromEvent(press("z", "c"))).toBe("Ctrl+Z");
        expect(chordFromEvent(press("Z", "cs"))).toBe("Ctrl+Shift+Z");
        expect(chordFromEvent(press("n", "ca"))).toBe("Ctrl+Alt+N");
        expect(chordFromEvent(press("w", "a"))).toBe("Alt+W");
    });

    it("does not take Caps Lock for Shift", () => {
        expect(chordFromEvent(press("B"))).toBe("B");
    });

    it("reads a digit or a symbol as the character produced, without Shift", () => {
        expect(chordFromEvent(press("1"))).toBe("1");
        expect(chordFromEvent(press("?", "s"))).toBe("?");
        expect(chordFromEvent(press("?"))).toBe("?");
        // Shift+1 on a US keyboard is "!", not the zoom key "1".
        expect(chordFromEvent(press("!", "s"))).toBe("!");
        // On a layout whose digits need Shift, the digit still matches.
        expect(chordFromEvent(press("1", "s"))).toBe("1");
    });

    it("reads named keys, with Shift as a modifier", () => {
        expect(chordFromEvent(press("Enter"))).toBe("Enter");
        expect(chordFromEvent(press("Tab", "s"))).toBe("Shift+Tab");
        expect(chordFromEvent(press("ArrowLeft", "s"))).toBe("Shift+ArrowLeft");
        expect(chordFromEvent(press("F6", "s"))).toBe("Shift+F6");
        expect(chordFromEvent(press(" "))).toBe("Space");
        expect(chordFromEvent(press("Delete"))).toBe("Delete");
    });

    it("reads a modifier pressed alone as a chord, and not while another one is held", () => {
        expect(chordFromEvent(press("Alt", "a"))).toBe("Alt");
        expect(chordFromEvent(press("Control", "c"))).toBe("Ctrl");
        // Key up: the flag of the released modifier is already off.
        expect(chordFromEvent(press("Alt"))).toBe("Alt");
        expect(chordFromEvent(press("Alt", "as"))).toBeNull();
        expect(chordFromEvent(press("Shift", "cs"))).toBeNull();
    });

    it("ignores events that name no key", () => {
        for (const key of ["Dead", "Unidentified", "Process", "AltGraph", "CapsLock", ""]) {
            expect(chordFromEvent(press(key)), key).toBeNull();
            expect(eventKey({ key }), key).toBeNull();
        }
    });

    it("takes a letter of a non-Latin layout for the key at its Latin position", () => {
        // Russian: the Z key types "я", the B key "и".
        expect(chordFromEvent({ ...press("я", "c"), code: "KeyZ" })).toBe("Ctrl+Z");
        expect(chordFromEvent({ ...press("Я", "cs"), code: "KeyZ" })).toBe("Ctrl+Shift+Z");
        expect(chordFromEvent({ ...press("и"), code: "KeyB" })).toBe("B");
        // Hebrew letters have no case.
        expect(chordFromEvent({ ...press("ז"), code: "KeyZ" })).toBe("Z");
        expect(eventKey({ key: "и", code: "KeyB" })).toBe("B");
    });

    it("matches Latin letters by character, wherever the layout puts them", () => {
        // AZERTY: "a" is on the key a US keyboard labels Q.
        expect(chordFromEvent({ ...press("a", "c"), code: "KeyQ" })).toBe("Ctrl+A");
        // A letter that is not on a letter key keeps its own character.
        expect(chordFromEvent({ ...press("é"), code: "Digit2" })).toBe("É");
    });

    it("does not guess a letter behind an AltGr character", () => {
        // AltGr+N on a Polish keyboard types "ń" (Windows reports AltGr as Ctrl+Alt); it must
        // not become Ctrl+Alt+N, which would open the New Sprite dialog while typing.
        expect(chordFromEvent({ ...press("ń", "ca"), code: "KeyN" })).toBe("Ctrl+Alt+Ń");
        const linux = {
            ...press("ł"),
            code: "KeyL",
            getModifierState: (key: string) => key === "AltGraph",
        };
        expect(chordFromEvent(linux)).toBe("Ł");
    });

    it("names the key of an event whatever modifiers are held", () => {
        expect(eventKey({ key: " " })).toBe("Space");
        expect(eventKey({ key: "b" })).toBe("B");
        expect(eventKey({ key: "Control" })).toBe("Ctrl");
        expect(eventKey({ key: "Alt" })).toBe("Alt");
    });

    it("matches every event chord with the notation a command would write", () => {
        const cases: [KeyEventLike, string][] = [
            [press("z", "c"), "Ctrl+Z"],
            [press("Z", "cs"), "ctrl+shift+z"],
            [press("?", "s"), "?"],
            [press("F6", "s"), "Shift+F6"],
            [press(" "), "Space"],
            [press("Alt", "a"), "Alt"],
        ];
        for (const [event, written] of cases) {
            expect(chordFromEvent(event)).toBe(normalizeChord(written));
        }
    });
});

describe("chord classes (SPEC §7.8)", () => {
    it("knows the keys a focused control may consume natively", () => {
        for (const chord of ["Enter", "Space", "Tab", "Shift+Tab", "Escape", "ArrowLeft", "Home"]) {
            expect(isNativeKeyChord(chord), chord).toBe(true);
        }
        for (const chord of ["B", "Ctrl+Enter", "Alt+ArrowLeft", "Delete", "F6", "1"]) {
            expect(isNativeKeyChord(chord), chord).toBe(false);
        }
    });

    it("knows Ctrl, Alt and F-key chords", () => {
        for (const chord of ["Ctrl+S", "Alt+N", "Ctrl+Alt+N", "F3", "Shift+F6", "Alt"]) {
            expect(isBrowserChord(chord), chord).toBe(true);
        }
        for (const chord of ["B", "Shift+N", "Delete", "Enter", "?", "Shift"]) {
            expect(isBrowserChord(chord), chord).toBe(false);
        }
    });

    it("knows the chords a text field handles itself", () => {
        for (const chord of ["Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+Z", "Ctrl+A", "Ctrl+X", "Ctrl+C"]) {
            expect(isTextEditingChord(chord), chord).toBe(true);
        }
        expect(isTextEditingChord("Ctrl+S")).toBe(false);
        expect(isTextEditingChord("Ctrl+D")).toBe(false);
    });

    it("knows typed characters", () => {
        for (const chord of ["B", "Shift+B", "1", "?"]) {
            expect(isCharacterChord(chord), chord).toBe(true);
        }
        for (const chord of ["Ctrl+B", "Enter", "Space", "F3", "Alt"]) {
            expect(isCharacterChord(chord), chord).toBe(false);
        }
    });
});
