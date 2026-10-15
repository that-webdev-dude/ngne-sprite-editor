import type { DocSession, PixelBuffer, Rect, Touched } from "../../core/model";
import { activeComposites } from "../state/composites";
import { activeDocument, sessionsStore } from "../state/sessions";
import { frameKey, viewportLink } from "../viewport/viewportLink";

// The overlay stroke echo of SPEC §6.6 (SE-015): what a paint stroke changes is drawn on the
// overlay in its next redraw, from the stroke's live composite, and stays there until NGNE
// has drawn an upload that contains it. NGNE's path (upload, then a frame) lags the overlay by
// a frame or two; the echo covers that lag with the same pixels.
//
//   stroke writes → live composite (`liveComposite.ts`) composites a rectangle → a region,
//   stamped with `viewportLink.nextVersion()` → overlay redraw (`strokeEcho.overlay.ts`)
//   viewport reads pixels for an upload together with `viewportLink.version` → draws a frame
//   from it → `drawn(key, version)` → every region of that version or earlier is on screen
//   through NGNE and is cleared
//
// A region whose pixels change again gets a later region of its own, so it stays echoed
// until an upload that contains the later change is drawn. A cancelled stroke clears the
// echo at once; after a stroke has ended, any other change of its frame (undo, redo, another
// command), another document or a closed one clears it at once as well. This module holds
// that state; the draw layer reads it.

/** One rectangle of a stroke's changes and the version it was composited at. */
export interface EchoRegion {
    readonly rect: Readonly<Rect>;
    readonly version: number;
}

/** The stroke whose changes are echoed. */
export interface EchoTarget {
    readonly session: DocSession;
    readonly frameId: string;
    /** The frame's live composite, which the stroke keeps up to date (`liveComposite.ts`). */
    readonly buffer: PixelBuffer;
    /** Composites what the stroke changed and has not composited yet. */
    prepare(): void;
}

export interface StrokeEchoSources {
    /** Raises the version of the pixels the viewport reads and returns it. */
    nextVersion(): number;
}

export interface StrokeEcho {
    /** Off: nothing is echoed (a development switch for the latency benchmark). */
    enabled: boolean;
    /** The stroke whose changes are echoed, while one is or its regions are. */
    readonly target: EchoTarget | null;
    /** True from `start` to `release` or `clear`. */
    readonly stroking: boolean;
    /** The regions not yet on screen through NGNE, oldest first. */
    regions(): readonly EchoRegion[];
    /** A paint stroke began on `target`. */
    start(target: EchoTarget): void;
    /** The stroke wrote pixels it will composite: the overlay should draw again. */
    changed(): void;
    /** The stroke composited `rect` into its live buffer: echoed until an upload has it. */
    composited(rect: Rect): void;
    /** Brings the live buffer up to date with what the stroke wrote (before a draw). */
    prepare(): void;
    /** The viewport drew a frame of `key` from pixels of `version`. */
    drawn(key: string, version: number | undefined): void;
    /** The stroke ended and its pixels were kept; later changes of its frame clear the echo. */
    release(): void;
    /** Ends the echo at once. */
    clear(): void;
    /** A change of `session`'s composites, as the composite cache reports it. */
    touched(session: DocSession, touched: Touched): void;
    /** Calls `listener` when there is something new to draw or to take away. */
    subscribe(listener: () => void): () => void;
}

export function createStrokeEcho(sources: StrokeEchoSources): StrokeEcho {
    let enabled = true;
    let target: EchoTarget | null = null;
    let stroking = false;
    let regions: EchoRegion[] = [];
    const listeners = new Set<() => void>();
    const notify = () => {
        for (const listener of [...listeners]) listener();
    };

    const clear = () => {
        const had = target !== null || regions.length > 0;
        target = null;
        stroking = false;
        regions = [];
        if (had) notify();
    };

    return {
        get enabled() {
            return enabled;
        },
        set enabled(value: boolean) {
            if (value === enabled) return;
            enabled = value;
            if (!value) clear();
        },
        get target() {
            return target;
        },
        get stroking() {
            return stroking;
        },
        regions: () => regions,
        start(next) {
            if (!enabled) return;
            // The regions of the stroke before stay when the new one paints the same frame:
            // its live composite has those pixels too.
            if (target?.session !== next.session || target.frameId !== next.frameId) {
                regions = [];
            }
            target = next;
            stroking = true;
        },
        changed() {
            if (stroking) notify();
        },
        composited(rect) {
            if (!stroking) return;
            regions.push({ rect: { ...rect }, version: sources.nextVersion() });
        },
        prepare() {
            if (stroking) target?.prepare();
        },
        drawn(key, version) {
            if (!target || version === undefined || key !== frameKey(target.frameId)) return;
            const before = regions.length;
            regions = regions.filter((region) => region.version > version);
            if (!stroking && regions.length === 0) target = null;
            if (regions.length !== before) notify();
        },
        release() {
            stroking = false;
            if (regions.length === 0) target = null;
        },
        clear,
        touched(session, changed) {
            if (stroking || !target || session !== target.session) return;
            if (changed.structure || changed.frameIds.includes(target.frameId)) clear();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

/** The stroke echo of the app, following the viewport, the composites and the sessions. */
export const strokeEcho: StrokeEcho = createStrokeEcho({
    nextVersion: () => viewportLink.nextVersion(),
});

viewportLink.onDrawn((frame) => {
    if (frame) strokeEcho.drawn(frame.key, frame.version);
});
activeComposites.subscribe((touched, session) => strokeEcho.touched(session, touched));
sessionsStore.subscribe((state) => {
    const { target } = strokeEcho;
    if (target && activeDocument(state)?.session !== target.session) strokeEcho.clear();
});
