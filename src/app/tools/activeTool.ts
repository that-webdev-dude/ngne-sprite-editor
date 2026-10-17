import type { StoreApi } from "zustand/vanilla";
import { chordKey, normalizeChord } from "../commands/chord";
import { editorStore } from "../state/editor";
import type { EditorState } from "../state/editor";
import { statusStore } from "../state/status";
import type { StatusState } from "../state/status";
import { optionValues } from "./options";
import { slotOf } from "./registry";
import type { ToolRegistry } from "./registry";
import { toolRegistry } from "./toolRegistry";
import type { RailSlot, Tool, ToolOptionValue } from "./types";

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
    /**
     * The tool a tool's key switches to when it is pressed again while that tool is selected
     * (SE-031, DESIGN §5.1): the next, after it, of the variants of its rail slot whose key is
     * the same letter (M and Shift+M; after the last, the first). Null when it has none: no
     * key, or no other variant of that letter.
     */
    nextVariant(id: string): Tool | null;
    /**
     * The tool a rail slot's button shows (SE-031): the active tool when it is one of the
     * slot's, else the slot's tool selected last, else `slot.tool`.
     */
    shownInSlot(slot: RailSlot): Tool | null;
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

/** The key of a tool's chord without its modifiers ("M" for Shift+M); null without a key. */
function keyOf(tool: Tool | undefined): string | null {
    return tool?.shortcut === undefined ? null : chordKey(normalizeChord(tool.shortcut));
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

    /** The tool of each rail slot selected last, by slot id (SE-031). */
    const lastInSlot = new Map<string, string>();
    const remember = (id: string) => {
        const tool = registry.get(id);
        if (tool) lastInSlot.set(slotOf(tool), id);
    };
    remember(selectedId());

    let tracked: { tool: string; options: EditorState["toolOptions"] } = {
        tool: editor.getState().tool,
        options: editor.getState().toolOptions,
    };
    // The colours of the editor store are not the tool state's: only tool changes are passed on.
    editor.subscribe((state) => {
        if (state.tool === tracked.tool && state.toolOptions === tracked.options) return;
        if (state.tool !== tracked.tool) remember(state.tool);
        tracked = { tool: state.tool, options: state.toolOptions };
        changed();
    });
    registry.subscribe(() => {
        // A tool selected before it was registered counts once it is.
        remember(selectedId());
        changed();
    });

    const select = (id: string) => {
        if (!registry.get(id)) return false;
        editor.getState().setTool(id);
        return true;
    };

    return {
        registry,
        selectedId,
        selected: () => registry.get(selectedId()) ?? null,
        activeId,
        active: () => registry.get(activeId()) ?? null,
        held: () => held,
        select,
        nextVariant(id) {
            const tool = registry.get(id);
            const letter = keyOf(tool);
            if (!tool || letter === null) return null;
            const slot = registry.railSlots().find((entry) => entry.id === slotOf(tool));
            const group = (slot?.variants ?? []).filter((variant) => keyOf(variant) === letter);
            const index = group.indexOf(tool);
            if (index < 0 || group.length < 2) return null;
            return group[(index + 1) % group.length] ?? null;
        },
        shownInSlot(slot) {
            const active = registry.get(activeId());
            if (active && slot.variants.includes(active)) return active;
            const last = lastInSlot.get(slot.id);
            const remembered = slot.variants.find((variant) => variant.id === last);
            return remembered ?? slot.tool;
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
