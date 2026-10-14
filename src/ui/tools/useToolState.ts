import { useSyncExternalStore } from "react";
import { toolState } from "../../app/tools/activeTool";
import type { ToolState } from "../../app/tools/activeTool";

/**
 * The tool state of the app (`app/tools/activeTool`): the component renders again when the
 * active or selected tool, a held tool, an option value or the tool registry changes.
 */
export function useToolState(): ToolState {
    useSyncExternalStore(toolState.subscribe, toolState.version);
    return toolState;
}
