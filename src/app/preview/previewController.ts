import type { StoreApi } from "zustand/vanilla";
import { layerStack, sameStack } from "../../core/composite";
import type { LayerStack } from "../../core/composite";
import { animationIds, exportName } from "../../core/export";
import type { DocSession, ExportSettings, SpriteDoc, Tag } from "../../core/model";
import type { PreviewPort } from "../../engine/NgnePreview";
import type { ActiveComposites } from "../state/composites";
import { activeDocument } from "../state/sessions";
import type { SessionsState } from "../state/sessions";
import type { PackBatch, PackFrame, PackRequest, PackResponse } from "./previewPack";
import { ALL_FRAMES, backgroundColour, playedAnimation } from "./previewState";
import type { PreviewState, PreviewStatus } from "./previewState";

// The wiring of SE-054 between the stores and the preview (SPEC §6.5):
//
//   composite cache notification (touched) → frames marked changed → 150 ms of quiet
//     → their composites copied and sent to the packing worker → atlas + metadata
//     → `PreviewPort.setAtlas` (the engine uploads it, and draws from it once uploaded)
//
// The preview learns of changed pixels from the cache's notifications only, never from a
// buffer's identity: the frame being stroked is one buffer rewritten in place (SPEC §5.3). A
// composite is copied when it is read, since it travels to the worker. Nothing here waits for
// an idle history: a floating selection's pixels are in its cel's image and so in the
// composite, which is what the preview shows; it applies no float.
//
// Composites are made on the main thread, so a pack reads them in slices of at most
// `PACK_SLICE_MS`, one task each, and sends each slice to the worker as a batch; the request
// that packs goes with the last slice. A structure step that leaves every frame's layer stack
// as it was (tags, durations) keeps what the worker holds.

/** Quiet after the last edit before the atlas is packed again (SPEC §6.5). */
export const PACK_QUIET_MS = 150;

/** Longest stretch of compositing in one task; the next frames wait for another task. */
export const PACK_SLICE_MS = 8;

/** What packs the preview's atlas: the worker of `previewPacker.ts`, or a stand-in in tests. */
export interface PreviewPacker {
    /** Composites for the worker to keep until the next request; nothing is answered. */
    send(batch: PackBatch): void;
    pack(request: PackRequest): Promise<PackResponse>;
    dispose(): void;
}

/** Whether the page is shown: the game stops while the tab is hidden. */
export interface PageVisibility {
    visible(): boolean;
    /** Returns the function that stops the listener. */
    subscribe(listener: () => void): () => void;
}

export interface PreviewSources {
    sessions: StoreApi<SessionsState>;
    composites: Pick<ActiveComposites, "cacheOf" | "subscribe">;
    state: StoreApi<PreviewState>;
    packer: PreviewPacker;
    visibility: PageVisibility;
    /** `setTimeout` unless given. */
    setTimer?(callback: () => void, ms: number): unknown;
    clearTimer?(handle: unknown): void;
    /** `performance.now` unless given: the clock of the slices. */
    now?(): number;
}

export interface PreviewConnection {
    /** Stops following the stores and ends the packer. The port is not disposed. */
    dispose(): void;
}

/** The animation IDs of a document's whole export (SPEC §9.3), in order. */
export function exportAnimations(doc: Pick<SpriteDoc, "name" | "tags" | "frames">): string[] {
    if (doc.tags.length > 0) return animationIds(doc).map((animation) => animation.id);
    return doc.frames.length > 1 ? [exportName(doc.name)] : [];
}

/** The tag whose animation is `key`, for the one-tag fallback of SPEC §6.5; null for none. */
export function fallbackTag(doc: Pick<SpriteDoc, "tags">, key: string): string | null {
    if (key === ALL_FRAMES || doc.tags.length === 0) return null;
    const index = animationIds(doc).findIndex((animation) => animation.id === key);
    return index === -1 ? null : (doc.tags[index]?.id ?? null);
}

/** What of a document goes into its atlas besides the pixels and the export settings. */
interface Shape {
    name: string;
    pivotX: number;
    pivotY: number;
    /** Frame IDs and durations, in turn. */
    frames: (string | number)[];
    tags: Tag[];
}

function shapeOf(doc: SpriteDoc): Shape {
    return {
        name: doc.name,
        pivotX: doc.pivot.x,
        pivotY: doc.pivot.y,
        frames: doc.frames.flatMap((frame) => [frame.id, frame.durationMs]),
        tags: doc.tags.map((tag) => ({ ...tag })),
    };
}

/** True when `doc` still has `shape`. Compares field by field and allocates nothing. */
function hasShape(doc: SpriteDoc, shape: Shape): boolean {
    if (doc.name !== shape.name || doc.pivot.x !== shape.pivotX || doc.pivot.y !== shape.pivotY) {
        return false;
    }
    if (doc.frames.length * 2 !== shape.frames.length || doc.tags.length !== shape.tags.length) {
        return false;
    }
    for (let index = 0; index < doc.frames.length; index++) {
        const frame = doc.frames[index];
        if (frame.id !== shape.frames[index * 2]) return false;
        if (frame.durationMs !== shape.frames[index * 2 + 1]) return false;
    }
    return doc.tags.every((tag, index) => sameValue(tag, shape.tags[index]));
}

/** Deep equality of plain data: the export settings, a tag. */
function sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
        if (!Object.hasOwn(b, key)) return false;
        const left = (a as Record<string, unknown>)[key];
        const right = (b as Record<string, unknown>)[key];
        if (!sameValue(left, right)) return false;
    }
    return true;
}

function messageOf(error: unknown): string {
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** A pack whose composites are being read, a slice per task. */
interface Job {
    generation: number;
    /** The frames to composite and send, in order. */
    ids: string[];
    /** The index in `ids` of the next frame to read. */
    next: number;
    /** The first message of the pack tells the worker to forget what it kept. */
    reset: boolean;
    fallback: string | null;
    /** The task of the next slice; null while none waits. */
    timer: unknown;
}

/**
 * Keeps `port` in step with the active document: its size, its atlas packed in the worker
 * after every change, and the choices of the panel. The port runs while a document is open,
 * the page is visible and the document can be previewed; the caller stops it otherwise by
 * disposing the connection.
 */
export function connectPreview(port: PreviewPort, sources: PreviewSources): PreviewConnection {
    const { sessions, composites, state, packer, visibility } = sources;
    const setTimer = sources.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    const clearTimer =
        sources.clearTimer ??
        ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout> | undefined));
    const now = sources.now ?? (() => performance.now());

    /** The session whose document the preview shows. */
    let shown: DocSession | null = null;
    /** False until the first `follow`, which resets the panel's state, document or none. */
    let followed = false;
    /** Raised with each document shown; a response of an earlier one is ignored. */
    let generation = 0;
    /** The generation the worker's composites are of. */
    let workerGeneration = -1;
    /** Frames whose composites the worker holds as they are now. */
    let sent = new Set<string>();
    /** The frame IDs in order at the last pack. */
    let sentOrder: string[] = [];
    /** The layer stack of each frame at the last pack that sent its composite. */
    const stacks = new Map<string, LayerStack>();
    /** Frames whose composites changed since they were sent. */
    const changed = new Set<string>();
    let allChanged = true;
    /** What the atlas was packed with besides pixels, compared after each change. */
    let shape: Shape | null = null;
    let settings: ExportSettings | null = null;
    /** `history.position` and the view of the active document at the last `follow`. */
    let position = -1;
    let view: unknown = null;
    let timer: unknown = null;
    let job: Job | null = null;
    let inFlight = false;
    let packAgain = false;
    let requestId = 0;
    /** What the last request asked for when the whole atlas is too large. */
    let lastFallback: string | null = null;
    /** Whether the atlas shown holds every animation; false while it holds one tag or none. */
    let whole = false;
    let disposed = false;

    const setStatus = (status: PreviewStatus) => {
        state.setState({ status });
        applyRunning();
    };

    const applyRunning = () => {
        const { kind } = state.getState().status;
        port.setRunning(
            !disposed &&
                shown !== null &&
                visibility.visible() &&
                (kind === "packing" || kind === "ready"),
        );
    };

    /** Publishes whether a pack waits or runs (`PreviewState.packing`). */
    const showPacking = () => {
        const packing = !disposed && (timer !== null || job !== null || inFlight || packAgain);
        if (state.getState().packing !== packing) state.setState({ packing });
    };

    const schedule = (ms: number) => {
        if (timer !== null) clearTimer(timer);
        timer = setTimer(() => {
            timer = null;
            pack();
            showPacking();
        }, ms);
        showPacking();
    };

    /**
     * An edit: the atlas is packed after `PACK_QUIET_MS` without another. The first pack of a
     * document shown is not put off: it takes the edit in as well.
     */
    const scheduleEdit = () => {
        if (workerGeneration !== generation && timer !== null) return;
        schedule(PACK_QUIET_MS);
    };

    const updateAnimations = (doc: SpriteDoc) => {
        const animations = exportAnimations(doc);
        if (!sameList(animations, state.getState().animations)) state.setState({ animations });
    };

    /** Ends the pack whose composites are being read; its frames are sent again later. */
    const cancelJob = () => {
        if (!job) return;
        if (job.timer !== null) clearTimer(job.timer);
        job = null;
        allChanged = true;
    };

    /** A composite that cannot be made (out of memory): shown as the panel's message. */
    const fail = (error: unknown) => {
        cancelJob();
        port.setAtlas(null);
        whole = false;
        setStatus({ kind: "error", message: messageOf(error) });
        showPacking();
    };

    const pack = () => {
        const session = shown;
        if (disposed || !session) return;
        if (inFlight || job) {
            packAgain = true;
            return;
        }
        if (!composites.cacheOf(session)) return;
        const { doc } = session;
        const reset = workerGeneration !== generation;
        const every = reset || allChanged;
        // Before anything is composited: a pack that fails does not ask for another.
        const fallback = fallbackTag(doc, playedAnimation(state.getState()));
        lastFallback = fallback;
        const ids: string[] = [];
        try {
            if (every) stacks.clear();
            for (const frame of doc.frames) {
                if (every || changed.has(frame.id) || !sent.has(frame.id)) {
                    ids.push(frame.id);
                    stacks.set(frame.id, layerStack(doc, frame.id));
                }
            }
        } catch (error) {
            fail(error);
            return;
        }
        sentOrder = doc.frames.map((frame) => frame.id);
        sent = new Set(sentOrder);
        changed.clear();
        allChanged = false;
        job = { generation, ids, next: 0, reset, fallback, timer: null };
        slice();
    };

    /**
     * Reads the next composites of the pack for at most `PACK_SLICE_MS`, each copied (the
     * cache's buffer of a frame being stroked is rewritten in place). When frames are left
     * over, those read go to the worker as a batch and the rest waits for the next task; the
     * last slice goes with the request.
     */
    const slice = () => {
        const current = job;
        if (!current) return;
        current.timer = null;
        const session = shown;
        const cache = session ? composites.cacheOf(session) : null;
        if (disposed || !session || !cache || current.generation !== generation) {
            cancelJob();
            showPacking();
            return;
        }
        const started = now();
        const frames: PackFrame[] = [];
        try {
            while (current.next < current.ids.length) {
                const frameId = current.ids[current.next++];
                frames.push({ id: frameId, data: cache.get(frameId).data.slice() });
                if (current.next < current.ids.length && now() - started >= PACK_SLICE_MS) break;
            }
        } catch (error) {
            fail(error);
            return;
        }
        const { reset } = current;
        current.reset = false;
        workerGeneration = generation;
        if (current.next < current.ids.length) {
            packer.send({ kind: "frames", reset, frames });
            current.timer = setTimer(slice, 0);
            return;
        }
        job = null;
        request(session.doc, reset, current.fallback, frames);
    };

    const request = (
        doc: SpriteDoc,
        reset: boolean,
        fallback: string | null,
        frames: PackFrame[],
    ) => {
        const request: PackRequest = {
            id: ++requestId,
            reset,
            doc: {
                name: doc.name,
                width: doc.width,
                height: doc.height,
                frames: doc.frames.map((frame) => ({ ...frame })),
                tags: doc.tags.map((tag) => ({ ...tag })),
                pivot: { ...doc.pivot },
            },
            settings: structuredClone(doc.exportSettings),
            fallbackTagId: fallback,
            frames,
        };
        const sentIn = generation;
        inFlight = true;
        packer.pack(request).then(
            (response) => {
                inFlight = false;
                if (!disposed && sentIn === generation) apply(response);
                if (packAgain) {
                    packAgain = false;
                    pack();
                }
                showPacking();
            },
            (error: unknown) => {
                inFlight = false;
                if (disposed) return;
                // The worker is gone (it could not load, or failed): nothing to pack with.
                if (sentIn === generation) {
                    port.setAtlas(null);
                    whole = false;
                    setStatus({ kind: "error", message: messageOf(error) });
                }
                showPacking();
            },
        );
    };

    /**
     * After a structure step: true when the frames are those of the last pack, in its order,
     * and each one's layer stack is the one it was composited from (a change of tags or of
     * durations). The worker's composites then stay valid.
     */
    const compositesKept = (doc: SpriteDoc): boolean => {
        if (doc.frames.length !== sentOrder.length) return false;
        try {
            return doc.frames.every((frame, index) => {
                const kept = stacks.get(frame.id);
                return (
                    frame.id === sentOrder[index] &&
                    kept !== undefined &&
                    sameStack(kept, layerStack(doc, frame.id))
                );
            });
        } catch {
            return false;
        }
    };

    const apply = (response: PackResponse) => {
        if (response.kind === "packed") {
            const { meta, allFrames, atlas } = response;
            const animations = allFrames
                ? { ...meta.animations, [ALL_FRAMES]: allFrames }
                : meta.animations;
            port.setAtlas({
                pixels: atlas,
                sheet: { width: meta.width, height: meta.height, frames: meta.frames, animations },
            });
            whole = response.scope === "all";
            setStatus({ kind: "ready" });
            return;
        }
        port.setAtlas(null);
        whole = false;
        const kind = response.kind === "too-large" ? "too-large" : "error";
        setStatus({ kind, message: response.message });
    };

    /**
     * Follows the sessions store, and each history step (`force`). A change of the view alone
     * (pan, zoom) is not compared: the history position and the export settings are as they
     * were. Any other change, such as a field set outside the history (`touch`, editor
     * playback), is compared field by field, without building anything.
     */
    const follow = (force = false) => {
        const document = activeDocument(sessions.getState());
        const session = document?.session ?? null;
        if (!followed || session !== shown) {
            followed = true;
            shown = session;
            generation++;
            cancelJob();
            sent = new Set();
            sentOrder = [];
            stacks.clear();
            changed.clear();
            allChanged = true;
            whole = false;
            port.setAtlas(null);
            if (timer !== null) clearTimer(timer);
            timer = null;
            if (!document || !session) {
                shape = null;
                settings = null;
                port.setSize(null);
                state.setState({ animations: [] });
                setStatus({ kind: "none" });
                showPacking();
                return;
            }
            const { doc } = session;
            shape = shapeOf(doc);
            settings = structuredClone(doc.exportSettings);
            position = document.history.position;
            view = document.view;
            port.setSize({ width: doc.width, height: doc.height });
            updateAnimations(doc);
            setStatus({ kind: "packing" });
            // A document just shown is packed at once; edits wait for quiet.
            schedule(0);
            return;
        }
        if (!document || !session) return;
        const { doc } = session;
        port.setSize({ width: doc.width, height: doc.height });
        const viewOnly = !force && document.history.position === position && document.view !== view;
        position = document.history.position;
        view = document.view;
        const sameSettings = sameValue(doc.exportSettings, settings);
        if (viewOnly && sameSettings) return;
        if (sameSettings && shape && hasShape(doc, shape)) return;
        shape = shapeOf(doc);
        if (!sameSettings) settings = structuredClone(doc.exportSettings);
        updateAnimations(doc);
        scheduleEdit();
    };

    const followState = () => {
        const current = state.getState();
        const key = playedAnimation(current);
        port.setAnimation(key);
        port.setPlaying(current.playing);
        port.setSpeed(current.speed);
        port.setBackground(backgroundColour(current.background));
        // Only the selected animation is packed while the whole atlas is too large: another
        // selection is packed at once.
        if (shown && !whole && current.status.kind !== "packing") {
            if (fallbackTag(shown.doc, key) !== lastFallback) schedule(0);
        }
    };

    const stopComposites = composites.subscribe((touched, session) => {
        if (session !== shown) return;
        if (touched.structure && !compositesKept(session.doc)) {
            allChanged = true;
            // The frames being read may be gone: the pack starts over after the quiet.
            cancelJob();
        } else {
            for (const frameId of touched.frameIds) changed.add(frameId);
        }
        // Tags and durations change without pixels; they reach the atlas too.
        follow(true);
        scheduleEdit();
    });
    const stopSessions = sessions.subscribe(() => follow());
    const stopState = state.subscribe(followState);
    const stopVisibility = visibility.subscribe(applyRunning);
    follow();
    followState();
    applyRunning();

    return {
        dispose() {
            if (disposed) return;
            disposed = true;
            stopComposites();
            stopSessions();
            stopState();
            stopVisibility();
            if (timer !== null) clearTimer(timer);
            timer = null;
            cancelJob();
            packer.dispose();
            showPacking();
            port.setRunning(false);
        },
    };
}
