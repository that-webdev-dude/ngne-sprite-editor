import type { ToolStateSource } from "@ngne/editor-ui/shell";
import { toolState } from "./activeTool";
import { toolRegistry } from "./toolRegistry";
import type { ToolSpec } from "./types";

/**
 * The active-tool store as the package's tool rail and context bar read it (`AppShell`
 * `tools`). They hold the tools of the editor UI instance's registry, which the app's tool
 * catalogue (`toolRegistry.ts`) registers again from the same modules: a tool or a slot is
 * matched by its id, never by the object.
 */
export const railToolSource: ToolStateSource<ToolSpec> = {
    activeId: () => toolState.activeId(),
    shownInSlot(slot) {
        const own = toolRegistry.railSlots().find((entry) => entry.id === slot.id);
        const shown = own ? toolState.shownInSlot(own) : null;
        if (!shown) return null;
        return slot.variants.find((variant) => variant.id === shown.id) ?? slot.tool;
    },
    select: (id) => void toolState.select(id),
    options(tool) {
        const own = toolRegistry.get(tool.id);
        return own ? toolState.options(own) : {};
    },
    setOption: (tool, key, value) => {
        const own = toolRegistry.get(tool.id);
        if (own) toolState.setOption(own, key, value);
    },
    subscribe: (listener) => toolState.subscribe(listener),
    version: () => toolState.version(),
};
