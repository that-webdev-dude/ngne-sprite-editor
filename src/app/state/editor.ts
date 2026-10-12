import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

/** Options of one tool, by option name; the tool defines the names and types (SE-014). */
export type ToolOptions = Readonly<Record<string, unknown>>;

/** The first tool of the rail (DESIGN §5.1). */
export const DEFAULT_TOOL = "pencil";
/** Opaque black and opaque white, as 0xRRGGBBAA. */
export const DEFAULT_FOREGROUND = 0x000000ff;
export const DEFAULT_BACKGROUND = 0xffffffff;

/**
 * Editor state that belongs to no document (SPEC §5): the active tool, the options of each
 * tool, and the foreground and background colours. Not persisted and not undoable.
 */
export interface EditorState {
    /** Id of the active tool. */
    tool: string;
    /** Options the user has set, by tool id; a tool without an entry uses its defaults. */
    toolOptions: Readonly<Record<string, ToolOptions>>;
    /** Foreground colour, 0xRRGGBBAA. */
    foreground: number;
    /** Background colour, 0xRRGGBBAA. */
    background: number;

    setTool(tool: string): void;
    /** Merges `options` into the options of `tool`. */
    setToolOptions(tool: string, options: ToolOptions): void;
    setForeground(colour: number): void;
    setBackground(colour: number): void;
}

/** Keeps a colour an unsigned 32-bit integer, whatever arithmetic produced it. */
function rgba(colour: number): number {
    return colour >>> 0;
}

export function createEditorStore(): StoreApi<EditorState> {
    return createStore<EditorState>((set, get) => ({
        tool: DEFAULT_TOOL,
        toolOptions: {},
        foreground: DEFAULT_FOREGROUND,
        background: DEFAULT_BACKGROUND,

        setTool: (tool) => set({ tool }),
        setToolOptions(tool, options) {
            const { toolOptions } = get();
            set({ toolOptions: { ...toolOptions, [tool]: { ...toolOptions[tool], ...options } } });
        },
        setForeground: (colour) => set({ foreground: rgba(colour) }),
        setBackground: (colour) => set({ background: rgba(colour) }),
    }));
}

/** The global editor state of the app. */
export const editorStore = createEditorStore();

export function useEditor<Slice>(selector: (state: EditorState) => Slice): Slice {
    return useStore(editorStore, selector);
}
