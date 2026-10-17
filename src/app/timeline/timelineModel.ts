import { celAt } from "../../core/model";
import type { DocSession } from "../../core/model";

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

/**
 * The timeline of a session's document as a string: equal for two states exactly when the
 * panel shows the same. The panel subscribes to it, so a step that changes only pixels, or a
 * stroke's frame, does not render the panel again.
 */
export function timelineKey(documentId: string, session: DocSession): string {
    return JSON.stringify(timelineModel(documentId, session));
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
        const key = JSON.stringify([id, name, visible, locked, opacity, cels, linkedToNext]);
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
