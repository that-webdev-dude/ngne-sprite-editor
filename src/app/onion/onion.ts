import type { DocSession, OnionSettings } from "../../core/model";
import { onionGhosts } from "../../core/onion";
import { frameKey } from "../../engine/viewport/types";
import type { ViewportGhost } from "../../engine/viewport/types";
import { activeDocument, sessionsStore } from "../state/sessions";

// Onion skin in the app (SPEC §7.5, SE-025): the settings of the active document, changed by
// plain setters (`DocSettings.onion`: saved with the document, no history entry, never dirty;
// SPEC §5.2), and the ghosts the viewport is given for a session.

/** The onion settings of the active document, or null while none is open. */
export function activeOnion(): Readonly<OnionSettings> | null {
    return activeDocument(sessionsStore.getState())?.session.doc.settings.onion ?? null;
}

/**
 * Changes the onion settings of the active document: no history entry, and the document does
 * not become dirty (SPEC §5.2). Values are those of `DocSettings.onion` (SPEC §5.1); one out
 * of its range throws `RangeError` before anything changed. Does nothing while no document is
 * open. Never waits for the history: a floating selection or a stroke may be open.
 */
export function setOnionSettings(patch: Partial<OnionSettings>): void {
    const state = sessionsStore.getState();
    const document = activeDocument(state);
    if (!document) return;
    const next = { ...document.session.doc.settings.onion, ...patch };
    checkOnion(next);
    const now = document.session.doc.settings.onion;
    const same = (Object.keys(next) as (keyof OnionSettings)[]).every(
        (key) => next[key] === now[key],
    );
    if (same) return;
    state.updateDocSettings(document.id, (settings) => {
        settings.onion = next;
    });
}

function checkOnion(onion: OnionSettings): void {
    const integer = (value: number, max: number) =>
        Number.isInteger(value) && value >= 0 && value <= max;
    if (!integer(onion.before, 3) || !integer(onion.after, 3)) {
        throw new RangeError("Onion skin frames before and after are 0 to 3.");
    }
    if (!integer(onion.opacity, 255)) throw new RangeError("Onion skin opacity is 0 to 255.");
    if (!(onion.falloff >= 0 && onion.falloff <= 1)) {
        throw new RangeError("Onion skin falloff is 0 to 1.");
    }
    if (onion.placement !== "behind" && onion.placement !== "front") {
        throw new RangeError("Onion skin placement is behind or front.");
    }
}

/**
 * The onion skins of `session`'s active frame as the viewport draws them: with tint on each
 * ghost is the tinted variant of its frame (`frameId:before`, `frameId:after`), with tint off
 * the frame's plain composite, whose slot is the one a switch to that frame shows.
 */
export function viewportGhosts(session: DocSession): ViewportGhost[] {
    const { doc, activeFrameId } = session;
    const { tint, placement } = doc.settings.onion;
    return onionGhosts(doc, activeFrameId).map((ghost) => ({
        key: frameKey(ghost.frameId, tint ? ghost.side : "plain"),
        alpha: ghost.alpha,
        placement,
    }));
}
