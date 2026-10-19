import { createStore } from "zustand/vanilla";
import type { DocSession } from "../../core/model";

// What editor playback is doing (SPEC §7.5, SE-024), as the rest of the app reads it: the
// viewport wiring, the transport and the commands' titles. `playback.ts` runs it and is the
// only writer.

/** The speeds of the Frame menu, from 0.25× to 4× (SPEC §7.5). */
export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3, 4] as const;

export interface PlaybackState {
    /** True from Play until playback stops. */
    playing: boolean;
    /** The session that plays; null while nothing plays. */
    session: DocSession | null;
    /**
     * The frames of the playing range, each once, in the order they first play; empty while
     * nothing plays. One array per playback.
     */
    frameIds: readonly string[];
    /** Speed factor, one of `PLAYBACK_SPEEDS`. Kept for the page, not saved. */
    speed: number;
}

export const playbackStore = createStore<PlaybackState>(() => ({
    playing: false,
    session: null,
    frameIds: [],
    speed: 1,
}));

/** What stops the app's playback on the frame on screen; set by `playback.ts`. */
let stopForEdit: (() => void) | null = null;

/** Sets what `stopPlaybackForEdit` calls. Used by `playback.ts`. */
export function setPlaybackStopper(stop: (() => void) | null): void {
    stopForEdit = stop;
}

/**
 * Stops editor playback, if it plays, on the frame on screen, which becomes the active one:
 * what an editing input calls before it acts (SPEC §7.5, SE-024), so it acts on the frame the
 * user sees. The tool pipeline calls it at a press that begins a stroke, and `applyFloating`,
 * which every command that changes the document calls first, does too. This module stays
 * light, so those callers do not load playback itself.
 */
export function stopPlaybackForEdit(): void {
    stopForEdit?.();
}
