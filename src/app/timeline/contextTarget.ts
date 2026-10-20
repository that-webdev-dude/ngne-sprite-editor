import { effectiveSelection, isCelSelected } from "./selection";
import type { CelRef } from "./selection";
import { tagStore } from "./tagState";
import { clickTimeline } from "./timelineClicks";
import { availableDocument } from "./timelineDocument";
import { TIMELINE_MENUS } from "./timelineEditIds";
import type { TimelineMenu } from "./timelineEditIds";
import { timelineStore } from "./timelineState";

// What a right-click in the timeline opens its context menu on (SE-026; DESIGN §4): a cel, a
// frame of the header, a layer row or a tag span. The commands of the menu act on the timeline's
// selection and the active cel, as from the menu bar: a right-click on an item outside the
// selection selects it first (as a click does), one inside keeps the selection. A tag's commands
// act on the tag right-clicked while its menu is open (`tagStore.target`).

export type ContextTarget =
    | { readonly kind: "cel"; readonly cel: CelRef }
    | { readonly kind: "frame"; readonly frameId: string }
    | { readonly kind: "layer"; readonly layerId: string }
    | { readonly kind: "tag"; readonly tagId: string };

const NO_MODIFIERS = { shift: false, toggle: false };

/** The context menu of a target. */
export function menuOf(target: ContextTarget): TimelineMenu {
    return TIMELINE_MENUS[target.kind];
}

/**
 * Prepares the commands for the menu of `target`: selects it unless the selection holds it, or
 * makes a tag the one the tag commands act on. Returns false when no menu can open (no document,
 * or a stroke in progress).
 */
export function openContextTarget(target: ContextTarget): boolean {
    // A menu opened over another one replaces it.
    closeContextTarget();
    const document = availableDocument();
    if (!document) return false;
    const selection = effectiveSelection(
        timelineStore.getState().selection,
        document.id,
        document.session,
    );
    switch (target.kind) {
        case "cel": {
            const { layerId, frameId } = target.cel;
            if (isCelSelected(selection, layerId, frameId)) return true;
            return clickTimeline({ kind: "cels", cel: target.cel }, NO_MODIFIERS);
        }
        case "frame":
            if (selection?.kind === "frames" && selection.frameIds.includes(target.frameId)) {
                return true;
            }
            return clickTimeline({ kind: "frames", frameId: target.frameId }, NO_MODIFIERS);
        case "layer":
            if (selection?.kind === "layers" && selection.layerIds.includes(target.layerId)) {
                return true;
            }
            return clickTimeline({ kind: "layers", layerId: target.layerId }, NO_MODIFIERS);
        case "tag":
            if (!document.session.doc.tags.some((tag) => tag.id === target.tagId)) return false;
            tagStore.setState({ target: target.tagId });
            return true;
    }
}

/** The context menu closed: the tag commands act on the active tag again. */
export function closeContextTarget(): void {
    if (tagStore.getState().target !== null) tagStore.setState({ target: null });
}
