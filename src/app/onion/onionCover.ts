import type { DocSession, Rect } from "../../core/model";
import { contentBounds } from "../../core/onion";
import { parseFrameKey } from "../../engine/viewport/types";
import { playbackStore } from "../playback/playbackState";
import { activeReferenceCover } from "../references/referenceCover";
import { activeComposites } from "../state/composites";
import type { ActiveComposites } from "../state/composites";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import type { EchoCover } from "../tools/strokeEcho.overlay";
import { viewportGhosts } from "./onion";

// What the stroke echo (SPEC §6.6) gives way to while onion skins are on screen (SE-025). The
// echo is opaque and NGNE draws the ghosts under the composite's pixels that are not opaque
// (placed behind, quad layer 3) or over everything (in front, layer 5), so the echo gives way
// to them as it does to a reference (SPEC §7.6): over a ghost in front it draws nothing, over
// one behind only the composite's opaque pixels, which hide the ghost in NGNE as well. A ghost
// covers the bounding rectangle of its frame's pixels that are not transparent (review E), so
// a stroke away from every ghost's content is echoed in full. NGNE shows what the echo leaves
// out once its upload is drawn.

const NONE: EchoCover = { behind: [], front: [] };

/** Where the onion skins of `document` lie on its canvas: nothing while it plays. */
export type OnionCover = (document: OpenDocument, playing: boolean) => EchoCover;

/**
 * The onion cover of the documents whose composites `composites` holds. Each ghost frame's
 * bounds are kept until the cache reports a change of that frame (SPEC §5.3: readers learn of
 * a change from its notifications), and are read from the cache's composite when the echo
 * draws, never inside a notification. A ghost of a document without composites (not the active
 * one) covers the whole canvas.
 */
export function createOnionCover(
    composites: Pick<ActiveComposites, "cacheOf" | "subscribe">,
): OnionCover {
    /** The bounds of each ghost frame of `owner`'s document; null for one with no content. */
    const bounds = new Map<string, Rect | null>();
    let owner: DocSession | null = null;
    composites.subscribe((touched, session) => {
        if (session !== owner) return;
        if (touched.structure) bounds.clear();
        else for (const frameId of touched.frameIds) bounds.delete(frameId);
    });

    const boundsOf = (session: DocSession, frameId: string): Rect | null => {
        if (session !== owner) {
            owner = session;
            bounds.clear();
        }
        const kept = bounds.get(frameId);
        if (kept !== undefined) return kept;
        const cache = composites.cacheOf(session);
        const { width, height } = session.doc;
        if (!cache) return { x: 0, y: 0, width, height };
        const found = contentBounds(cache.get(frameId));
        bounds.set(frameId, found);
        return found;
    };

    return (document, playing) => {
        const { session } = document;
        if (playing) return NONE;
        const ghosts = viewportGhosts(session);
        if (ghosts.length === 0) return NONE;
        const rects: Rect[] = [];
        for (const ghost of ghosts) {
            const rect = boundsOf(session, parseFrameKey(ghost.key).frameId);
            if (rect) rects.push(rect);
        }
        return session.doc.settings.onion.placement === "front"
            ? { behind: [], front: rects }
            : { behind: rects, front: [] };
    };
}

/** The onion cover of the app's active document. */
export const onionCover: OnionCover = createOnionCover(activeComposites);

/** The onion skins of the active document, as `onionCover` gives them. */
export function activeOnionCover(): EchoCover {
    const document = activeDocument(sessionsStore.getState());
    if (!document) return NONE;
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
