import type { FreeTransform } from "../../core/floating";
import {
    MAX_REFERENCE_OFFSET,
    MAX_REFERENCE_SCALE,
    MIN_REFERENCE_SCALE,
} from "../../core/project/format";
import type { ReferencePlacement } from "../../core/references";
import { HANDLE_REACH, HANDLES, handlePoints } from "../selection/transform/handles";
import type { HandleId } from "../selection/transform/handles";
import type { Point } from "../view/coordinates";

// The geometry of a reference layer's drag on the canvas (SE-046; SPEC §7.6): its box, the
// corner a press takes, the uniform scale about the opposite corner and the move. A reference
// layer's box is never turned and has fractional sides, so it shares the transform box's
// handle positions (`handlePoints`) but not `scaleBox`, which rounds to whole pixels and
// scales the sides apart (DESIGN §5.2). Every result stays within the bounds a project file
// holds (FORMAT.md §1.8): a drag is clamped, never refused, on its way.

/** A corner of the box: the handles that scale a reference layer. */
export type ReferenceCorner = Extract<HandleId, "nw" | "ne" | "se" | "sw">;

export const REFERENCE_CORNERS: readonly ReferenceCorner[] = ["nw", "ne", "se", "sw"];

/** Size of a reference layer's decoded source, in its own pixels. */
export interface SourceSize {
    width: number;
    height: number;
}

/** The box a reference layer covers, in document pixels, as a transform box (angle 0). */
export function referenceBox(placement: ReferencePlacement, size: SourceSize): FreeTransform {
    return {
        x: placement.x,
        y: placement.y,
        width: size.width * placement.scale,
        height: size.height * placement.scale,
        angle: 0,
    };
}

/**
 * The corner of `box` a press at document position `point` takes, seen at `scale` device
 * pixels per document pixel and `ratio` device pixels per CSS pixel: the nearest within
 * `HANDLE_REACH` CSS pixels on both axes, as the transform box's handles are hit; null for
 * none. Only the corners count: the middles of the sides do not scale a reference layer.
 */
export function hitReferenceCorner(
    box: FreeTransform,
    point: Point,
    scale: number,
    ratio: number,
): ReferenceCorner | null {
    const reach = HANDLE_REACH * ratio;
    let best: { corner: ReferenceCorner; distance: number } | null = null;
    for (const { id, point: at } of handlePoints(box)) {
        if (!(REFERENCE_CORNERS as readonly HandleId[]).includes(id)) continue;
        const distance = Math.max(Math.abs(point.x - at.x), Math.abs(point.y - at.y)) * scale;
        if (distance <= reach && (!best || distance < best.distance)) {
            best = { corner: id as ReferenceCorner, distance };
        }
    }
    return best?.corner ?? null;
}

const clampOffset = (value: number) =>
    Math.min(MAX_REFERENCE_OFFSET, Math.max(-MAX_REFERENCE_OFFSET, value));

/** `start` moved by `dx`, `dy` document pixels, within the bounds of a file. */
export function moveReferenceBy(
    start: ReferencePlacement,
    dx: number,
    dy: number,
): ReferencePlacement {
    return { x: clampOffset(start.x + dx), y: clampOffset(start.y + dy), scale: start.scale };
}

/**
 * The smallest scale a drag gives a source of `size`: the box's longer side keeps one document
 * pixel, so its handles stay apart enough to take hold of again, and no less than a file holds.
 */
export function minimumReferenceScale(size: SourceSize): number {
    return Math.max(MIN_REFERENCE_SCALE, 1 / Math.max(size.width, size.height));
}

/**
 * The placement after a drag of `corner` that began with the layer at `start` and the corner
 * at its own position, the pointer now `dx`, `dy` document pixels from where it was pressed:
 * one scale for both sides, about the opposite corner, which stays where it is. The factor is
 * that of the axis farther from 1, as a corner with Shift scales a floating selection
 * (SE-033); the scale is kept from `minimumReferenceScale` (or `start.scale`, when that is
 * smaller) to `MAX_REFERENCE_SCALE`, and the position within the bounds of a file (only there
 * can the opposite corner move). When the scale stays, `start` itself is returned.
 */
export function scaleReferenceFrom(
    start: ReferencePlacement,
    size: SourceSize,
    corner: ReferenceCorner,
    dx: number,
    dy: number,
): ReferencePlacement {
    const { h, v } = HANDLES[corner];
    const width = size.width * start.scale;
    const height = size.height * start.scale;
    // Each axis's factor from its side's length and the pointer's travel along it, so no
    // travel is a factor of exactly 1; one from the corners' positions can be off 1 by their
    // rounding (SE-046 review A).
    const factorH = (width + h * dx) / width;
    const factorV = (height + v * dy) / height;
    const factor = Math.abs(factorH - 1) >= Math.abs(factorV - 1) ? factorH : factorV;
    const wanted = start.scale * factor;
    // A layer already below the minimum (the popover, a file, a sprite operation) keeps its
    // scale as the lower bound instead of snapping up at a press (review B).
    const lowest = Math.min(start.scale, minimumReferenceScale(size));
    const scale = Math.min(
        MAX_REFERENCE_SCALE,
        Math.max(lowest, Number.isFinite(wanted) ? wanted : start.scale),
    );
    // Unscaled, nothing moves: a press on a corner and a drag back to it change nothing.
    if (scale === start.scale) return start;
    // The opposite corner stays.
    const anchorX = h < 0 ? start.x + width : start.x;
    const anchorY = v < 0 ? start.y + height : start.y;
    const x = h < 0 ? anchorX - size.width * scale : anchorX;
    const y = v < 0 ? anchorY - size.height * scale : anchorY;
    return { x: clampOffset(x), y: clampOffset(y), scale };
}
