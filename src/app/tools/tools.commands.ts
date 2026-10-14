import type { CommandSpec } from "../commands/types";
import { viewSurface } from "../view/viewNavigation";
import { toolState } from "./activeTool";
import { toolPipeline } from "./appPipeline";
import { toolRegistry } from "./toolRegistry";
import type { Tool } from "./types";

// The keys of the tools (SPEC §7.8, SE-014), made from the tool registry so that a tool's own
// module brings its key: each registered tool has a command that selects it, bound to its key
// in the `canvas` context, and one that makes it the active tool while its hold key is down
// (Space → hand; Alt → eyedropper from SE-016). Escape cancels the stroke in progress.
//
// A held key acts where it is held: over the viewport element while it has the focus. That
// is also where the keymap gives Space, a native key, to the `canvas` context (SPEC §7.8).
// Anywhere else — the command palette among them — the hold command is listed but inert:
// holding a key cannot be done from there.

/** Whether the viewport element itself has the focus. */
function viewportFocused(): boolean {
    const surface = viewSurface();
    return surface !== null && surface.ownerDocument.activeElement === surface;
}

/** The command that selects `tool`: "tool.hand". */
export function selectCommandId(tool: Pick<Tool, "id">): string {
    return `tool.${tool.id}`;
}

/** The command of `tool`'s hold key: "tool.hand.hold". */
export function holdCommandId(tool: Pick<Tool, "id">): string {
    return `tool.${tool.id}.hold`;
}

function selectCommand(tool: Tool): CommandSpec {
    return {
        id: selectCommandId(tool),
        title: `${tool.label} Tool`,
        shortcut: tool.shortcut,
        context: "canvas",
        run: () => void toolState.select(tool.id),
    };
}

function holdCommand(tool: Tool): CommandSpec[] {
    const { hold } = tool;
    if (!hold) return [];
    return [
        {
            id: holdCommandId(tool),
            title: `Temporary ${tool.label}`,
            shortcut: hold.key,
            context: "canvas",
            enabled: () => viewportFocused() && (hold.when?.(toolState.selected()) ?? true),
            run: () => toolState.hold(tool.id),
            release: () => toolState.release(tool.id),
        },
    ];
}

export const commands: CommandSpec[] = [
    ...toolRegistry.list().flatMap((tool) => [selectCommand(tool), ...holdCommand(tool)]),
    {
        id: "tool.cancel",
        title: "Cancel Stroke",
        shortcut: "Escape",
        context: "canvas",
        enabled: () => toolPipeline.stroking,
        run: () => void toolPipeline.cancel(),
    },
];
