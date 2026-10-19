import type { StoreApi } from "zustand/vanilla";
import { animationIds, exportName } from "../../core/export";
import type { DocSession, SpriteDoc } from "../../core/model";
import type { PreviewPort } from "../../engine/NgnePreview";
import type { ActiveComposites } from "../state/composites";
import { activeDocument } from "../state/sessions";
import type { SessionsState } from "../state/sessions";
import type { PackFrame, PackRequest, PackResponse } from "./previewPack";
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

/** Quiet after the last edit before the atlas is packed again (SPEC §6.5). */
export const PACK_QUIET_MS = 150;

/** What packs the preview's atlas: the worker of `previewPacker.ts`, or a stand-in in tests. */
export interface PreviewPacker {
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

/** What of a document goes into its atlas besides the pixels, as one comparable string. */
function signatureOf(doc: SpriteDoc): string {
    return JSON.stringify([
        doc.name,
        doc.pivot,
        doc.exportSettings,
        doc.frames.map((frame) => [frame.id, frame.durationMs]),
        doc.tags,
    ]);
}

function messageOf(error: unknown): string {
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
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

    /** The session whose document the preview shows. */
    let shown: DocSession | null = null;
    /** Raised with each document shown; a response of an earlier one is ignored. */
    let generation = 0;
    /** The generation the worker's composites are of. */
    let workerGeneration = -1;
    /** Frames whose composites the worker holds as they are now. */
    let sent = new Set<string>();
    /** Frames whose composites changed since they were sent. */
    const changed = new Set<string>();
    let allChanged = true;
    let signature = "";
    let timer: unknown = null;
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
        const packing = !disposed && (timer !== null || inFlight || packAgain);
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

    const pack = () => {
        const session = shown;
        if (disposed || !session) return;
        if (inFlight) {
            packAgain = true;
            return;
        }
        const cache = composites.cacheOf(session);
        if (!cache) return;
        const { doc } = session;
        const reset = workerGeneration !== generation;
        const frames: PackFrame[] = [];
        try {
            for (const frame of doc.frames) {
                if (reset || allChanged || changed.has(frame.id) || !sent.has(frame.id)) {
                    // A copy: the cache's buffer of a frame being stroked is rewritten in place.
                    frames.push({ id: frame.id, data: cache.get(frame.id).data.slice() });
                }
            }
        } catch (error) {
            // A composite that cannot be made (out of memory): shown as the panel's message.
            port.setAtlas(null);
            whole = false;
            setStatus({ kind: "error", message: messageOf(error) });
            return;
        }
        sent = new Set(doc.frames.map((frame) => frame.id));
        changed.clear();
        allChanged = false;
        workerGeneration = generation;
        const fallback = fallbackTag(doc, playedAnimation(state.getState()));
        lastFallback = fallback;
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

    const follow = () => {
        const document = activeDocument(sessions.getState());
        const session = document?.session ?? null;
        if (session !== shown) {
            shown = session;
            generation++;
            sent = new Set();
            changed.clear();
            allChanged = true;
            whole = false;
            port.setAtlas(null);
            if (timer !== null) clearTimer(timer);
            timer = null;
            if (!session) {
                signature = "";
                port.setSize(null);
                state.setState({ animations: [] });
                setStatus({ kind: "none" });
                showPacking();
                return;
            }
            const { doc } = session;
            signature = signatureOf(doc);
            port.setSize({ width: doc.width, height: doc.height });
            updateAnimations(doc);
            setStatus({ kind: "packing" });
            // A document just shown is packed at once; edits wait for quiet.
            schedule(0);
            return;
        }
        if (!session) return;
        const { doc } = session;
        port.setSize({ width: doc.width, height: doc.height });
        const next = signatureOf(doc);
        if (next === signature) return;
        signature = next;
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
        if (touched.structure) allChanged = true;
        else for (const frameId of touched.frameIds) changed.add(frameId);
        // Tags and durations change without pixels; they reach the atlas too.
        follow();
        scheduleEdit();
    });
    const stopSessions = sessions.subscribe(follow);
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
            packer.dispose();
            showPacking();
            port.setRunning(false);
        },
    };
}
