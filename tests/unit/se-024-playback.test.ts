import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu } from "../../src/app/commands/menuModel";
import type { Command } from "../../src/app/commands/types";
import { setKeyContext } from "../../src/app/keymap/contextState";
import { createPlayback, editorPlayback, playbackTime } from "../../src/app/playback/playback";
import type { PlaybackSources } from "../../src/app/playback/playback";
import { formatSpeed, speedCommandId } from "../../src/app/playback/playback.commands";
import { PLAYBACK_SPEEDS, playbackStore } from "../../src/app/playback/playbackState";
import { isFloating } from "../../src/app/selection/floating";
import { floatingState } from "../../src/app/selection/floatingState";
import { DEFAULT_TOOL, editorStore } from "../../src/app/state/editor";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { clickTimeline } from "../../src/app/timeline/timelineClicks";
import { PLAY_PAUSE_COMMAND, TIMELINE_COMMANDS } from "../../src/app/timeline/timelineCommandIds";
import { connectToolMapping, toolPipeline } from "../../src/app/tools/appPipeline";
import type { PointerInput } from "../../src/app/tools/pipeline";
import { createViewMapping } from "../../src/app/view/coordinates";
import { viewportLink } from "../../src/app/viewport/viewportLink";
import type { ViewportMount } from "../../src/app/viewport/viewportLink";
import { addFrameCommand, setFrameDurationCommand } from "../../src/core/frames";
import { celAt, celKey, createDocument } from "../../src/core/model";
import type { DocSession, Tag } from "../../src/core/model";
import { rectMask, selectCommand } from "../../src/core/selection";
import { createTagCommand } from "../../src/core/tags";
import { frameKey } from "../../src/engine/viewport/types";

// SE-024: editor playback on the app's stores (SPEC §7.5): the active frame stepped by a
// controlled clock, the end of a tag played n times, the speed, the tab hidden, and what
// stops it — Pause on the frame on screen, a stroke (before it reads its frame), a command
// (through `applyFloating`), any history step, a transaction, another frame or document.
// The animation frames run only when the test says so.

/** Animation frames that run only when the test says so. */
const frames = vi.hoisted(() => ({ next: 1, queue: new Map<number, () => void>() }));
let now = 0;
let mounted: ViewportMount | null = null;
let disconnect: (() => void) | null = null;

const VIEW = { scale: 4, originX: 0, originY: 0 };
const SIZE = 8;

beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
        const id = frames.next++;
        frames.queue.set(id, callback);
        return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => void frames.queue.delete(id));
    now = 0;
    playbackTime.now = () => now;
    mounted = viewportLink.mount({ invalidate() {} }, { width: 400, height: 300 });
    disconnect = connectToolMapping(() => {
        const document = activeDocument(sessionsStore.getState());
        if (!document) return null;
        return createViewMapping({
            view: document.view,
            docWidth: SIZE,
            docHeight: SIZE,
            ratio: 1,
            left: 0,
            top: 0,
        });
    });
});

afterEach(() => {
    editorPlayback.stop();
    toolPipeline.cancel();
    floatingState.cancel();
    disconnect?.();
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    mounted?.unmount();
    frames.queue.clear();
    playbackStore.setState({ speed: 1 });
    setKeyContext("floating", false);
    editorStore.getState().setTool(DEFAULT_TOOL);
    playbackTime.now = () => performance.now();
    vi.unstubAllGlobals();
});

/** Runs the animation frames requested so far, at time `at`. */
function frameAt(at: number): void {
    now = at;
    const queued = [...frames.queue.values()];
    frames.queue.clear();
    for (const callback of queued) callback();
}

/**
 * Opens a document of `count` frames with the given durations (100 ms by default), each
 * frame's cel painted, frame 1 active.
 */
function open(count: number, durations: readonly number[] = []): OpenDocument {
    const session: DocSession = createDocument({ name: "play", width: SIZE, height: SIZE });
    const document = sessionsStore.getState().open(session, { view: VIEW });
    for (let index = 1; index < count; index++) {
        document.history.execute(addFrameCommand(session.doc, session.activeFrameId));
    }
    session.doc.frames.forEach((frame, index) => {
        frame.durationMs = durations[index] ?? 100;
        const imageId = `image-${index}`;
        const data = new Uint8ClampedArray(SIZE * SIZE * 4).fill(index * 20 + 10);
        session.doc.images.set(imageId, { width: SIZE, height: SIZE, data });
        session.doc.cels.set(celKey(session.activeLayerId, frame.id), { imageId, opacity: 255 });
    });
    session.activeFrameId = session.doc.frames[0]!.id;
    sessionsStore.getState().touch(document.id);
    return document;
}

/** The 1-based number of the active frame. */
function activeNumber(document: OpenDocument): number {
    const { doc, activeFrameId } = document.session;
    return doc.frames.findIndex((frame) => frame.id === activeFrameId) + 1;
}

function frameId(document: OpenDocument, number: number): string {
    return document.session.doc.frames[number - 1]!.id;
}

function addTag(document: OpenDocument, from: number, to: number, fields: Partial<Tag>): void {
    const command = createTagCommand(
        document.session.doc,
        {
            name: "tag",
            color: 0xff0000ff,
            fromFrameId: frameId(document, from),
            toFrameId: frameId(document, to),
            direction: "forward",
            repeat: 0,
            ...fields,
        },
        () => `tag-${from}-${to}`,
    );
    document.history.execute(command);
}

function command(id: string): Command {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

/** The frame numbers active at each time, one animation frame per time. */
function play(document: OpenDocument, times: readonly number[]): number[] {
    return times.map((time) => {
        frameAt(time);
        return activeNumber(document);
    });
}

describe("editor playback steps the active frame by elapsed time", () => {
    it("shows each frame of an 8-frame, 100 ms animation for its interval and loops at 800 ms", () => {
        const document = open(8);
        expect(command(PLAY_PAUSE_COMMAND).enabled()).toBe(true);
        void command(PLAY_PAUSE_COMMAND).run();
        expect(playbackStore.getState()).toMatchObject({
            playing: true,
            session: document.session,
            frameIds: document.session.doc.frames.map((frame) => frame.id),
        });
        const times = [0, 99, 100, 199, 200, 350, 699, 700, 799, 800, 899, 900, 1600];
        expect(play(document, times)).toEqual([1, 1, 2, 2, 3, 4, 7, 8, 8, 1, 1, 2, 1]);
        expect(editorPlayback.lastTick).toBe(1600);
        expect(command(PLAY_PAUSE_COMMAND).title()).toBe("Pause");
    });

    it("starts at the playhead and follows mixed durations", () => {
        const document = open(4, [100, 50, 200, 10]);
        document.session.activeFrameId = frameId(document, 2);
        sessionsStore.getState().touch(document.id);
        editorPlayback.start();
        // From frame 2: 50 ms, then 200, then 10, then frame 1's 100.
        expect(play(document, [0, 49, 50, 249, 250, 259, 260, 359, 360])).toEqual([
            2, 2, 3, 3, 4, 4, 1, 1, 2,
        ]);
    });

    it("plays the active tag at the playhead, in its direction", () => {
        const document = open(6);
        addTag(document, 2, 4, { direction: "pingpong" });
        document.session.activeFrameId = frameId(document, 2);
        sessionsStore.getState().touch(document.id);
        editorPlayback.start();
        expect(play(document, [0, 100, 200, 300, 400, 500])).toEqual([2, 3, 4, 3, 2, 3]);
        expect(playbackStore.getState().frameIds).toEqual(
            [2, 3, 4].map((number) => frameId(document, number)),
        );
    });

    it("stops a tag of repeat 2 on its last entry", () => {
        const document = open(5);
        addTag(document, 2, 4, { direction: "reverse", repeat: 2 });
        document.session.activeFrameId = frameId(document, 4);
        sessionsStore.getState().touch(document.id);
        editorPlayback.start();
        // 4 3 2 4 3 2: 600 ms, ending on frame 2.
        expect(play(document, [0, 100, 200, 300, 599])).toEqual([4, 3, 2, 4, 2]);
        expect(editorPlayback.playing).toBe(true);
        frameAt(600);
        expect(editorPlayback.playing).toBe(false);
        expect(playbackStore.getState().playing).toBe(false);
        expect(activeNumber(document)).toBe(2);
        expect(frames.queue.size).toBe(0);
    });

    it("changes speed while playing, from that moment, 0.25× to 4×", () => {
        const document = open(4);
        editorPlayback.start();
        expect(play(document, [0, 50])).toEqual([1, 1]);
        now = 50;
        void command(speedCommandId(2)).run();
        expect(playbackStore.getState().speed).toBe(2);
        // 50 ms, then 25 ms at 2× = 100 ms.
        expect(play(document, [74, 75, 125])).toEqual([1, 2, 3]);
        now = 125;
        void command(speedCommandId(0.25)).run();
        expect(play(document, [524, 525])).toEqual([3, 4]);
        now = 525;
        void command(speedCommandId(4)).run();
        expect(play(document, [549, 550])).toEqual([4, 1]);
    });
});

describe("what stops editor playback", () => {
    it("Pause stops on the frame on screen, which becomes the active frame", () => {
        const document = open(8);
        editorPlayback.start();
        play(document, [0, 100, 200]);
        expect(activeNumber(document)).toBe(3);
        // The viewport has drawn frame 2 last: the step to 3 is not on screen yet.
        mounted?.drawn({ key: frameKey(frameId(document, 2)), version: 1 });
        void command(PLAY_PAUSE_COMMAND).run();
        expect(editorPlayback.playing).toBe(false);
        expect(activeNumber(document)).toBe(2);
        expect(frames.queue.size).toBe(0);
        expect(command(PLAY_PAUSE_COMMAND).title()).toBe("Play");
    });

    it("a stroke stops it before reading its frame, and paints on the frame on screen", () => {
        const document = open(8);
        editorStore.getState().setTool("pencil");
        editorPlayback.start();
        play(document, [0, 300, 400]);
        mounted?.drawn({ key: frameKey(frameId(document, 4)), version: 1 });
        expect(activeNumber(document)).toBe(5);
        const before = Array.from(celPixels(document, 4));
        toolPipeline.down(pointer(1, 1));
        expect(editorPlayback.playing).toBe(false);
        expect(activeNumber(document)).toBe(4);
        toolPipeline.up(pointer(1, 1, { buttons: 0 }));
        expect(document.history.undoLabel).toBe("Pencil");
        expect(Array.from(celPixels(document, 4))).not.toEqual(before);
        expect(Array.from(celPixels(document, 5))).toEqual(
            Array.from(new Uint8ClampedArray(SIZE * SIZE * 4).fill(4 * 20 + 10)),
        );
    });

    it("the hand and the zoom move the view and leave it playing", () => {
        const document = open(4);
        editorPlayback.start();
        for (const tool of ["hand", "zoom"]) {
            editorStore.getState().setTool(tool);
            toolPipeline.down(pointer(1, 1));
            toolPipeline.up(pointer(1, 1, { buttons: 0 }));
            expect(editorPlayback.playing, tool).toBe(true);
        }
        expect(play(document, [100])).toEqual([2]);
    });

    it("a command that changes the document stops it first, on the frame on screen", () => {
        const document = open(8);
        editorPlayback.start();
        play(document, [0, 500, 600]);
        mounted?.drawn({ key: frameKey(frameId(document, 6)), version: 1 });
        // New Frame duplicates the frame on screen (6), not the one stepped to (7).
        void command(TIMELINE_COMMANDS.newFrame).run();
        expect(editorPlayback.playing).toBe(false);
        expect(document.session.doc.frames).toHaveLength(9);
        expect(activeNumber(document)).toBe(7);
        // The copy (frame 7 now) has frame 6's pixels.
        expect(celPixels(document, 7)[0]).toBe(5 * 20 + 10);
        expect(celPixels(document, 6)[0]).toBe(5 * 20 + 10);
        expect(celPixels(document, 8)[0]).toBe(6 * 20 + 10);
    });

    it("a click in the timeline grid stops it on the frame on screen, also on the active cel", () => {
        const document = open(8);
        const { activeLayerId } = document.session;
        const plain = { shift: false, toggle: false };
        editorPlayback.start();
        play(document, [0, 100, 200]);
        mounted?.drawn({ key: frameKey(frameId(document, 2)), version: 1 });
        // A click on frame 6: stopped on frame 2 first, then frame 6 is made active.
        clickTimeline({ kind: "frames", frameId: frameId(document, 6) }, plain);
        expect(editorPlayback.playing).toBe(false);
        expect(activeNumber(document)).toBe(6);

        // From frame 6, at 200 ms on the clock.
        editorPlayback.start();
        play(document, [300]);
        expect(activeNumber(document)).toBe(7);
        mounted?.drawn({ key: frameKey(frameId(document, 7)), version: 1 });
        clickTimeline(
            { kind: "cels", cel: { layerId: activeLayerId, frameId: frameId(document, 7) } },
            plain,
        );
        expect(editorPlayback.playing).toBe(false);
        expect(activeNumber(document)).toBe(7);
    });

    it("any step of the document's history stops it", () => {
        const document = open(4);
        editorPlayback.start();
        const duration = setFrameDurationCommand(document.session.doc, [frameId(document, 2)], 300);
        if (!duration) throw new Error("no duration command");
        document.history.execute(duration);
        expect(editorPlayback.playing).toBe(false);
        editorPlayback.start();
        expect(document.history.undo()).toBe(true);
        expect(editorPlayback.playing).toBe(false);
    });

    it("a transaction opened in the document stops it at the next step", () => {
        const document = open(4);
        editorPlayback.start();
        play(document, [0, 100]);
        const transaction = document.history.begin({
            layerId: document.session.activeLayerId,
            frameId: document.session.activeFrameId,
        });
        frameAt(200);
        expect(editorPlayback.playing).toBe(false);
        expect(activeNumber(document)).toBe(2);
        transaction.abort();
    });

    it("another active frame, another document or a closed one stops it", () => {
        const document = open(4);
        editorPlayback.start();
        void command(TIMELINE_COMMANDS.lastFrame).run();
        expect(editorPlayback.playing).toBe(false);
        expect(activeNumber(document)).toBe(4);

        editorPlayback.start();
        open(3);
        expect(editorPlayback.playing).toBe(false);

        editorPlayback.start();
        const other = activeDocument(sessionsStore.getState())!;
        sessionsStore.getState().close(other.id);
        expect(editorPlayback.playing).toBe(false);
        expect(playbackStore.getState()).toMatchObject({ playing: false, session: null });
    });
});

describe("Play / Pause and the speeds as commands", () => {
    it("binds Enter in the canvas and timeline contexts and takes the Frame menu's item", () => {
        const play = command(PLAY_PAUSE_COMMAND);
        expect(play.planned).toBe(false);
        expect(play.shortcuts).toEqual(["Enter"]);
        expect([...play.contexts].sort()).toEqual(["canvas", "timeline"]);
        expect(appCommands.bindings("canvas", "Enter")).toContain(play);
        expect(appCommands.bindings("timeline", "Enter")).toContain(play);
        expect(play.menuPath).toEqual(["Frame"]);
    });

    it("offers 0.25× to 4× in Frame › Playback Speed; the speed in use is the disabled one", () => {
        open(2);
        const menu = buildMenu(appCommands.list(), ["Frame", "Playback Speed"]);
        const items = menu.flatMap((node) => (node.kind === "command" ? [node.command] : []));
        expect(items.map((item) => item.id)).toEqual(PLAYBACK_SPEEDS.map(speedCommandId));
        expect(items.map((item) => item.title())).toEqual(PLAYBACK_SPEEDS.map(formatSpeed));
        expect(PLAYBACK_SPEEDS[0]).toBe(0.25);
        expect(PLAYBACK_SPEEDS.at(-1)).toBe(4);
        expect(items.filter((item) => !item.enabled()).map((item) => item.id)).toEqual([
            speedCommandId(1),
        ]);
        void command(speedCommandId(1.5)).run();
        expect(items.filter((item) => !item.enabled()).map((item) => item.id)).toEqual([
            speedCommandId(1.5),
        ]);
        expect(command(PLAY_PAUSE_COMMAND).title()).toBe("Play at 1.5×");
        // The submenu sits in Play / Pause's group of the Frame menu.
        const frame = buildMenu(appCommands.list(), ["Frame"]);
        const at = frame.findIndex(
            (node) => node.kind === "command" && node.command.id === PLAY_PAUSE_COMMAND,
        );
        expect(frame[at + 1]).toMatchObject({ kind: "submenu", title: "Playback Speed" });
    });

    it("is disabled without a document, on one frame, and during a stroke", () => {
        const play = command(PLAY_PAUSE_COMMAND);
        expect(play.enabled()).toBe(false);
        const one = open(1);
        expect(play.enabled()).toBe(false);
        one.history.execute(addFrameCommand(one.session.doc, one.session.activeFrameId));
        expect(play.enabled()).toBe(true);
        editorStore.getState().setTool("pencil");
        toolPipeline.down(pointer(1, 1));
        expect(toolPipeline.stroking).toBe(true);
        expect(play.enabled()).toBe(false);
        toolPipeline.up(pointer(1, 1, { buttons: 0 }));
        expect(play.enabled()).toBe(true);
    });

    it("starts while a selection floats, applying it first (SPEC §5.2)", () => {
        const document = open(3);
        const select = selectCommand(
            document.session,
            rectMask(SIZE, SIZE, { x: 1, y: 1, width: 2, height: 2 }),
            "replace",
            "Select",
        );
        if (select) document.history.execute(select);
        floatingState.lift(document);
        floatingState.moveBy(1, 0);
        expect(isFloating()).toBe(true);
        const steps = document.history.undoCount;
        expect(command(PLAY_PAUSE_COMMAND).enabled()).toBe(true);
        void command(PLAY_PAUSE_COMMAND).run();
        expect(isFloating()).toBe(false);
        expect(document.history.transaction).toBeNull();
        expect(document.history.undoCount).toBe(steps + 1);
        expect(document.history.undoLabel).toBe("Move");
        expect(editorPlayback.playing).toBe(true);
        expect(play(document, [0, 100])).toEqual([1, 2]);
    });
});

describe("createPlayback: visible time only", () => {
    it("does not count time while the page is hidden, and goes on where it was", () => {
        const document = open(4);
        let visible = true;
        const listeners = new Set<() => void>();
        const queue: (() => void)[] = [];
        let time = 0;
        const sources: PlaybackSources = {
            sessions: sessionsStore,
            state: playbackStore,
            now: () => time,
            nextFrame(callback) {
                queue.push(callback);
                return () => queue.splice(queue.indexOf(callback), 1);
            },
            visible: () => visible,
            onVisibilityChange(listener) {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            onDrawn: () => () => {},
            applyFloating: () => {},
        };
        const playback = createPlayback(sources);
        const at = (next: number) => {
            time = next;
            for (const callback of queue.splice(0)) callback();
            return activeNumber(document);
        };
        try {
            playback.start();
            expect(at(150)).toBe(2);
            time = 150;
            visible = false;
            for (const listener of listeners) listener();
            // Hidden for ten seconds: no animation frame, and the time does not count.
            time = 10_150;
            visible = true;
            for (const listener of listeners) listener();
            expect(at(10_199)).toBe(2);
            expect(at(10_200)).toBe(3);
        } finally {
            playback.dispose();
        }
    });
});

/** A pointer input over the centre of document pixel `x, y`. */
function pointer(x: number, y: number, fields: Partial<PointerInput> = {}): PointerInput {
    return {
        pointerId: 1,
        button: 0,
        buttons: 1,
        clientX: VIEW.originX + (x + 0.5) * VIEW.scale,
        clientY: VIEW.originY + (y + 0.5) * VIEW.scale,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        timeStamp: 0,
        ...fields,
    };
}

/** The pixels of the active layer's cel at frame `number`. */
function celPixels(document: OpenDocument, number: number): Uint8ClampedArray {
    const { doc, activeLayerId } = document.session;
    const cel = celAt(doc, activeLayerId, frameId(document, number));
    return doc.images.get(cel!.imageId)!.data;
}
