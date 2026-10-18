// Contrast of text on a user colour (DESIGN §3.1): a tag's label is black or white, whichever
// has the higher contrast with its span. WCAG 2.1 relative luminance and contrast ratio over
// sRGB; the alpha of the colour is not part of it (a span is drawn opaque, DESIGN §5.6).

/** The two colours a label on a user colour can have. */
export type LabelColour = "black" | "white";

/** sRGB channel 0..255 to linear light (WCAG 2.1 relative luminance). */
function linear(channel: number): number {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance 0..1 of the colour 0xRRGGBBAA; the alpha is ignored. */
export function relativeLuminance(colour: number): number {
    const r = (colour >>> 24) & 0xff;
    const g = (colour >>> 16) & 0xff;
    const b = (colour >>> 8) & 0xff;
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Contrast ratio 1..21 of two colours 0xRRGGBBAA (WCAG 2.1); the alphas are ignored. */
export function contrastRatio(a: number, b: number): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Opaque black and white, 0xRRGGBBAA. */
export const BLACK = 0x000000ff;
export const WHITE = 0xffffffff;

/**
 * The label colour for text on `colour` (0xRRGGBBAA): black or white, whichever contrasts
 * more with it; black on a tie. The higher of the two ratios is at least 4.58:1 for any
 * colour, above the 4.5:1 of WCAG AA for normal text.
 */
export function labelColourOn(colour: number): LabelColour {
    return contrastRatio(colour, BLACK) >= contrastRatio(colour, WHITE) ? "black" : "white";
}
