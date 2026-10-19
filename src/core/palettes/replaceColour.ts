import { compositeCommand, pixelPatchCommand } from "../history";
import type { Command, PixelAllocator } from "../history";
import { copyRect, defaultPixelAllocator } from "../history/allocate";
import { celAt } from "../model";
import type { DocSession, Layer, PixelLayer, Rect } from "../model";
import { maskHas } from "../selection";

// Replace Colour (SPEC §7.1, Replace colour; DESIGN §7; SE-066): every pixel of one colour,
// within a tolerance, becomes another colour, in the selection of the active cel, the active
// cel, every cel of the active frame or every cel of the sprite. The change is one command,
// one undo step, of a pixel patch per image changed (the bounding rectangle of its changed
// pixels), so undo puts back exactly what was there.
//
// Which pixels: a pixel matches when each of its channels R, G, B and A differs from the
// colour's by at most the tolerance (0–255). A pixel of alpha 0 holds no colour (SPEC §5.3)
// and is compared as 0,0,0,0, and so is a colour of alpha 0; a replacement of alpha 0 is
// written as 0,0,0,0. A pixel that is the replacement already is not changed.
//
// Which cels: those of the layers paint may go to (SPEC §7.1): visible, unlocked pixel layers.
// Reference layers hold no cels. For the selection and the cel the active layer must be such
// a layer, or the command is refused; for the frame and the sprite the others are skipped.
// An empty cel holds no pixel, so it is skipped too and no cel is made. Linked cels share one
// image: it is changed once, and every cel that shows it shows the change, as a stroke on a
// linked cel does; an image that a cel of a skipped layer also shows is left as it is, so a
// locked or hidden layer never changes.

/** Where Replace Colour looks (DESIGN §7). */
export type ReplaceScope = "selection" | "cel" | "frame" | "sprite";

export const REPLACE_SCOPES: readonly ReplaceScope[] = ["selection", "cel", "frame", "sprite"];

/** The largest tolerance: every pixel matches. */
export const MAX_REPLACE_TOLERANCE = 255;

export interface ReplaceColourOptions {
    /** The colour to replace, 0xRRGGBBAA. */
    from: number;
    /** The colour written in its place, 0xRRGGBBAA. */
    to: number;
    /** 0–255: the largest difference of any channel from `from` that still matches. */
    tolerance: number;
    scope: ReplaceScope;
}

/**
 * Why a replacement cannot be made: no selection for the scope "selection", or an active
 * layer that is missing, a reference layer, hidden or locked for "selection" and "cel".
 */
export type ReplaceRefusal = "no-selection" | "missing" | "reference" | "hidden" | "locked";

export type ReplaceColourResult =
    | { readonly refused: ReplaceRefusal }
    | {
          /** The one undo step, or null when no pixel changes. */
          readonly command: Command | null;
          /** Pixels that change. */
          readonly pixels: number;
          /** Images that change (linked cels share one). */
          readonly images: number;
      };

/** A layer Replace Colour may change: a visible, unlocked pixel layer (SPEC §7.1). */
export function isReplaceableLayer(layer: Layer): layer is PixelLayer {
    return layer.kind === "pixel" && layer.visible && !layer.locked;
}

function isColour(value: number): boolean {
    return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

/** A colour as compared and written: 0,0,0,0 when its alpha is 0. */
function normalized(colour: number): number {
    return (colour & 0xff) === 0 ? 0 : colour >>> 0;
}

/** The layers and frames a scope looks at, or why it cannot. */
function targetsOf(
    session: DocSession,
    scope: ReplaceScope,
): { layers: PixelLayer[]; frameIds: string[] } | { refused: ReplaceRefusal } {
    const { doc } = session;
    if (scope === "selection" || scope === "cel") {
        if (scope === "selection" && !session.selection) return { refused: "no-selection" };
        const layer = doc.layers.find((entry) => entry.id === session.activeLayerId);
        if (!layer) return { refused: "missing" };
        if (layer.kind !== "pixel") return { refused: "reference" };
        if (!layer.visible) return { refused: "hidden" };
        if (layer.locked) return { refused: "locked" };
        return { layers: [layer], frameIds: [session.activeFrameId] };
    }
    const layers = doc.layers.filter(isReplaceableLayer);
    const frameIds =
        scope === "frame" ? [session.activeFrameId] : doc.frames.map((frame) => frame.id);
    return { layers, frameIds };
}

/**
 * The command that replaces `options.from` by `options.to` within `options.tolerance` in
 * `options.scope` (see above), with the number of pixels and images it changes; or why it
 * cannot. It is not applied here: pass the command to `History.execute`. Throws `RangeError`
 * for a colour that is not 0..0xFFFFFFFF or a tolerance that is not an integer 0–255, and
 * `AllocationError` when the pixels for undo cannot be stored.
 */
export function replaceColourCommand(
    session: DocSession,
    options: ReplaceColourOptions,
    allocate: PixelAllocator = defaultPixelAllocator,
): ReplaceColourResult {
    const { from, to, tolerance, scope } = options;
    if (!isColour(from) || !isColour(to)) {
        throw new RangeError(`replaceColourCommand: ${from} or ${to} is not a colour.`);
    }
    if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > MAX_REPLACE_TOLERANCE) {
        throw new RangeError(`replaceColourCommand: tolerance ${tolerance} is not 0–255.`);
    }
    const targets = targetsOf(session, scope);
    if ("refused" in targets) return targets;

    const { doc } = session;
    // Images a cel of a hidden or locked layer shows as well: never changed.
    const kept = new Set<string>();
    for (const layer of doc.layers) {
        if (isReplaceableLayer(layer)) continue;
        for (const frame of doc.frames) {
            const cel = celAt(doc, layer.id, frame.id);
            if (cel) kept.add(cel.imageId);
        }
    }
    // Each image once, in document order: layers bottom to top, then frames.
    const imageIds: string[] = [];
    const listed = new Set<string>();
    for (const layer of targets.layers) {
        for (const frameId of targets.frameIds) {
            const cel = celAt(doc, layer.id, frameId);
            if (!cel || kept.has(cel.imageId) || listed.has(cel.imageId)) continue;
            listed.add(cel.imageId);
            imageIds.push(cel.imageId);
        }
    }

    const mask = scope === "selection" ? (session.selection?.mask ?? null) : null;
    const region: Rect =
        scope === "selection" && session.selection
            ? session.selection.bounds
            : { x: 0, y: 0, width: doc.width, height: doc.height };
    const source = normalized(from);
    const fr = source >>> 24;
    const fg = (source >>> 16) & 0xff;
    const fb = (source >>> 8) & 0xff;
    const fa = source & 0xff;
    const target = normalized(to);
    const replacement = [
        target >>> 24,
        (target >>> 16) & 0xff,
        (target >>> 8) & 0xff,
        target & 0xff,
    ];
    const within = (value: number, wanted: number) => Math.abs(value - wanted) <= tolerance;

    const parts: Command[] = [];
    let pixels = 0;
    for (const imageId of imageIds) {
        const image = doc.images.get(imageId);
        if (!image) continue;
        const { data, width } = image;
        /** Whether the pixel at `at` (a byte offset) changes. */
        const changes = (at: number, x: number, y: number): boolean => {
            if (mask && !maskHas(mask, x, y)) return false;
            const alpha = data[at + 3];
            const r = alpha === 0 ? 0 : data[at];
            const g = alpha === 0 ? 0 : data[at + 1];
            const b = alpha === 0 ? 0 : data[at + 2];
            if (!within(r, fr) || !within(g, fg) || !within(b, fb) || !within(alpha, fa)) {
                return false;
            }
            return (
                r !== replacement[0] ||
                g !== replacement[1] ||
                b !== replacement[2] ||
                alpha !== replacement[3]
            );
        };
        let left = Infinity;
        let top = Infinity;
        let right = -1;
        let bottom = -1;
        let count = 0;
        for (let y = region.y; y < region.y + region.height; y++) {
            for (let x = region.x; x < region.x + region.width; x++) {
                if (!changes((y * width + x) * 4, x, y)) continue;
                count++;
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                bottom = y;
            }
        }
        if (count === 0) continue;
        const rect = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
        const after = copyRect(allocate, image, rect);
        for (let y = rect.y; y <= bottom; y++) {
            for (let x = rect.x; x <= right; x++) {
                if (!changes((y * width + x) * 4, x, y)) continue;
                after.data.set(replacement, ((y - rect.y) * rect.width + (x - rect.x)) * 4);
            }
        }
        parts.push(
            pixelPatchCommand(
                doc,
                { label: "Replace Colour", imageId, x: rect.x, y: rect.y, pixels: after },
                allocate,
            ),
        );
        pixels += count;
    }
    return {
        command: parts.length === 0 ? null : compositeCommand("Replace Colour", parts),
        pixels,
        images: parts.length,
    };
}
