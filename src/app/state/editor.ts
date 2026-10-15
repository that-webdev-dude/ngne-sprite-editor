import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { hsvToRgb, packRgba, rgbToHsv, unpackRgba } from "../../core/color";
import type { Hsv } from "../../core/color";

/** Options of one tool, by option name; the tool defines the names and types (SE-014). */
export type ToolOptions = Readonly<Record<string, unknown>>;

/** The first tool of the rail (DESIGN §5.1). */
export const DEFAULT_TOOL = "pencil";
/** Opaque black and opaque white, as 0xRRGGBBAA: what "Reset Colours" restores (SE-016). */
export const DEFAULT_FOREGROUND = 0x000000ff;
export const DEFAULT_BACKGROUND = 0xffffffff;

/** The two colours of the editor: the left button paints the foreground, the right the background. */
export type ColourSlot = "foreground" | "background";

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
    /**
     * The foreground in HSV as the colour panel edits it (SE-016). Always the foreground's
     * RGB; it also keeps what the RGB loses: the hue of a grey, the hue and saturation of
     * black. Set with the colour, or exactly with `setColourHsv`.
     */
    foregroundHsv: Readonly<Hsv>;
    /** The background in HSV, as `foregroundHsv` is the foreground's. */
    backgroundHsv: Readonly<Hsv>;

    setTool(tool: string): void;
    /** Merges `options` into the options of `tool`. */
    setToolOptions(tool: string, options: ToolOptions): void;
    setForeground(colour: number): void;
    setBackground(colour: number): void;
    /** Sets the foreground or the background colour, 0xRRGGBBAA. */
    setColour(slot: ColourSlot, colour: number): void;
    /**
     * Sets a colour from HSV and an alpha 0..255: the HSV is kept exactly as given and the
     * colour is its RGB, rounded to 8 bits (the colour panel, DESIGN §5.3).
     */
    setColourHsv(slot: ColourSlot, hsv: Hsv, alpha: number): void;
    /** Exchanges the foreground and the background (X, SPEC §7.8). */
    swapColours(): void;
    /** Opaque black in the foreground, opaque white in the background (DESIGN §5.1). */
    resetColours(): void;
}

/** Keeps a colour an unsigned 32-bit integer, whatever arithmetic produced it. */
function rgba(colour: number): number {
    return colour >>> 0;
}

/** The HSV of `colour`, with what it leaves open taken from `previous`. */
function hsvOf(colour: number, previous?: Hsv): Hsv {
    const { r, g, b } = unpackRgba(colour);
    return rgbToHsv(r, g, b, previous);
}

function clampByte(value: number): number {
    return Math.min(255, Math.max(0, Math.round(value)));
}

/** `value` within 0..max; 0 for a value that is not a number. */
function clamp(value: number, max: number): number {
    return Number.isNaN(value) ? 0 : Math.min(max, Math.max(0, value));
}

/** The fields of `slot` set to `colour` and `hsv`. */
function slotPatch(slot: ColourSlot, colour: number, hsv: Hsv): Partial<EditorState> {
    return slot === "foreground"
        ? { foreground: colour, foregroundHsv: hsv }
        : { background: colour, backgroundHsv: hsv };
}

function hsvIn(state: EditorState, slot: ColourSlot): Hsv {
    return slot === "foreground" ? state.foregroundHsv : state.backgroundHsv;
}

export function createEditorStore(): StoreApi<EditorState> {
    return createStore<EditorState>((set, get) => {
        const setColour = (slot: ColourSlot, colour: number) => {
            const value = rgba(colour);
            set(slotPatch(slot, value, hsvOf(value, hsvIn(get(), slot))));
        };
        return {
            tool: DEFAULT_TOOL,
            toolOptions: {},
            foreground: DEFAULT_FOREGROUND,
            background: DEFAULT_BACKGROUND,
            foregroundHsv: hsvOf(DEFAULT_FOREGROUND),
            backgroundHsv: hsvOf(DEFAULT_BACKGROUND),

            setTool: (tool) => set({ tool }),
            setToolOptions(tool, options) {
                const { toolOptions } = get();
                set({
                    toolOptions: { ...toolOptions, [tool]: { ...toolOptions[tool], ...options } },
                });
            },
            setForeground: (colour) => setColour("foreground", colour),
            setBackground: (colour) => setColour("background", colour),
            setColour,
            setColourHsv(slot, hsv, alpha) {
                // 360° is kept as it is (the right end of the hue strip): the same red as 0°.
                const exact = { h: clamp(hsv.h, 360), s: clamp(hsv.s, 1), v: clamp(hsv.v, 1) };
                const { r, g, b } = hsvToRgb(exact.h, exact.s, exact.v);
                set(slotPatch(slot, packRgba(r, g, b, clampByte(alpha)), exact));
            },
            swapColours() {
                const { foreground, background, foregroundHsv, backgroundHsv } = get();
                set({
                    foreground: background,
                    background: foreground,
                    foregroundHsv: backgroundHsv,
                    backgroundHsv: foregroundHsv,
                });
            },
            resetColours() {
                const { foregroundHsv, backgroundHsv } = get();
                set({
                    foreground: DEFAULT_FOREGROUND,
                    background: DEFAULT_BACKGROUND,
                    foregroundHsv: hsvOf(DEFAULT_FOREGROUND, foregroundHsv),
                    backgroundHsv: hsvOf(DEFAULT_BACKGROUND, backgroundHsv),
                });
            },
        };
    });
}

/** The global editor state of the app. */
export const editorStore = createEditorStore();

export function useEditor<Slice>(selector: (state: EditorState) => Slice): Slice {
    return useStore(editorStore, selector);
}
