import type { Palette } from "./types";

export const DEFAULT_PALETTE_NAME = "DawnBringer 32";

/** DawnBringer 32 (DB32) in its published order, as opaque 0xRRGGBBAA. */
export const DAWNBRINGER_32: readonly number[] = [
    0x000000ff, 0x222034ff, 0x45283cff, 0x663931ff, 0x8f563bff, 0xdf7126ff, 0xd9a066ff, 0xeec39aff,
    0xfbf236ff, 0x99e550ff, 0x6abe30ff, 0x37946eff, 0x4b692fff, 0x524b24ff, 0x323c39ff, 0x3f3f74ff,
    0x306082ff, 0x5b6ee1ff, 0x639bffff, 0x5fcde4ff, 0xcbdbfcff, 0xffffffff, 0x9badb7ff, 0x847e87ff,
    0x696a6aff, 0x595652ff, 0x76428aff, 0xac3232ff, 0xd95763ff, 0xd77bbaff, 0x8f974aff, 0x8a6f30ff,
];

/** A new copy of the default palette of a document. */
export function defaultPalette(): Palette {
    return { name: DEFAULT_PALETTE_NAME, colors: [...DAWNBRINGER_32] };
}
