import { activeComposites } from "../state/composites";
import { editorStore } from "../state/editor";
import { sessionsStore } from "../state/sessions";
import { statusStore } from "../state/status";
import type { ViewMapping } from "../view/coordinates";
import { viewportLink } from "../viewport/viewportLink";
import { toolState } from "./activeTool";
import { createToolPipeline } from "./pipeline";
import type { ToolPipeline } from "./pipeline";

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
    later(callback, ms) {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
    },
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
