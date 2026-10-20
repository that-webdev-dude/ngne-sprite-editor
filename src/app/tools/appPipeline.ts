import { setKeyContext } from "../keymap/contextState";
import { stopPlaybackForEdit } from "../playback/playbackState";
import { activeComposites } from "../state/composites";
import { editorStore } from "../state/editor";
import { sessionsStore } from "../state/sessions";
import { statusStore } from "../state/status";
import { grabAxis } from "../symmetry/axisDrag";
import type { ViewMapping } from "../view/coordinates";
import { viewportLink } from "../viewport/viewportLink";
import { toolState } from "./activeTool";
import { VIEW_TOOLS } from "./viewTools";
import { createToolPipeline } from "./pipeline";
import type { ToolPipeline } from "./pipeline";
import { strokeEcho } from "./strokeEcho";

/** Where the pointer pipeline of the app reads the mapping of the image on screen. */
let mappingSource: (() => ViewMapping | null) | null = null;

/**
 * The pointer pipeline of the app (SE-014), on the app's stores, composites and viewport. The
 * overlay on the page connects it to the pointer (`attachToolPointer`); `tools.commands.ts`
 * cancels its stroke on Escape.
 */
export const toolPipeline: ToolPipeline = createToolPipeline({
    sessions: sessionsStore,
    composites: activeComposites,
    viewport: viewportLink,
    status: statusStore,
    editor: editorStore,
    tools: toolState,
    mapping: () => mappingSource?.() ?? null,
    nextFrame(callback) {
        const request = requestAnimationFrame(() => callback());
        return () => cancelAnimationFrame(request);
    },
    echo: strokeEcho,
    later(callback, ms) {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
    },
    // While a gesture is open, Enter closes it (SPEC §7.8, `gesture.commands.ts`).
    gesture: (open) => setKeyContext("gesture", open),
    // Editing input stops editor playback first, on the frame on screen; the hand and the
    // zoom only move the view, and playback goes on under them (SPEC §7.5, SE-024).
    beforeStroke(tool) {
        if (!VIEW_TOOLS.has(tool.id)) stopPlaybackForEdit();
    },
    // A press on a symmetry axis's handle drags the axis, whatever the tool (SE-062).
    grab: grabAxis,
});

/**
 * Makes `source` the mapping the app's pipeline reads: the overlay's, as the image is on
 * screen. Returns the function that disconnects it, which also cancels a stroke in progress.
 */
export function connectToolMapping(source: () => ViewMapping | null): () => void {
    mappingSource = source;
    return () => {
        toolPipeline.cancel();
        if (mappingSource === source) mappingSource = null;
    };
}
