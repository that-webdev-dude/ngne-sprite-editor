/** Hex text of the colour fields in the Preferences dialog, kept free of the DOM for tests. */

/** A colour 0xRRGGBB as "#rrggbb". */
export function formatHexColour(colour: number): string {
    return `#${colour.toString(16).padStart(6, "0")}`;
}

/**
 * Parses typed text: "#rrggbb", "rrggbb", or the short form "#rgb". Null when it is not a
 * colour.
 */
export function parseHexColour(text: string): number | null {
    const digits = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(text.trim())?.[1];
    if (digits === undefined) return null;
    const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits;
    return parseInt(full, 16);
}
