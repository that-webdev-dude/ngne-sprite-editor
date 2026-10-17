import { normalizeChord } from "../commands/chord";
import type { CommandSpec } from "../commands/types";
import { isNativeKeyChord } from "../keymap/keyClasses";
import { viewSurface } from "../view/viewNavigation";
import { toolState } from "./activeTool";
import { toolPipeline } from "./appPipeline";
import { toolRegistry } from "./toolRegistry";
import type { Tool } from "./types";

// The keys of the tools (SPEC §7.8, SE-014), made from the tool registry so that a tool's own
// module brings its key: each registered tool has a command that selects it, bound to its key
// in the `canvas` context, and one that makes it the active tool while its hold key is down
// (Space → hand; Alt → eyedropper from SE-016). Escape cancels the stroke in progress. A tool
// whose rail slot has a variant with a key of the same letter also has a command on its key
// that selects that variant while the tool is selected (SE-031); the two are enabled in turn,
// so the select command selects exactly its tool, from the key, the palette or a menu.
//
// A held key acts where the keymap gives it to the `canvas` context (SPEC §7.8). A key that
// controls consume natively (Space) gets there only while the viewport element itself has the
// focus, so its hold acts only then; anywhere else — the command palette among them — that
// hold command is listed but inert. Any other key (Alt) acts throughout the `canvas` context,
// whatever control has the focus (SE-016). The command palette runs such a hold and releases
// it at once, as for a key pressed and let go (`runPaletteCommand`), which leaves the active
// tool as it was. No hold acts while a gesture of several presses is open (the curve, the
// polygon, the polygon lasso; SE-065 review): it would change the active tool, which cancels
// the gesture. The wheel and the middle button still pan then.

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

/** The command of `tool`'s key pressed again: "tool.marquee.next". */
export function nextVariantCommandId(tool: Pick<Tool, "id">): string {
    return `tool.${tool.id}.next`;
}

/** Whether `tool`'s key pressed now switches its rail slot's variant (SE-031). */
function switches(tool: Tool): boolean {
    return toolState.selectedId() === tool.id && toolState.nextVariant(tool.id) !== null;
}

function selectCommand(tool: Tool): CommandSpec {
    return {
        id: selectCommandId(tool),
        title: `${tool.label} Tool`,
        shortcut: tool.shortcut,
        context: "canvas",
        // Exactly this tool. While its key switches the variant instead, the command of
        // that takes the key, and this one is inert (the palette lists it disabled).
        enabled: () => !switches(tool),
        run: () => void toolState.select(tool.id),
    };
}

/**
 * Pressed again while its tool is selected, a tool's key selects the next variant of its rail
 * slot with a key of the same letter (DESIGN §5.1, SE-031): its own command, on the same key,
 * enabled exactly when the select command is not. Only for a tool that has such a variant.
 */
function nextVariantCommand(tool: Tool): CommandSpec[] {
    if (!tool.shortcut || toolState.nextVariant(tool.id) === null) return [];
    return [
        {
            id: nextVariantCommandId(tool),
            title: `${tool.label} Tool: Next Variant`,
            shortcut: tool.shortcut,
            context: "canvas",
            enabled: () => switches(tool),
            run() {
                const next = toolState.nextVariant(tool.id);
                if (next) toolState.select(next.id);
            },
        },
    ];
}

function holdCommand(tool: Tool): CommandSpec[] {
    const { hold } = tool;
    if (!hold) return [];
    const native = isNativeKeyChord(normalizeChord(hold.key));
    return [
        {
            id: holdCommandId(tool),
            title: `Temporary ${tool.label}`,
            shortcut: hold.key,
            context: "canvas",
            enabled: () =>
                !toolPipeline.gesture &&
                (!native || viewportFocused()) &&
                (hold.when?.(toolState.selected()) ?? true),
            run: () => toolState.hold(tool.id),
            release: () => toolState.release(tool.id),
        },
    ];
}

export const commands: CommandSpec[] = [
    ...toolRegistry
        .list()
        .flatMap((tool) => [
            selectCommand(tool),
            ...nextVariantCommand(tool),
            ...holdCommand(tool),
        ]),
    {
        id: "tool.cancel",
        title: "Cancel Stroke",
        shortcut: "Escape",
        context: "canvas",
        enabled: () => toolPipeline.stroking,
        run: () => void toolPipeline.cancel(),
    },
];
