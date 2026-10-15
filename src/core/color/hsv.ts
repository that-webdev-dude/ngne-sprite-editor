// sRGB8 ↔ HSV, the space of the colour panel (DESIGN §5.3): hue in degrees, saturation and
// value from 0 to 1, all kept as exact fractions. The conversions are exact inverses on 8-bit
// values: `hsvToRgb(rgbToHsv(r, g, b))` gives back `r, g, b` for every one of them.
//
// A grey has no hue and black has no saturation either. `rgbToHsv` takes the HSV the colour
// had before and keeps what the new RGB does not determine, so a picker that drags its value
// to 0 does not lose its hue.

/**
 * A colour in HSV: `h` in degrees, 0 to 360 (360 is the red of 0; `rgbToHsv` gives less than
 * 360); `s` and `v` from 0 to 1.
 */
export interface Hsv {
    h: number;
    s: number;
    v: number;
}

/** The channels red, green, blue of a colour, each an integer 0..255. */
export interface Rgb {
    r: number;
    g: number;
    b: number;
}

/**
 * The HSV of an sRGB colour; `r`, `g` and `b` are integers 0..255. What the colour leaves
 * open is taken from `previous` (0 without it): the hue of a grey, and the hue and saturation
 * of black.
 */
export function rgbToHsv(r: number, g: number, b: number, previous?: Hsv): Hsv {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    if (max === 0) return { h: previous?.h ?? 0, s: previous?.s ?? 0, v: 0 };
    const v = max / 255;
    if (delta === 0) return { h: previous?.h ?? 0, s: 0, v };
    let sector: number;
    if (max === r) sector = (g - b) / delta + (g < b ? 6 : 0);
    else if (max === g) sector = (b - r) / delta + 2;
    else sector = (r - g) / delta + 4;
    const h = sector * 60;
    return { h: h >= 360 ? h - 360 : h, s: delta / max, v };
}

/** The sRGB colour of an HSV colour, each channel rounded to an integer 0..255. */
export function hsvToRgb(h: number, s: number, v: number): Rgb {
    const saturation = Math.min(1, Math.max(0, s));
    const value = Math.min(1, Math.max(0, v));
    const turn = ((h % 360) + 360) % 360;
    const scaled = turn / 60;
    const sector = Math.floor(scaled);
    const fraction = scaled - sector;
    const p = value * (1 - saturation);
    const q = value * (1 - saturation * fraction);
    const t = value * (1 - saturation * (1 - fraction));
    let rgb: [number, number, number];
    switch (sector) {
        case 0:
            rgb = [value, t, p];
            break;
        case 1:
            rgb = [q, value, p];
            break;
        case 2:
            rgb = [p, value, t];
            break;
        case 3:
            rgb = [p, q, value];
            break;
        case 4:
            rgb = [t, p, value];
            break;
        default:
            rgb = [value, p, q];
    }
    return {
        r: Math.round(rgb[0] * 255),
        g: Math.round(rgb[1] * 255),
        b: Math.round(rgb[2] * 255),
    };
}
