import { activeTagAt, frameIndex } from "../model";
import type { OnionSettings, PixelBuffer, Rect, SpriteDoc } from "../model";

// Onion skin (SPEC §7.5, SE-025): which frames are shown around the active one and how, and
// the CPU tint of their composites. Onion skins are never part of a composite (SPEC §5.3): the
// viewport draws them as quads of their own, from these.

/** A ghost lies before the active frame (tinted red) or after it (tinted blue). */
export type OnionSide = "before" | "after";

/** One frame shown as an onion skin. */
export interface OnionGhost {
    readonly frameId: string;
    readonly side: OnionSide;
    /** Distance from the active frame, 1 for its neighbour. */
    readonly step: number;
    /** Opacity of the quad, 0 to 1: base opacity × falloff for each step after the first. */
    readonly alpha: number;
}

/**
 * The opacity of the ghost `step` frames away (1 for a neighbour): `opacity` / 255 for the
 * nearest, times `falloff` for each further step (FORMAT: "Factor on the opacity for each
 * further frame").
 */
export function onionAlpha(settings: Pick<OnionSettings, "opacity" | "falloff">, step: number) {
    return (settings.opacity / 255) * settings.falloff ** (step - 1);
}

/**
 * The ghosts of the frame `frameId` under `settings` (the document's own by default), in draw
 * order: the farthest frame before first, the nearest before last, then the same after, so a
 * nearer ghost lies over a farther one. None while onion skin is off. A frame outside the
 * document is never a ghost, and none outside the active tag's range with `withinTag` (the
 * whole document when no tag contains the frame); the range does not wrap. A ghost whose
 * opacity is 0 is left out.
 */
export function onionGhosts(
    doc: SpriteDoc,
    frameId: string,
    settings: OnionSettings = doc.settings.onion,
): OnionGhost[] {
    if (!settings.enabled) return [];
    const index = frameIndex(doc, frameId);
    if (index === -1) return [];
    let first = 0;
    let last = doc.frames.length - 1;
    if (settings.withinTag) {
        const tag = activeTagAt(doc, index);
        if (tag) {
            first = frameIndex(doc, tag.fromFrameId);
            last = frameIndex(doc, tag.toFrameId);
        }
    }
    const ghosts: OnionGhost[] = [];
    const side = (name: OnionSide, count: number, direction: -1 | 1) => {
        for (let step = count; step >= 1; step--) {
            const at = index + direction * step;
            const frame = doc.frames[at];
            if (!frame || at < first || at > last) continue;
            const alpha = onionAlpha(settings, step);
            if (alpha > 0) ghosts.push({ frameId: frame.id, side: name, step, alpha });
        }
    };
    side("before", settings.before, -1);
    side("after", settings.after, 1);
    return ghosts;
}

/**
 * The bounding rectangle of the pixels of `buffer` whose alpha is not 0, or null when every
 * pixel is transparent: where a ghost of that composite shows anything (SE-025 review E).
 */
export function contentBounds(buffer: PixelBuffer): Rect | null {
    const { width, height, data } = buffer;
    let left = width;
    let right = -1;
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
        const row = y * width * 4;
        let first = -1;
        for (let x = 0; x < width; x++) {
            if (data[row + x * 4 + 3] !== 0) {
                first = x;
                break;
            }
        }
        if (first === -1) continue;
        if (top === -1) top = y;
        bottom = y;
        if (first < left) left = first;
        for (let x = width - 1; x > right; x--) {
            if (data[row + x * 4 + 3] !== 0) {
                right = x;
                break;
            }
        }
    }
    if (top === -1) return null;
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** The colour each side is tinted toward, RGB. */
export const ONION_TINT: Readonly<Record<OnionSide, readonly [number, number, number]>> = {
    before: [255, 0, 0],
    after: [0, 0, 255],
};

/**
 * A tinted copy of a composite (straight RGBA8): each colour channel halfway toward the
 * side's tint colour (`ONION_TINT`), rounded half up, alpha kept (SPEC §7.5). Not a multiply:
 * black becomes dark red or dark blue. A pixel of alpha 0 stays `0,0,0,0`. `source` is not
 * changed.
 *
 * The result is written into `into` when it is given and has the source's size (a buffer kept
 * for the ghost, so a ghost uploaded at every animation frame of a stroke allocates nothing;
 * SE-025 review F), otherwise into a new buffer. `into` must not be `source`.
 */
export function tintOnion(source: PixelBuffer, side: OnionSide, into?: PixelBuffer): PixelBuffer {
    const [tr, tg, tb] = ONION_TINT[side];
    const from = source.data;
    const reuse =
        into !== undefined &&
        into.data !== from &&
        into.width === source.width &&
        into.height === source.height &&
        into.data.length === from.length;
    const target = reuse
        ? into
        : { width: source.width, height: source.height, data: new Uint8ClampedArray(from.length) };
    const data = target.data;
    for (let at = 0; at < from.length; at += 4) {
        const alpha = from[at + 3]!;
        if (alpha === 0) {
            data[at] = 0;
            data[at + 1] = 0;
            data[at + 2] = 0;
            data[at + 3] = 0;
            continue;
        }
        data[at] = (from[at]! + tr + 1) >> 1;
        data[at + 1] = (from[at + 1]! + tg + 1) >> 1;
        data[at + 2] = (from[at + 2]! + tb + 1) >> 1;
        data[at + 3] = alpha;
    }
    return target;
}
