import { useEffect, useState } from "react";
import { activeDocument, sessionsStore } from "../../app/state/sessions";
import type { TimelineSelection } from "../../app/timeline/selection";
import { timelineKey } from "../../app/timeline/timelineModel";
import { timelineStore } from "../../app/timeline/timelineState";

/** What the panel shows: the active document's timeline (`timelineKey`) and the selection. */
export interface ShownTimeline {
    readonly key: string | null;
    readonly selection: TimelineSelection | null;
}

function read(): ShownTimeline {
    const document = activeDocument(sessionsStore.getState());
    return {
        key: document ? timelineKey(document.id, document.session) : null,
        selection: timelineStore.getState().selection,
    };
}

/** Once idle, at the latest this long after the frames it waits for, the panel is drawn (ms). */
const LATEST_MS = 50;

/**
 * What the timeline panel shows of the active document and of its selection, brought up to
 * date after a change once two animation frames have passed and the main thread is idle.
 * The canvas comes first (DESIGN §1, principle 3): a history step's frame is uploaded in the
 * step's microtasks and drawn at one of the next two animation frames (SPEC §6.4; the SE-022
 * acceptance asks for a visibility change within two), and a panel drawn in that window can
 * make the canvas miss it. The selection is taken with the document, so a selection is never
 * shown against another active cel.
 *
 * The panel renders again only when what it shows has changed: a step that changes pixels
 * alone, or a stroke's frame, costs it one string comparison.
 */
export function useShownTimeline(): ShownTimeline {
    const [shown, setShown] = useState(read);
    useEffect(() => {
        let frame: number | null = null;
        let idle: number | null = null;
        const update = () => {
            idle = null;
            const next = read();
            setShown((current) =>
                current.key === next.key && current.selection === next.selection ? current : next,
            );
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
        const stopSessions = sessionsStore.subscribe(schedule);
        const stopTimeline = timelineStore.subscribe(schedule);
        // A change between the first render and this effect.
        update();
        return () => {
            stopSessions();
            stopTimeline();
            if (frame !== null) cancelAnimationFrame(frame);
            if (idle !== null) cancelIdleCallback(idle);
        };
    }, []);
    return shown;
}
