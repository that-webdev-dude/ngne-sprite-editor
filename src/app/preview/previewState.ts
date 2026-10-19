import { createStore } from "zustand/vanilla";

// What the preview panel shows and plays (SPEC §6.5, DESIGN §5.5): the user's choices, kept
// for the page and not saved (they change no document), and what the preview connection
// (`previewController.ts`) reports.

/** The key of "All frames": every frame of the document in order, looping. Not an atlas ID. */
export const ALL_FRAMES = "*";

/** The speeds offered, as in editor playback (SPEC §7.5). */
export const PREVIEW_SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3, 4] as const;

/** The backgrounds the chip cycles through, in order (DESIGN §5.5), as 0xRRGGBB. */
export const PREVIEW_BACKGROUNDS = [
    { id: "dark", label: "Dark", colour: 0x202020 },
    { id: "light", label: "Light", colour: 0xe0e0e0 },
    { id: "mid", label: "Mid grey", colour: 0x808080 },
] as const;

export type PreviewBackground = (typeof PREVIEW_BACKGROUNDS)[number]["id"];

/** What the panel shows in place of the canvas, or that it shows the canvas. */
export type PreviewStatus =
    /** No document is open. */
    | { kind: "none" }
    /** The first atlas of the document is being packed. */
    | { kind: "packing" }
    | { kind: "ready" }
    /** The atlas, and the selected animation alone, are too large (SPEC §6.5). */
    | { kind: "too-large"; message: string }
    /** The document cannot be exported: the message of `ExportError` or `PackError`. */
    | { kind: "error"; message: string };

export interface PreviewState {
    /** The animation chosen: an animation ID, `ALL_FRAMES`, or null for the first one. */
    chosen: string | null;
    playing: boolean;
    speed: number;
    background: PreviewBackground;
    /** Set by the connection: the animation IDs of the active document's export. */
    animations: readonly string[];
    status: PreviewStatus;
    /** Set by the connection: a pack of the atlas waits for quiet or runs in the worker. */
    packing: boolean;
    /** Set by the connection: each distinct NGNE diagnostic of the panel's game, oldest first. */
    diagnostics: readonly string[];
}

export function createPreviewState() {
    return createStore<PreviewState>(() => ({
        chosen: null,
        playing: true,
        speed: 1,
        background: "dark",
        animations: [],
        status: { kind: "none" },
        packing: false,
        diagnostics: [],
    }));
}

/** The preview's state for the page. */
export const previewState = createPreviewState();

/**
 * The key the preview plays: the chosen animation while the document has it, "All frames"
 * when chosen, otherwise the first animation, or "All frames" when there is none.
 */
export function playedAnimation(state: Pick<PreviewState, "chosen" | "animations">): string {
    const { chosen, animations } = state;
    if (chosen === ALL_FRAMES) return ALL_FRAMES;
    if (chosen !== null && animations.includes(chosen)) return chosen;
    return animations[0] ?? ALL_FRAMES;
}

/** The background's colour. */
export function backgroundColour(background: PreviewBackground): number {
    return PREVIEW_BACKGROUNDS.find((entry) => entry.id === background)?.colour ?? 0x202020;
}

/** The background after `background` on the chip. */
export function nextBackground(background: PreviewBackground): PreviewBackground {
    const at = PREVIEW_BACKGROUNDS.findIndex((entry) => entry.id === background);
    return PREVIEW_BACKGROUNDS[(at + 1) % PREVIEW_BACKGROUNDS.length].id;
}
