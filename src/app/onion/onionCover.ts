import { playbackStore } from "../playback/playbackState";
import { activeReferenceCover } from "../references/referenceCover";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import type { EchoCover } from "../tools/strokeEcho.overlay";
import { viewportGhosts } from "./onion";

// What the stroke echo (SPEC §6.6) gives way to while onion skins are on screen (SE-025). The
// echo is opaque and NGNE draws the ghosts under the composite's pixels that are not opaque
// (placed behind, quad layer 3) or over everything (in front, layer 5), so the echo gives way
// to them as it does to a reference (SPEC §7.6): with ghosts in front it draws nothing, with
// ghosts behind only the composite's opaque pixels, which hide the ghosts in NGNE as well. A
// ghost covers the whole canvas. NGNE shows what the echo leaves out once its upload is drawn.

/** Where the onion skins of `document` lie on its canvas: nothing while it plays. */
export function onionCover(document: OpenDocument, playing: boolean): EchoCover {
    const { session } = document;
    if (playing || viewportGhosts(session).length === 0) return { behind: [], front: [] };
    const canvas = [{ x: 0, y: 0, width: session.doc.width, height: session.doc.height }];
    return session.doc.settings.onion.placement === "front"
        ? { behind: [], front: canvas }
        : { behind: canvas, front: [] };
}

/** The onion skins of the active document, as `onionCover` gives them. */
export function activeOnionCover(): EchoCover {
    const document = activeDocument(sessionsStore.getState());
    if (!document) return { behind: [], front: [] };
    const { playing, session } = playbackStore.getState();
    return onionCover(document, playing && session === document.session);
}

/**
 * Everything the stroke echo of the active document gives way to: its references (SE-045) and
 * its onion skins.
 */
export function activeEchoCover(): EchoCover {
    const references = activeReferenceCover();
    const onion = activeOnionCover();
    return {
        behind: [...references.behind, ...onion.behind],
        front: [...references.front, ...onion.front],
    };
}
