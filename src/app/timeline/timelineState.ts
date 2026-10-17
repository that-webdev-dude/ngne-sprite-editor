import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { TimelineSelection } from "./selection";

// Editor state of the timeline panel (DESIGN §5.6, SE-022), outside any document and not
// undoable: whether the panel is shown, its selection of cels, frames or layers, and the edits
// that are open in it. The commands that change documents from it are in `*.commands.ts`
// modules of this folder; they read the values this store holds for them.

/** A layer name being edited in place (double-click, or Rename Layer). */
export interface RenameDraft {
    readonly documentId: string;
    readonly layerId: string;
    /** The text of the field. */
    readonly name: string;
}

/**
 * The duration field while it has the focus: the frames it acts on, fixed when it took the
 * focus, so what is typed there lands on them whatever is selected when it is applied.
 */
export interface DurationEdit {
    readonly documentId: string;
    readonly frameIds: readonly string[];
}

/** The layer properties popover (DESIGN §7): what it shows, applied when it closes. */
export interface PropertiesDraft {
    readonly documentId: string;
    readonly layerId: string;
    readonly name: string;
    /** 0..255. */
    readonly opacity: number;
}

export interface TimelineState {
    /** The panel is shown; Tab (viewport focused) and View → Hide Timeline toggle it. */
    visible: boolean;
    /** What the last click in the grid selected; see `effectiveSelection`. */
    selection: TimelineSelection | null;
    rename: RenameDraft | null;
    properties: PropertiesDraft | null;
    /**
     * The layer the next layer command run from a row acts on (its visibility or lock
     * button); null for the active layer. Set just before the command runs, cleared after.
     */
    layerTarget: string | null;
    /** The duration the next Apply Frame Duration sets, set by the duration field. */
    duration: number | null;
    /** The frames of the focused duration field; null while it does not have the focus. */
    durationEdit: DurationEdit | null;
}

export function initialTimelineState(): TimelineState {
    return {
        visible: true,
        selection: null,
        rename: null,
        properties: null,
        layerTarget: null,
        duration: null,
        durationEdit: null,
    };
}

export const timelineStore: StoreApi<TimelineState> =
    createStore<TimelineState>(initialTimelineState);

export function useTimelineState<Slice>(selector: (state: TimelineState) => Slice): Slice {
    return useStore(timelineStore, selector);
}

/** Shows or hides the timeline panel. */
export function setTimelineVisible(visible: boolean): void {
    if (timelineStore.getState().visible !== visible) timelineStore.setState({ visible });
}

export function setSelection(selection: TimelineSelection | null): void {
    timelineStore.setState({ selection });
}

/** Sets the text of the open in-place rename. */
export function setRenameText(name: string): void {
    const { rename } = timelineStore.getState();
    if (rename && rename.name !== name) timelineStore.setState({ rename: { ...rename, name } });
}

/** Ends the in-place rename without applying it (Escape). Changes no document. */
export function cancelRename(): void {
    if (timelineStore.getState().rename) timelineStore.setState({ rename: null });
}

/** Changes what the open layer properties popover shows; the document changes when it closes. */
export function editProperties(change: Partial<Pick<PropertiesDraft, "name" | "opacity">>): void {
    const { properties } = timelineStore.getState();
    if (properties) timelineStore.setState({ properties: { ...properties, ...change } });
}

/** Closes the layer properties popover without applying it. Changes no document. */
export function dropProperties(): void {
    if (timelineStore.getState().properties) timelineStore.setState({ properties: null });
}

/** The duration field took the focus: it acts on `edit.frameIds` until it loses it. */
export function startDurationEdit(edit: DurationEdit): void {
    timelineStore.setState({ durationEdit: edit });
}

/** The duration field lost the focus; what it held has been applied. */
export function endDurationEdit(): void {
    if (timelineStore.getState().durationEdit) timelineStore.setState({ durationEdit: null });
}

/**
 * Runs `run` with `values` set in the store, and takes them out again afterwards whatever
 * `run` did: how the panel hands a command its argument (the layer of a row, a duration).
 */
export function withArguments(
    values: Partial<Pick<TimelineState, "layerTarget" | "duration">>,
    run: () => void,
): void {
    timelineStore.setState(values);
    try {
        run();
    } finally {
        const cleared: Partial<TimelineState> = {};
        if ("layerTarget" in values) cleared.layerTarget = null;
        if ("duration" in values) cleared.duration = null;
        timelineStore.setState(cleared);
    }
}
