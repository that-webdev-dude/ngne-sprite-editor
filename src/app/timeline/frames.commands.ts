import {
    addFrameCommand,
    deleteFramesCommand,
    duplicateFramesCommand,
    isFrameDuration,
    setFrameDurationCommand,
} from "../../core/frames";
import { frameIndex } from "../../core/model";
import type { CommandSpec } from "../commands/types";
import type { OpenDocument } from "../state/sessions";
import { durationFrameIds } from "./frameDuration";
import { effectiveSelection, targetFrameIds } from "./selection";
import { TIMELINE_COMMANDS as IDS } from "./timelineCommandIds";
import { activateCel, availableDocument, executeOnActive } from "./timelineDocument";
import { timelineStore } from "./timelineState";

// Frame commands of the timeline (SPEC §7.4, §7.8; SE-022). They take the Frame menu items
// planned for them. New Frame (Alt+N) duplicates the active frame, New Empty Frame (Alt+B)
// adds an empty one after it (SPEC §7.4: Aseprite's default is the duplicate). Delete Frame
// and Apply Frame Duration act on the selected frames, or on the active frame when none is
// selected (`selection.ts`); the duration field of the panel runs the latter, on the frames
// fixed when it took the focus (`frameDuration.ts`).
//
// Frame navigation: in the timeline ←, →, Home and End move the active cell to the previous,
// next, first and last frame; the same commands are the items of the Frame menu. On the canvas
// (viewport focused) ← and → change the frame only while there is no selection, because with
// one they lift and nudge it (SE-032); they are two commands of their own, so the menu items
// stay enabled with a selection. Navigation stops at the first and the last frame.

function selectionOf(document: OpenDocument) {
    return effectiveSelection(timelineStore.getState().selection, document.id, document.session);
}

/** The frames Delete Frame acts on. */
function targetFrames(document: OpenDocument): string[] {
    return targetFrameIds(document.session, selectionOf(document));
}

/** The frame `step` frames away from the active one, or at an end; null when there is none. */
function frameAt(where: "first" | "last" | 1 | -1): string | null {
    const document = availableDocument();
    if (!document) return null;
    const { doc, activeFrameId } = document.session;
    const index = frameIndex(doc, activeFrameId);
    const target = where === "first" ? 0 : where === "last" ? doc.frames.length - 1 : index + where;
    const frame = doc.frames[target];
    return frame && frame.id !== activeFrameId ? frame.id : null;
}

function goTo(where: "first" | "last" | 1 | -1): void {
    const frameId = frameAt(where);
    if (frameId !== null) activateCel({ frameId });
}

/** On the canvas the arrows change the frame only without a selection (SPEC §7.8). */
function frameOnCanvas(step: 1 | -1): string | null {
    const document = availableDocument();
    return document && document.session.selection === null ? frameAt(step) : null;
}

function deleteFrames(): void {
    executeOnActive((document) => {
        const ids = targetFrames(document);
        if (ids.length >= document.session.doc.frames.length) return null;
        return deleteFramesCommand(document.session.doc, ids);
    });
}

function setDuration(): void {
    const { duration } = timelineStore.getState();
    if (duration === null || !isFrameDuration(duration)) return;
    executeOnActive((document) => {
        const ids = durationFrameIds(document, timelineStore.getState());
        return ids.length > 0 ? setFrameDurationCommand(document.session.doc, ids, duration) : null;
    });
}

const hasDocument = () => availableDocument() !== null;

export const commands: CommandSpec[] = [
    {
        id: IDS.newFrame,
        title: "New Frame",
        shortcut: "Alt+N",
        enabled: hasDocument,
        run: () =>
            void executeOnActive(({ session }) =>
                duplicateFramesCommand(session.doc, [session.activeFrameId]),
            ),
    },
    {
        id: IDS.newEmptyFrame,
        title: "New Empty Frame",
        shortcut: "Alt+B",
        enabled: hasDocument,
        run: () =>
            void executeOnActive(({ session }) =>
                addFrameCommand(session.doc, session.activeFrameId),
            ),
    },
    {
        id: IDS.deleteFrame,
        title: "Delete Frame",
        enabled: () => {
            const document = availableDocument();
            return !!document && targetFrames(document).length < document.session.doc.frames.length;
        },
        run: deleteFrames,
    },
    {
        id: IDS.firstFrame,
        title: "First Frame",
        shortcut: "Home",
        context: "timeline",
        enabled: () => frameAt("first") !== null,
        run: () => goTo("first"),
    },
    {
        id: IDS.previousFrame,
        title: "Previous Frame",
        shortcut: "ArrowLeft",
        context: "timeline",
        enabled: () => frameAt(-1) !== null,
        run: () => goTo(-1),
    },
    {
        id: IDS.nextFrame,
        title: "Next Frame",
        shortcut: "ArrowRight",
        context: "timeline",
        enabled: () => frameAt(1) !== null,
        run: () => goTo(1),
    },
    {
        id: IDS.lastFrame,
        title: "Last Frame",
        shortcut: "End",
        context: "timeline",
        enabled: () => frameAt("last") !== null,
        run: () => goTo("last"),
    },
    {
        id: IDS.previousFrameOnCanvas,
        title: "Previous Frame (Canvas)",
        shortcut: "ArrowLeft",
        context: "canvas",
        enabled: () => frameOnCanvas(-1) !== null,
        run: () => {
            const frameId = frameOnCanvas(-1);
            if (frameId !== null) activateCel({ frameId });
        },
    },
    {
        id: IDS.nextFrameOnCanvas,
        title: "Next Frame (Canvas)",
        shortcut: "ArrowRight",
        context: "canvas",
        enabled: () => frameOnCanvas(1) !== null,
        run: () => {
            const frameId = frameOnCanvas(1);
            if (frameId !== null) activateCel({ frameId });
        },
    },
    {
        id: IDS.setDuration,
        title: "Apply Frame Duration",
        enabled: () => timelineStore.getState().duration !== null && hasDocument(),
        run: setDuration,
    },
];
