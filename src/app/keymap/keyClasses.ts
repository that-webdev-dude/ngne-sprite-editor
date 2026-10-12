import { chordKey, chordModifiers } from "../commands/chord";

// Classes of chords the rules of SPEC §7.8 distinguish. All take a canonical chord.

/** Keys a focused control may consume natively (SPEC §7.8, focus rules). */
export const NATIVE_KEYS: ReadonlySet<string> = new Set([
    "Enter",
    "Space",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
    "Tab",
    "Escape",
]);

/** Chords a text field handles itself: Ctrl+Z/Y/A/X/C/V, and Ctrl+Shift+Z as Chrome's redo. */
const TEXT_EDITING_CHORDS: ReadonlySet<string> = new Set([
    "Ctrl+Z",
    "Ctrl+Y",
    "Ctrl+Shift+Z",
    "Ctrl+A",
    "Ctrl+X",
    "Ctrl+C",
    "Ctrl+V",
]);

function hasCommandModifier(chord: string): boolean {
    const { ctrl, alt, meta } = chordModifiers(chord);
    return ctrl || alt || meta;
}

/**
 * A native key without Ctrl, Alt or Meta. Shift does not change who handles the key
 * (Shift+Tab, Shift+arrows), so it is not looked at.
 */
export function isNativeKeyChord(chord: string): boolean {
    return NATIVE_KEYS.has(chordKey(chord)) && !hasCommandModifier(chord);
}

/**
 * A "Ctrl/Alt/F-key chord" (SPEC §7.8): the only kind that may act while a text field has
 * focus, and the kind whose browser default is suppressed when it is bound but does not act.
 * The Alt key on its own counts: released alone it would move focus to the browser's menu.
 */
export function isBrowserChord(chord: string): boolean {
    return hasCommandModifier(chord) || /^F\d{1,2}$/.test(chordKey(chord)) || chord === "Alt";
}

export function isTextEditingChord(chord: string): boolean {
    return TEXT_EDITING_CHORDS.has(chord);
}

/** A character typed without Ctrl, Alt or Meta: what a select uses for typeahead. */
export function isCharacterChord(chord: string): boolean {
    return [...chordKey(chord)].length === 1 && !hasCommandModifier(chord);
}
