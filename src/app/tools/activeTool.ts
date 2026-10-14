import type { StoreApi } from "zustand/vanilla";
import { editorStore } from "../state/editor";
import type { EditorState } from "../state/editor";
import { statusStore } from "../state/status";
import type { StatusState } from "../state/status";
import { optionValues } from "./options";
import type { ToolRegistry } from "./registry";
import { toolRegistry } from "./toolRegistry";
import type { Tool, ToolOptionValue } from "./types";

// Which tool acts (SE-014). The user selects a tool from the rail or with its key; the editor
// store keeps that choice (`EditorState.tool`). A key held for a temporary tool (Space → hand,
// Alt → eyedropper, SPEC §7.8) makes that tool the active one until it is released, and the
// selected tool acts again: the selection itself never changes. The active tool is what the
// rail marks, the context bar shows and the pointer pipeline uses.

export interface ToolState {
    readonly registry: ToolRegistry;
    /** The id of the tool the user selected; it need not be registered (yet). */
    selectedId(): string;
    /** The tool the user selected, or null while no tool has that id. */
    selected(): Tool | null;
    /** The id of the active tool: the tool of the key held last, or else the selected one. */
    activeId(): string;
    /** The active tool, or null while no tool has that id. */
    active(): Tool | null;
    /** Ids of the tools whose hold key is down, the latest last. */
    held(): readonly string[];
    /** Selects a registered tool; returns false (and changes nothing) for any other id. */
    select(id: string): boolean;
    /** Makes a registered tool the active one while its key is held. */
    hold(id: string): void;
    /** The key of a held tool came up: the tool before it acts again. */
    release(id: string): void;
    /** The values of a tool's options: the defaults, with what the user set over them. */
    options(tool: Tool): Readonly<Record<string, ToolOptionValue>>;
    /** Sets one option of a tool. */
    setOption(tool: Tool, key: string, value: ToolOptionValue): void;
    /**
     * Calls `listener` when the active or the selected tool, a hold, an option value or the
     * registry changes. Returns the function that stops it.
     */
    subscribe(listener: () => void): () => void;
    /** Changes whenever `subscribe` listeners are called; a snapshot for React. */
    version(): number;
}

/** The tool state of an editor store and a registry. The app has one: `toolState`. */
export function createToolState(editor: StoreApi<EditorState>, registry: ToolRegistry): ToolState {
    let held: readonly string[] = [];
    let version = 0;
    const listeners = new Set<() => void>();
    const changed = () => {
        version++;
        for (const listener of [...listeners]) listener();
    };

    const selectedId = () => editor.getState().tool;
    const activeId = () => held[held.length - 1] ?? selectedId();
    // Option values are made once per stored record, so React sees a stable snapshot.
    const values = new WeakMap<
        Tool,
        { stored: unknown; values: Record<string, ToolOptionValue> }
    >();

    let tracked: { tool: string; options: EditorState["toolOptions"] } = {
        tool: editor.getState().tool,
        options: editor.getState().toolOptions,
    };
    // The colours of the editor store are not the tool state's: only tool changes are passed on.
    editor.subscribe((state) => {
        if (state.tool === tracked.tool && state.toolOptions === tracked.options) return;
        tracked = { tool: state.tool, options: state.toolOptions };
        changed();
    });
    registry.subscribe(changed);

    return {
        registry,
        selectedId,
        selected: () => registry.get(selectedId()) ?? null,
        activeId,
        active: () => registry.get(activeId()) ?? null,
        held: () => held,
        select(id) {
            if (!registry.get(id)) return false;
            editor.getState().setTool(id);
            return true;
        },
        hold(id) {
            if (!registry.get(id)) return;
            held = [...held.filter((entry) => entry !== id), id];
            changed();
        },
        release(id) {
            if (!held.includes(id)) return;
            held = held.filter((entry) => entry !== id);
            changed();
        },
        options(tool) {
            const stored = editor.getState().toolOptions[tool.id];
            const known = values.get(tool);
            if (known && known.stored === stored) return known.values;
            const next = optionValues(tool.options, stored);
            values.set(tool, { stored, values: next });
            return next;
        },
        setOption(tool, key, value) {
            editor.getState().setToolOptions(tool.id, { [key]: value });
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        version: () => version,
    };
}

/**
 * Keeps the hint of the status bar on the active tool's (DESIGN §5.7): its `hint`, or none.
 * Returns the function that stops it.
 */
export function followToolHint(state: ToolState, status: StoreApi<StatusState>): () => void {
    const show = () => {
        const hint = state.active()?.hint ?? null;
        if (status.getState().hint !== hint) status.getState().setHint(hint);
    };
    show();
    return state.subscribe(show);
}

/** The tool state of the app. */
export const toolState = createToolState(editorStore, toolRegistry);

followToolHint(toolState, statusStore);
