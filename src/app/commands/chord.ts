/**
 * Key chords (SPEC §7.8). A chord is written as its modifiers and one key joined by "+":
 * "Ctrl+Shift+Z", "Alt+N", "Shift+U", "F6", "Delete", "ArrowLeft", "Space", "B", "0", "?".
 *
 * - Letters are written in upper case; Shift is a modifier of letters and of named keys.
 * - A digit or a symbol is the character the key produces, so Shift is never written with it:
 *   "?" matches Shift+/ on a US keyboard and whatever key produces "?" elsewhere.
 * - A modifier on its own ("Alt") is the chord of a key that is held (`CommandSpec.release`).
 * - The "+" key is written "Plus".
 *
 * The canonical text lists the modifiers in the order Ctrl, Alt, Shift, Meta. Keys are matched
 * by `KeyboardEvent.key`, the character of the active keyboard layout; a letter of a non-Latin
 * layout stands for the key at its position on a Latin keyboard (`positionalLetter`).
 */
export class ChordError extends Error {
    override readonly name = "ChordError";
}

/** The keyboard event fields a chord is read from. */
export interface KeyEventLike {
    key: string;
    /** The physical key (`KeyboardEvent.code`), for letters of non-Latin layouts. */
    code?: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
    getModifierState?(key: string): boolean;
}

export interface ChordModifiers {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
}

export interface ChordParts extends ChordModifiers {
    /** "B", "0", "?", "Enter", "ArrowLeft", "F6", or a modifier name for a held modifier. */
    key: string;
}

type Modifier = keyof ChordModifiers;

const MODIFIER_NAMES: Readonly<Record<Modifier, string>> = {
    ctrl: "Ctrl",
    alt: "Alt",
    shift: "Shift",
    meta: "Meta",
};
const MODIFIER_ALIASES: Readonly<Record<string, Modifier>> = {
    ctrl: "ctrl",
    control: "ctrl",
    alt: "alt",
    shift: "shift",
    meta: "meta",
};
const MODIFIER_KEY_NAMES = new Set(Object.values(MODIFIER_NAMES));

/** Named keys, by lower-case name; the values are `KeyboardEvent.key` names except "Space". */
const NAMED_KEYS: ReadonlyMap<string, string> = new Map(
    [
        "Enter",
        "Escape",
        "Tab",
        "Space",
        "Backspace",
        "Delete",
        "Insert",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
    ].map((name) => [name.toLowerCase(), name]),
);

/** Keys that never form a chord: no usable identity, or a state key. */
const IGNORED_KEYS = new Set(["", "Dead", "Unidentified", "Process", "AltGraph", "CapsLock"]);

const NO_MODIFIERS: ChordModifiers = { ctrl: false, alt: false, shift: false, meta: false };

function isLetter(character: string): boolean {
    return character.toLowerCase() !== character.toUpperCase();
}

function isSingleCharacter(text: string): boolean {
    return [...text].length === 1;
}

function compose(parts: ChordParts): string {
    const modifiers = (Object.keys(MODIFIER_NAMES) as Modifier[])
        .filter((modifier) => parts[modifier])
        .map((modifier) => MODIFIER_NAMES[modifier]);
    return [...modifiers, parts.key].join("+");
}

function parseKey(token: string, chord: string): string {
    if (token.toLowerCase() === "plus") return "+";
    const named = NAMED_KEYS.get(token.toLowerCase());
    if (named) return named;
    if (isSingleCharacter(token)) return isLetter(token) ? token.toUpperCase() : token;
    throw new ChordError(`Unknown key "${token}" in chord "${chord}".`);
}

/** The tokens of a chord; a trailing "+" (as in the canonical "Ctrl++") is the "+" key. */
function tokenize(chord: string): string[] {
    const text = chord.trim();
    if (text === "+") return ["Plus"];
    if (text.endsWith("++")) return [...text.slice(0, -2).split("+"), "Plus"];
    return text.split("+");
}

/** The parts of a chord in any accepted spelling. Throws `ChordError`. */
export function parseChord(chord: string): ChordParts {
    const tokens = tokenize(chord).map((token) => token.trim());
    if (tokens.some((token) => token === "")) {
        throw new ChordError(`Chord "${chord}" is malformed; write the "+" key as "Plus".`);
    }
    const last = tokens.pop() ?? "";
    const heldModifier = MODIFIER_ALIASES[last.toLowerCase()];
    if (heldModifier) {
        // A modifier is a key only on its own: the chord of a hold binding.
        if (tokens.length > 0) throw new ChordError(`Chord "${chord}" has no key.`);
        return { ...NO_MODIFIERS, key: MODIFIER_NAMES[heldModifier] };
    }

    const parts: ChordParts = { ...NO_MODIFIERS, key: parseKey(last, chord) };
    for (const token of tokens) {
        const modifier = MODIFIER_ALIASES[token.toLowerCase()];
        if (!modifier) throw new ChordError(`Unknown modifier "${token}" in chord "${chord}".`);
        if (parts[modifier]) throw new ChordError(`Chord "${chord}" repeats "${token}".`);
        parts[modifier] = true;
    }
    if (parts.shift && isSingleCharacter(parts.key) && !isLetter(parts.key)) {
        throw new ChordError(
            `Chord "${chord}": Shift is not written with "${parts.key}"; bind the character ` +
                "the key produces.",
        );
    }
    return parts;
}

/** The canonical text of a chord. Throws `ChordError` for a chord that cannot be parsed. */
export function normalizeChord(chord: string): string {
    return compose(parseChord(chord));
}

/**
 * On a Cyrillic, Greek or Hebrew layout a letter key produces a character no chord is written
 * with. The key then stands for the letter at its position on a Latin keyboard, so Ctrl+Z is
 * the same key on every layout. Characters typed with AltGr are left as they are: they are
 * text, not chords.
 */
function positionalLetter(event: Partial<KeyEventLike> & Pick<KeyEventLike, "key">): string | null {
    const letter = /^Key([A-Z])$/.exec(event.code ?? "")?.[1];
    if (!letter || (event.key.codePointAt(0) ?? 0) <= 0x7f) return null;
    const altGraph = (event.ctrlKey && event.altKey) || event.getModifierState?.("AltGraph");
    return altGraph ? null : letter;
}

/**
 * The key of an event as chords name it, whatever modifiers are held: "B", "0", "?", "Space",
 * "Enter", "Alt". Null when the event names no key (dead keys, IME).
 */
export function eventKey(event: Partial<KeyEventLike> & Pick<KeyEventLike, "key">): string | null {
    const key = event.key === "Control" ? "Ctrl" : event.key === " " ? "Space" : event.key;
    if (IGNORED_KEYS.has(key)) return null;
    if (!isSingleCharacter(key)) return key;
    return positionalLetter(event) ?? (isLetter(key) ? key.toUpperCase() : key);
}

/**
 * The canonical chord of a key event, or null when the event names no key or a modifier is
 * pressed while another one is held.
 */
export function chordFromEvent(event: KeyEventLike): string | null {
    const key = eventKey(event);
    if (key === null) return null;

    if (MODIFIER_KEY_NAMES.has(key)) {
        const held = [event.ctrlKey, event.altKey, event.shiftKey, event.metaKey];
        return held.filter(Boolean).length <= 1 ? key : null;
    }
    return compose({
        ctrl: event.ctrlKey,
        alt: event.altKey,
        // A digit or a symbol already is the shifted character.
        shift: event.shiftKey && (!isSingleCharacter(key) || isLetter(key)),
        meta: event.metaKey,
        key,
    });
}

/** The key of a canonical chord, without its modifiers. */
export function chordKey(chord: string): string {
    // The key follows the last separator; "+" itself is the key of "Ctrl++".
    return chord.endsWith("+") ? "+" : chord.slice(chord.lastIndexOf("+") + 1);
}

/** The modifiers of a canonical chord; a held modifier on its own has none. */
export function chordModifiers(chord: string): ChordModifiers {
    const names = chord.slice(0, chord.length - chordKey(chord).length).split("+");
    return {
        ctrl: names.includes("Ctrl"),
        alt: names.includes("Alt"),
        shift: names.includes("Shift"),
        meta: names.includes("Meta"),
    };
}

const DISPLAY_KEYS: Readonly<Record<string, string>> = {
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Escape: "Esc",
};

/** A canonical chord as shown in menus and tooltips: "Ctrl+Shift+Z", "Shift+←". */
export function formatChord(chord: string): string {
    const key = chordKey(chord);
    return chord.slice(0, chord.length - key.length) + (DISPLAY_KEYS[key] ?? key);
}
