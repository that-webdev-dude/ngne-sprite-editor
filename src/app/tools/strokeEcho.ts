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
// until an upload that contains the later change is drawn. Above `MAX_ECHO_REGIONS` regions
// they become one, their bounding rectangle with the latest version: its pixels outside every
// region have not changed since NGNE last drew them, so the echo draws them as NGNE shows
// them. The echo is drawn only while the frame NGNE drew last is the stroke's: after a frame
// switch, a new frame or a return to the stroke's frame, NGNE may still show another image
// until its next frame. A cancelled stroke clears the echo at once; after a stroke has
// ended, any other change of its frame (undo, redo, another command), another document or a
// closed one clears it at once as well. This module holds that state; the draw layer reads it.

/** Above this many regions, the regions become one: their bounding rectangle. */
export const MAX_ECHO_REGIONS = 16;

/** One rectangle of a stroke's changes and the version it was composited at. */
export interface EchoRegion {
    readonly rect: Readonly<Rect>;
    readonly version: number;
    /**
     * Set on the bounding rectangle that replaced more than `MAX_ECHO_REGIONS` regions: how
     * many composited rectangles it stands for. Absent on a region of one.
     */
    readonly merged?: number;
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
    /**
     * True while the frame the viewport drew last is the target's frame: the echo is drawn
     * only then, over the image it stands in for.
     */
    readonly showsTarget: boolean;
    /** The regions not yet on screen through NGNE, oldest first; at most `MAX_ECHO_REGIONS`. */
    regions(): readonly EchoRegion[];
    /** The composited rectangles not yet on screen through NGNE, merged ones included. */
    waiting(): number;
    /** A paint stroke began on `target`. */
    start(target: EchoTarget): void;
    /** The stroke wrote pixels it will composite: the overlay should draw again. */
    changed(): void;
    /** The stroke composited `rect` into its live buffer: echoed until an upload has it. */
    composited(rect: Rect): void;
    /** Brings the live buffer up to date with what the stroke wrote (before a draw). */
    prepare(): void;
    /**
     * The viewport drew a frame of `key` from pixels of `version`; `key` is null for a frame
     * without a frame image.
     */
    drawn(key: string | null, version: number | undefined): void;
    /** The stroke ended and its pixels were kept; later changes of its frame clear the echo. */
    release(): void;
    /** Ends the echo at once. */
    clear(): void;
    /** A change of `session`'s composites, as the composite cache reports it. */
    touched(session: DocSession, touched: Touched): void;
    /** Calls `listener` when there is something new to draw or to take away. */
    subscribe(listener: () => void): () => void;
}

/** The bounding rectangle of `rects`, of which there is at least one. */
function bounds(rects: readonly Readonly<Rect>[]): Rect {
    let x = Infinity;
    let y = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const rect of rects) {
        x = Math.min(x, rect.x);
        y = Math.min(y, rect.y);
        right = Math.max(right, rect.x + rect.width);
        bottom = Math.max(bottom, rect.y + rect.height);
    }
    return { x, y, width: right - x, height: bottom - y };
}

export function createStrokeEcho(sources: StrokeEchoSources): StrokeEcho {
    let enabled = true;
    let target: EchoTarget | null = null;
    let stroking = false;
    let regions: EchoRegion[] = [];
    /** The frame key of the frame the viewport drew last; null before one, or without one. */
    let shown: string | null = null;
    const listeners = new Set<() => void>();
    const notify = () => {
        for (const listener of [...listeners]) listener();
    };
    const showsTarget = () => target !== null && shown === frameKey(target.frameId);

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
        get showsTarget() {
            return showsTarget();
        },
        regions: () => regions,
        waiting: () => regions.reduce((sum, region) => sum + (region.merged ?? 1), 0),
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
            if (regions.length > MAX_ECHO_REGIONS) {
                // Bounded, whatever the viewport does (a renderer that never draws): kept until
                // an upload that has the latest of them is drawn.
                regions = [
                    {
                        rect: bounds(regions.map((region) => region.rect)),
                        version: Math.max(...regions.map((region) => region.version)),
                        merged: regions.reduce((sum, region) => sum + (region.merged ?? 1), 0),
                    },
                ];
            }
        },
        prepare() {
            if (stroking) target?.prepare();
        },
        drawn(key, version) {
            const before = showsTarget();
            shown = key;
            let changed = false;
            if (target && version !== undefined && key === frameKey(target.frameId)) {
                const count = regions.length;
                regions = regions.filter((region) => region.version > version);
                changed = regions.length !== count;
                if (!stroking && regions.length === 0) target = null;
            }
            // Regions to draw or to take away now that NGNE shows, or stopped showing, their frame.
            if (changed || (regions.length > 0 && showsTarget() !== before)) notify();
        },
        release() {
            stroking = false;
            if (regions.length > 0 || !target) return;
            // Nothing left to echo: the echo ends, and the overlay lets go of what it drew with.
            target = null;
            notify();
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

viewportLink.onDrawn((frame) => strokeEcho.drawn(frame?.key ?? null, frame?.version));
activeComposites.subscribe((touched, session) => strokeEcho.touched(session, touched));
sessionsStore.subscribe((state) => {
    const { target } = strokeEcho;
    if (target && activeDocument(state)?.session !== target.session) strokeEcho.clear();
});
