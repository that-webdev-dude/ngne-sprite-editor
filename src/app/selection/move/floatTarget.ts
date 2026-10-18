import type { OpenDocument } from "../../state/sessions";
import { PAINT_REFUSED, resolvePaintTarget } from "../../tools/paintTarget";

// Where pixels can float (SE-032): the active cel, when its layer could take paint. A float
// writes pixels as a stroke does, so it is refused on the layers a stroke is refused on, with
// the same status-bar messages (SPEC §7.1). Unlike paint it works at every zoom step: it moves
// pixels by whole texels, and does not depend on which texel a device pixel shows below 1×.

/** Why pixels of the active cel of `document` cannot float now, or null when they can. */
export function floatRefusal(document: OpenDocument): string | null {
    const target = resolvePaintTarget(document);
    if (!("refused" in target)) return null;
    // The zoom is checked last: refused for it, the layer itself can take the float.
    return target.refused === PAINT_REFUSED.overview ? null : target.refused;
}
