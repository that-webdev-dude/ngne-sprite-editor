import type { BitMask } from "../../core/model";
import { selectionBoundary } from "../../core/selection";
import type { SelectionBoundary } from "../../core/selection";

// The boundaries the overlay draws from (SE-030, SE-031), worked out once per mask and shared
// by the layers that draw a mask's ring: the ants of the selection and the preview of a
// selection tool's gesture. A magic-wand pick hands its very mask on to the selection
// (`applySelection` with Replace keeps the shape's mask), so the ants find the boundary the
// preview worked out at the press. Only the masks asked for last are kept — the selection's
// and a pending pick's — never one for each mask the history holds (SE-030 review, E75).

/** How many masks keep their boundary. */
export const KEPT_BOUNDARIES = 2;

const kept: { mask: BitMask; boundary: SelectionBoundary }[] = [];

/** The boundary of `mask` (`selectionBoundary`), worked out again only for a mask not kept. */
export function boundaryOf(mask: BitMask): SelectionBoundary {
    const index = kept.findIndex((entry) => entry.mask === mask);
    if (index >= 0) {
        const [entry] = kept.splice(index, 1);
        kept.unshift(entry!);
        return entry!.boundary;
    }
    const boundary = selectionBoundary(mask);
    kept.unshift({ mask, boundary });
    kept.length = Math.min(kept.length, KEPT_BOUNDARIES);
    return boundary;
}

/** Lets go of the boundary of `mask`, if it is kept. */
export function forgetBoundary(mask: BitMask): void {
    const index = kept.findIndex((entry) => entry.mask === mask);
    if (index >= 0) kept.splice(index, 1);
}
