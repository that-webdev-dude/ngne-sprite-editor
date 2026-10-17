import type { StoreApi } from "zustand/vanilla";
import { celAt } from "../../core/model";
import type { DocSession } from "../../core/model";
import { activeDocument } from "../state/sessions";
import type { SessionsState } from "../state/sessions";

// What the timeline panel shows of a document (DESIGN §5.6, SE-022), read from the document
// model alone: the cel states come from `SpriteDoc.cels`, never from images or composites, so
// a document with many large hidden layers costs the panel nothing more than its cel map.

/** DESIGN §5.6: empty (hollow dot), filled (solid dot), linked (shares its image). */
export type CelState = "empty" | "filled" | "linked";

export interface TimelineFrame {
    readonly id: string;
    readonly durationMs: number;
}

export interface TimelineLayer {
    readonly id: string;
    readonly name: string;
    readonly visible: boolean;
    readonly locked: boolean;
    /** 0..255. */
    readonly opacity: number;
    /** One state per frame, in playback order. */
    readonly cels: readonly CelState[];
    /**
     * Per frame: the cel shares its image with the cel of the next frame on this layer, so the
     * two are joined by a line.
     */
    readonly linkedToNext: readonly boolean[];
    /** Changes whenever anything above changes: what a row is rendered again for. */
    readonly key: string;
}

export interface TimelineModel {
    readonly documentId: string;
    readonly frames: readonly TimelineFrame[];
    /** The pixel layers, top of the stack first: the order of the rows. */
    readonly layers: readonly TimelineLayer[];
    readonly activeLayerId: string;
    readonly activeFrameId: string;
}

/** The timeline of a session's document. */
export function timelineModel(documentId: string, session: DocSession): TimelineModel {
    const { doc } = session;
    // How many cels show each image: two or more are linked (SPEC §7.4).
    const users = new Map<string, number>();
    for (const cel of doc.cels.values()) users.set(cel.imageId, (users.get(cel.imageId) ?? 0) + 1);

    const layers: TimelineLayer[] = [];
    for (let index = doc.layers.length - 1; index >= 0; index--) {
        const layer = doc.layers[index];
        if (layer.kind !== "pixel") continue;
        const images = doc.frames.map((frame) => celAt(doc, layer.id, frame.id)?.imageId ?? null);
        const cels = images.map((imageId): CelState => {
            if (imageId === null) return "empty";
            return (users.get(imageId) ?? 0) > 1 ? "linked" : "filled";
        });
        const linkedToNext = images.map(
            (imageId, frame) => imageId !== null && imageId === images[frame + 1],
        );
        const { id, name, visible, locked, opacity } = layer;
        const states = cels.map((state) => state[0]).join("");
        const links = linkedToNext.map((linked) => (linked ? "1" : "0")).join("");
        const key = `${JSON.stringify([id, name])}${+visible}${+locked}:${opacity}:${states}:${links}`;
        layers.push({ id, name, visible, locked, opacity, cels, linkedToNext, key });
    }
    return {
        documentId,
        frames: doc.frames.map(({ id, durationMs }) => ({ id, durationMs })),
        layers,
        activeLayerId: session.activeLayerId,
        activeFrameId: session.activeFrameId,
    };
}

/** Whether two models show the same: compared by the rows' keys, not cel by cel. */
function sameModel(a: TimelineModel, b: TimelineModel): boolean {
    return (
        a.documentId === b.documentId &&
        a.activeLayerId === b.activeLayerId &&
        a.activeFrameId === b.activeFrameId &&
        a.frames.length === b.frames.length &&
        a.frames.every(
            (frame, index) =>
                frame.id === b.frames[index]?.id &&
                frame.durationMs === b.frames[index]?.durationMs,
        ) &&
        a.layers.length === b.layers.length &&
        a.layers.every((layer, index) => layer.key === b.layers[index]?.key)
    );
}

/**
 * Whether a change of the session store leaves what the timeline shows as it was: the active
 * document is the same record, or only its view changed (a pan or a zoom).
 */
function timelineUnchanged(state: SessionsState, previous: SessionsState): boolean {
    if (state.activeId !== previous.activeId) return false;
    const next = activeDocument(state);
    const before = activeDocument(previous);
    if (next === before) return true;
    return (
        next !== null &&
        before !== null &&
        next.session === before.session &&
        next.history === before.history &&
        next.view !== before.view
    );
}

/** The timeline of the active document, as the panel subscribes to it (`timelineSource`). */
export interface TimelineSource {
    /** Calls `listener` after each change of the session store that can change the model. */
    subscribe(listener: () => void): () => void;
    /**
     * The model of the active document, null while none is open. The same object while what
     * it shows is the same, so the panel renders again only for a change it shows.
     */
    current(): TimelineModel | null;
}

/**
 * The timeline of a session store's active document. The model is built again only after a
 * change of the store that can change it: a pan or a zoom (`setView`), or a change of another
 * document, costs one comparison; a history step that changes pixels alone builds it once and
 * finds it equal row by row.
 */
export function timelineSource(store: StoreApi<SessionsState>): TimelineSource {
    const listeners = new Set<() => void>();
    let stop: (() => void) | null = null;
    let model: TimelineModel | null = null;
    /** The model may differ from the store: always true while nothing subscribes. */
    let stale = true;
    const changed = (state: SessionsState, previous: SessionsState) => {
        if (timelineUnchanged(state, previous)) return;
        stale = true;
        for (const listener of [...listeners]) listener();
    };
    return {
        subscribe(listener) {
            listeners.add(listener);
            stop ??= store.subscribe(changed);
            return () => {
                listeners.delete(listener);
                if (listeners.size > 0) return;
                stop?.();
                stop = null;
                stale = true;
            };
        },
        current() {
            if (!stale) return model;
            stale = listeners.size === 0;
            const document = activeDocument(store.getState());
            const next = document ? timelineModel(document.id, document.session) : null;
            if (!next || !model || !sameModel(model, next)) model = next;
            return model;
        },
    };
}
