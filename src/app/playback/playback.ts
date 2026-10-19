import type { StoreApi } from "zustand/vanilla";
import { PlaybackClock, playbackSequence } from "../../core/animation";
import { frameIndex } from "../../core/model";
import { parseFrameKey } from "../../engine/viewport/types";
import { applyFloating } from "../selection/floating";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument, SessionsState } from "../state/sessions";
import { viewportLink } from "../viewport/viewportLink";
import type { DrawnFrame } from "../viewport/viewportLink";
import { playbackStore, setPlaybackStopper } from "./playbackState";
import type { PlaybackState } from "./playbackState";

// Editor playback (SPEC §7.5, SE-024): steps the active frame of the active document by
// elapsed visible time, through the sequence of `playbackSequence` (the active tag at the
// playhead, otherwise every frame, looping). The viewport follows the active frame; while the
// playing range fits it draws the frames from its `ed:play` grid (SPEC §6.4).
//
//   Play → float applied → clock started at the playhead → each animation frame: clock read,
//     the entry's frame made the active one → … → Pause, the end of a tag that repeats n
//     times, or an editing input → stopped
//
// Playback holds no transaction, so it disables nothing. What edits stops it:
// - a press that begins a stroke (`stop({ atDisplayed: true })` from the tool pipeline,
//   before its target is read): the frame on screen becomes the active one, and the stroke
//   paints there;
// - any step of the playing document's history (a command, undo, redo), a transaction opened
//   in it (a float lifted or pasted), the active frame moved by anything else (the timeline,
//   the frame commands), another document made the active one, the document closed.

export interface PlaybackSources {
    sessions: StoreApi<SessionsState>;
    state: StoreApi<PlaybackState>;
    /** The time in milliseconds: `performance.now()`, or a test's controlled clock. */
    now(): number;
    /** Calls `callback` at the next animation frame; returns the function that cancels it. */
    nextFrame(callback: () => void): () => void;
    /** Whether the page is visible: time while it is hidden does not count. */
    visible(): boolean;
    /** Calls `listener` when the page's visibility changes; returns its remover. */
    onVisibilityChange(listener: () => void): () => void;
    /** Calls `listener` after each frame the viewport submits; returns its remover. */
    onDrawn(listener: (frame: DrawnFrame | null) => void): () => void;
    /** Applies a floating selection (SPEC §5.2); throws when it cannot be applied. */
    applyFloating(): void;
}

export interface StopOptions {
    /**
     * Makes the frame on screen the active one: an editing input acts on the frame the user
     * sees, which the viewport draws an animation frame after the active frame changed.
     */
    atDisplayed?: boolean;
}

export interface EditorPlayback {
    readonly playing: boolean;
    /** The time the last step read from `now`; null before the first. For tests. */
    readonly lastTick: number | null;
    /** Steps run since the page loaded. For tests. */
    readonly ticks: number;
    /**
     * Starts playback of the active document at its active frame, after applying a floating
     * selection. Returns whether it plays: not without a document or during a stroke.
     */
    start(): boolean;
    /** Stops playback; nothing when it is not playing. */
    stop(options?: StopOptions): void;
    /** Play / Pause: a pause stops on the frame on screen. */
    toggle(): void;
    /** Changes the speed, also while playing: from now on (SPEC §7.5). */
    setSpeed(speed: number): void;
    dispose(): void;
}

interface Run {
    readonly document: OpenDocument;
    readonly clock: PlaybackClock;
    /** The frames of the playing range. */
    readonly frameIds: ReadonlySet<string>;
    /** The active frame playback set last: a different one was set by something else. */
    expected: string;
    /** The frame on screen, as the viewport reported its last frame. */
    displayed: string;
    cancelFrame: (() => void) | null;
    stopHistory: () => void;
}

export function createPlayback(sources: PlaybackSources): EditorPlayback {
    const { sessions, state } = sources;
    let run: Run | null = null;
    let lastTick: number | null = null;
    let ticks = 0;

    /** Makes `frameId` the active frame of the playing document, as playback's own change. */
    const activate = (current: Run, frameId: string) => {
        current.expected = frameId;
        const { session } = current.document;
        if (session.activeFrameId === frameId) return;
        session.activeFrameId = frameId;
        sessions.getState().touch(current.document.id);
    };

    const stop = (options: StopOptions = {}) => {
        const ended = run;
        if (!ended) return;
        run = null;
        ended.cancelFrame?.();
        ended.stopHistory();
        const { document } = ended;
        const { session, history } = document;
        const active = activeDocument(sessions.getState());
        if (
            options.atDisplayed &&
            active?.session === session &&
            !history.transaction &&
            ended.displayed !== session.activeFrameId &&
            frameIndex(session.doc, ended.displayed) !== -1
        ) {
            session.activeFrameId = ended.displayed;
            sessions.getState().touch(document.id);
        }
        state.setState({ playing: false, session: null, frameIds: [] });
    };

    const schedule = (current: Run) => {
        if (!current.cancelFrame) current.cancelFrame = sources.nextFrame(() => tick(current));
    };

    const tick = (current: Run) => {
        current.cancelFrame = null;
        if (run !== current) return;
        const now = sources.now();
        lastTick = now;
        ticks++;
        // A transaction opened in the document (a float lifted, a paste): editing has begun.
        if (current.document.history.transaction) {
            stop();
            return;
        }
        current.clock.advance(now);
        const { frameId, ended } = current.clock.position();
        if (frameIndex(current.document.session.doc, frameId) === -1) {
            stop();
            return;
        }
        activate(current, frameId);
        if (run !== current) return;
        // A tag that repeats n times stops on its last entry.
        if (ended) stop();
        else schedule(current);
    };

    const stopSessions = sessions.subscribe((now) => {
        const current = run;
        if (!current) return;
        if (activeDocument(now)?.session !== current.document.session) stop();
        else if (current.document.session.activeFrameId !== current.expected) stop();
    });

    const stopVisibility = sources.onVisibilityChange(() => {
        const current = run;
        if (!current) return;
        const now = sources.now();
        if (sources.visible()) {
            current.clock.resume(now);
            schedule(current);
        } else {
            current.clock.pause(now);
        }
    });

    const stopDrawn = sources.onDrawn((frame) => {
        const current = run;
        if (!current || !frame) return;
        const { frameId } = parseFrameKey(frame.key);
        if (current.frameIds.has(frameId)) current.displayed = frameId;
    });

    const start = (): boolean => {
        if (run) return true;
        sources.applyFloating();
        const document = activeDocument(sessions.getState());
        if (!document || document.history.transaction) return false;
        const { session } = document;
        const sequence = playbackSequence(session.doc, session.activeFrameId);
        const now = sources.now();
        const clock = new PlaybackClock(sequence, now, state.getState().speed);
        if (!sources.visible()) clock.pause(now);
        const frameIds = [...new Set(sequence.pass.map((entry) => entry.frameId))];
        const current: Run = {
            document,
            clock,
            frameIds: new Set(frameIds),
            expected: session.activeFrameId,
            displayed: session.activeFrameId,
            cancelFrame: null,
            stopHistory: () => {},
        };
        run = current;
        current.stopHistory = document.history.subscribe(() => {
            if (run === current) stop();
        });
        state.setState({ playing: true, session, frameIds });
        // The entry it starts at: the active frame, unless a tag played once starts again.
        activate(current, clock.position().frameId);
        if (run === current) schedule(current);
        return run === current;
    };

    return {
        get playing() {
            return run !== null;
        },
        get lastTick() {
            return lastTick;
        },
        get ticks() {
            return ticks;
        },
        start,
        stop,
        toggle() {
            if (run) stop({ atDisplayed: true });
            else start();
        },
        setSpeed(speed) {
            run?.clock.setSpeed(speed, sources.now());
            state.setState({ speed });
        },
        dispose() {
            stop();
            stopSessions();
            stopVisibility();
            stopDrawn();
        },
    };
}

/**
 * The time editor playback reads. Tests replace `now` with a controlled clock (SE-024); the
 * page's own is `performance.now()`.
 */
export const playbackTime: { now: () => number } = { now: () => performance.now() };

const hasDocument = typeof document !== "undefined";

/** Editor playback of the app, on its stores, the page's animation frames and its viewport. */
export const editorPlayback: EditorPlayback = createPlayback({
    sessions: sessionsStore,
    state: playbackStore,
    now: () => playbackTime.now(),
    nextFrame(callback) {
        if (typeof requestAnimationFrame !== "function") {
            const timer = setTimeout(callback, 16);
            return () => clearTimeout(timer);
        }
        const request = requestAnimationFrame(() => callback());
        return () => cancelAnimationFrame(request);
    },
    visible: () => !hasDocument || document.visibilityState === "visible",
    onVisibilityChange(listener) {
        if (!hasDocument) return () => {};
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
    },
    onDrawn: (listener) => viewportLink.onDrawn(listener),
    applyFloating: () => applyFloating(),
});

setPlaybackStopper(() => editorPlayback.stop({ atDisplayed: true }));
