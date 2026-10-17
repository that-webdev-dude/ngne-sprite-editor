import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { activeDocument, sessionsStore, useSessions } from "../../app/state/sessions";
import type { CelRef, TimelineSelection } from "../../app/timeline/selection";
import { timelineSource } from "../../app/timeline/timelineModel";
import type { TimelineModel } from "../../app/timeline/timelineModel";
import { timelineStore } from "../../app/timeline/timelineState";

const source = timelineSource(sessionsStore);

/** What the panel draws: the active document's timeline (`timelineSource`) and the selection. */
export interface ShownTimeline {
    readonly model: TimelineModel | null;
    readonly selection: TimelineSelection | null;
}

function read(): ShownTimeline {
    return { model: source.current(), selection: timelineStore.getState().selection };
}

/** Once idle, at the latest this long after the frames it waits for, the panel is drawn (ms). */
const LATEST_MS = 50;

/**
 * What the timeline panel draws of the active document and of its selection, brought up to
 * date after a change once two animation frames have passed and the main thread is idle, as a
 * transition. The canvas comes first (DESIGN §1, principle 3): a history step's frame is
 * uploaded in the step's microtasks and drawn at one of the next two animation frames (SPEC
 * §6.4; the SE-022 acceptance asks for a visibility change within two). Measured in the SE-022
 * review, each shorter wait made the canvas miss them more often: the panel drawn in the
 * step's own task, after one frame, or in a task after two frames.
 *
 * The model is built in that deferred callback, not in the step's task, and only after a change
 * that can change it (`timelineSource`: a pan or a zoom costs nothing); the panel renders again
 * only when the model or the selection is another object. The selection is taken with the
 * model, so a selection is never drawn against another active cel. What the next key acts on —
 * the active cell's tab stop and focus, the duration field — follows the stores at once
 * (`useLiveCel`, `TimelineCorner`).
 */
export function useShownTimeline(): ShownTimeline {
    const [shown, setShown] = useState(read);
    const last = useRef(shown);
    useEffect(() => {
        let frame: number | null = null;
        let idle: number | null = null;
        const update = () => {
            idle = null;
            const next = read();
            const { model, selection } = last.current;
            if (next.model === model && next.selection === selection) return;
            last.current = next;
            startTransition(() => setShown(next));
        };
        const schedule = () => {
            if (frame !== null || idle !== null) return;
            frame = requestAnimationFrame(() => {
                frame = requestAnimationFrame(() => {
                    frame = null;
                    idle = requestIdleCallback(update, { timeout: LATEST_MS });
                });
            });
        };
        const stopModel = source.subscribe(schedule);
        const stopTimeline = timelineStore.subscribe(schedule);
        // A change between the first render and this effect.
        update();
        return () => {
            stopModel();
            stopTimeline();
            if (frame !== null) cancelAnimationFrame(frame);
            if (idle !== null) cancelIdleCallback(idle);
        };
    }, []);
    return shown;
}

/** The active document's active cel as the session has it now, with the document's id. */
export interface LiveCel extends CelRef {
    readonly documentId: string;
}

/**
 * The active cel of the active document as the session has it now, ahead of what the panel
 * draws: the grid's tab stop and the focus follow it in the task of the change, so a key
 * pressed right after a click or another key acts from the right cell. Renders again only when
 * it changes.
 */
export function useLiveCel(): LiveCel | null {
    const key = useSessions((state) => {
        const document = activeDocument(state);
        if (!document) return "";
        const { activeLayerId, activeFrameId } = document.session;
        return JSON.stringify([document.id, activeLayerId, activeFrameId]);
    });
    return useMemo(() => {
        if (key === "") return null;
        const [documentId = "", layerId = "", frameId = ""] = JSON.parse(key) as string[];
        return { documentId, layerId, frameId };
    }, [key]);
}
