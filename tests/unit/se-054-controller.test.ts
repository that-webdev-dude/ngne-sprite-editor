import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import {
    connectPreview,
    PACK_QUIET_MS,
    PACK_SLICE_MS,
} from "../../src/app/preview/previewController";
import type {
    PageVisibility,
    PreviewPacker,
    PreviewSources,
} from "../../src/app/preview/previewController";
import type { PackBatch, PackRequest, PackResponse } from "../../src/app/preview/previewPack";
import { ALL_FRAMES, createPreviewState } from "../../src/app/preview/previewState";
import type { PreviewState } from "../../src/app/preview/previewState";
import { createActiveComposites } from "../../src/app/state/composites";
import type { ActiveComposites } from "../../src/app/state/composites";
import type { CompositeCache } from "../../src/core/composite";
import { createSessionsStore } from "../../src/app/state/sessions";
import { addFrameCommand } from "../../src/core/frames";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";
import { createPixelBuffer } from "../../src/core/pixels";
import type { History } from "../../src/core/history";
import { createTagCommand, editTagCommand } from "../../src/core/tags";
import type { PreviewAtlas, PreviewPort } from "../../src/engine/NgnePreview";

// SE-054 wiring (SPEC §6.5): composite cache notification → changed frames → 150 ms of quiet →
// their composites copied to the packer → atlas to the port; the document's size, the panel's
// choices and whether the game runs.

/** A response without its id, which the fake packer fills in. */
type Answer = {
    [Kind in PackResponse["kind"]]: Omit<Extract<PackResponse, { kind: Kind }>, "id">;
}[PackResponse["kind"]];

class RecordingPort implements PreviewPort {
    calls: string[] = [];
    atlas: PreviewAtlas | null = null;
    running = false;
    animation = "";
    take(): string[] {
        return this.calls.splice(0);
    }
    setSize(size: { width: number; height: number } | null) {
        this.calls.push(size ? `size ${size.width}x${size.height}` : "size none");
    }
    setDisplaySize() {}
    setRunning(running: boolean) {
        if (running !== this.running) this.calls.push(running ? "run" : "stop");
        this.running = running;
    }
    setAtlas(atlas: PreviewAtlas | null) {
        this.atlas = atlas;
        this.calls.push(atlas ? "atlas" : "atlas none");
    }
    setAnimation(key: string) {
        this.animation = key;
    }
    setPlaying() {}
    setSpeed() {}
    setBackground() {}
}

class FakePacker implements PreviewPacker {
    requests: PackRequest[] = [];
    batches: PackBatch[] = [];
    #answers: ((response: PackResponse) => void)[] = [];
    disposed = false;
    send(batch: PackBatch) {
        this.batches.push(batch);
    }
    pack(request: PackRequest): Promise<PackResponse> {
        this.requests.push(request);
        return new Promise((resolve) => this.#answers.push(resolve));
    }
    /** Answers the oldest request still open. */
    answer(response: Answer): Promise<void> {
        const resolve = this.#answers.shift();
        if (!resolve) throw new Error("no request open");
        resolve({ id: 0, ...response } as PackResponse);
        return flush();
    }
    dispose() {
        this.disposed = true;
    }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Timers run when the test says so. */
class Timers {
    #next = 1;
    pending = new Map<number, { callback: () => void; ms: number }>();
    set = (callback: () => void, ms: number) => {
        const id = this.#next++;
        this.pending.set(id, { callback, ms });
        return id;
    };
    clear = (handle: unknown) => {
        this.pending.delete(handle as number);
    };
    /** The delays of the timers waiting. */
    delays(): number[] {
        return [...this.pending.values()].map((timer) => timer.ms);
    }
    run(): void {
        const timers = [...this.pending.values()];
        this.pending.clear();
        for (const timer of timers) timer.callback();
    }
}

class Visibility implements PageVisibility {
    shown = true;
    #listeners = new Set<() => void>();
    visible = () => this.shown;
    subscribe(listener: () => void) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    set(shown: boolean) {
        this.shown = shown;
        for (const listener of this.#listeners) listener();
    }
}

function sprite(name: string, width = 4, height = 4): DocSession {
    return createDocument({ name, width, height }, sequentialIds(`${name}-`));
}

function setup(
    options: {
        /** Called before the connection is made. */
        prepare?(state: StoreApi<PreviewState>): void;
        /** The composites the connection reads, in place of the active document's. */
        composites?(real: ActiveComposites): PreviewSources["composites"];
        now?(): number;
    } = {},
) {
    const sessions = createSessionsStore();
    const composites = createActiveComposites(sessions);
    const state = createPreviewState();
    const port = new RecordingPort();
    const packer = new FakePacker();
    const timers = new Timers();
    const visibility = new Visibility();
    options.prepare?.(state);
    const connection = connectPreview(port, {
        sessions,
        composites: options.composites?.(composites) ?? composites,
        state,
        packer,
        visibility,
        setTimer: timers.set,
        clearTimer: timers.clear,
        ...(options.now ? { now: options.now } : {}),
    });
    return { sessions, composites, state, port, packer, timers, visibility, connection };
}

/** Paints a frame's cel of the active layer one colour (0xRRGGBBAA): one history step. */
function paint(
    document: { session: DocSession; history: History },
    frameId: string,
    colour: number,
) {
    const { session, history } = document;
    const transaction = history.begin({ layerId: session.activeLayerId, frameId });
    const { width, height } = session.doc;
    transaction.image.data.set(createPixelBuffer(width, height, colour).data);
    transaction.markDirty({ x: 0, y: 0, width, height });
    transaction.commit("Paint");
}

const packed = (width = 4, height = 2): Extract<Answer, { kind: "packed" }> => ({
    kind: "packed",
    scope: "all",
    atlas: createPixelBuffer(width, height),
    meta: {
        format: "ngne-sprite-atlas",
        version: 1,
        generator: "test",
        image: "x.png",
        width,
        height,
        frames: {},
        animations: { walk: { playback: "loop", durationMs: 100, entries: [] } },
    },
    allFrames: { playback: "loop", durationMs: 200, entries: [] },
});

describe("connectPreview: packing", () => {
    it("packs a document at once when it is shown, every frame's composite copied", () => {
        const { sessions, composites, port, packer, timers } = setup();
        const session = sprite("hero", 3, 2);
        const document = sessions.getState().open(session);
        document.history.execute(addFrameCommand(session.doc, session.activeFrameId));
        expect(port.take()).toEqual(expect.arrayContaining(["atlas none", "size 3x2", "run"]));
        expect(timers.delays()).toContain(0);
        timers.run();
        expect(packer.requests).toHaveLength(1);
        const [request] = packer.requests;
        expect(request!.reset).toBe(true);
        expect(request!.frames.map((frame) => frame.id)).toEqual(
            session.doc.frames.map((f) => f.id),
        );
        const cache = composites.cacheOf(session)!;
        for (const frame of request!.frames) {
            const composite = cache.get(frame.id);
            expect(frame.data).toEqual(composite.data);
            // A copy: the frame being stroked is one buffer rewritten in place (SPEC §5.3).
            expect(frame.data).not.toBe(composite.data);
            expect(frame.data.buffer).not.toBe(composite.data.buffer);
        }
        expect(request!.doc).toMatchObject({ name: "hero", width: 3, height: 2 });
        expect(request!.settings).toEqual(session.doc.exportSettings);
        expect(request!.settings).not.toBe(session.doc.exportSettings);
    });

    it("after the first pack, sends only the changed frames, 150 ms after the last change", async () => {
        const { sessions, packer, timers } = setup();
        const session = sprite("hero");
        const document = sessions.getState().open(session);
        document.history.execute(addFrameCommand(session.doc, session.activeFrameId));
        timers.run();
        await packer.answer(packed());
        const [first, second] = session.doc.frames.map((frame) => frame.id);

        paint(document, second!, 0xff0000ff);
        expect(timers.delays()).toEqual([PACK_QUIET_MS]);
        // Another change restarts the quiet.
        paint(document, second!, 0x00ff00ff);
        expect(timers.delays()).toEqual([PACK_QUIET_MS]);
        expect(packer.requests).toHaveLength(1);
        timers.run();
        expect(packer.requests).toHaveLength(2);
        const request = packer.requests[1]!;
        expect(request.reset).toBe(false);
        expect(request.frames.map((frame) => frame.id)).toEqual([second]);
        expect(first).not.toBe(second);
    });

    it("a change of the frame list sends every frame again", async () => {
        const { sessions, packer, timers } = setup();
        const session = sprite("hero");
        const document = sessions.getState().open(session);
        timers.run();
        await packer.answer(packed());
        document.history.execute(addFrameCommand(session.doc, session.activeFrameId));
        timers.run();
        expect(packer.requests[1]!.frames.map((frame) => frame.id)).toEqual(
            session.doc.frames.map((frame) => frame.id),
        );
    });

    it("tags and export settings repack without pixels", async () => {
        const { sessions, packer, timers, state } = setup();
        const session = sprite("hero");
        const document = sessions.getState().open(session);
        document.history.execute(addFrameCommand(session.doc, session.activeFrameId));
        timers.run();
        await packer.answer(packed());

        document.history.execute(
            createTagCommand(session.doc, {
                name: "Walk",
                color: 0xff0000ff,
                fromFrameId: session.doc.frames[0]!.id,
                toFrameId: session.doc.frames[1]!.id,
                direction: "forward",
                repeat: 0,
            }),
        );
        expect(state.getState().animations).toEqual(["walk"]);
        timers.run();
        await packer.answer(packed());

        // A tag's direction changes no pixel.
        const tagId = session.doc.tags[0]!.id;
        document.history.execute(editTagCommand(session.doc, tagId, { direction: "pingpong" })!);
        expect(timers.delays()).toEqual([PACK_QUIET_MS]);
        timers.run();
        expect(packer.requests[2]!.frames).toEqual([]);
        expect(packer.requests[2]!.doc.tags[0]).toMatchObject({ direction: "pingpong" });
        await packer.answer(packed());

        sessions.getState().updateExportSettings(document.id, (settings) => {
            settings.padding = 3;
        });
        expect(timers.delays()).toEqual([PACK_QUIET_MS]);
        timers.run();
        expect(packer.requests[3]!.settings.padding).toBe(3);
        expect(packer.requests[3]!.frames).toEqual([]);
    });

    it("packs while a transaction is open: it never waits for an idle history (a floating selection)", async () => {
        const { sessions, composites, packer, timers } = setup();
        const session = sprite("hero");
        const document = sessions.getState().open(session);
        timers.run();
        await packer.answer(packed());
        // Pixels written by an open transaction, as a float's are, reported to the cache.
        const transaction = document.history.begin({
            layerId: session.activeLayerId,
            frameId: session.activeFrameId,
        });
        transaction.image.data.fill(200);
        composites.invalidate({
            frameIds: [session.activeFrameId],
            layerIds: [session.activeLayerId],
            structure: false,
        });
        timers.run();
        expect(packer.requests).toHaveLength(2);
        expect(packer.requests[1]!.frames[0]!.data[0]).toBe(200);
        transaction.abort();
    });

    it("ignores the answer for a document no longer shown, and resets the worker for the next", async () => {
        const { sessions, packer, timers, port } = setup();
        sessions.getState().open(sprite("one"));
        timers.run();
        port.take();
        sessions.getState().open(sprite("two", 6, 6));
        expect(port.take()).toEqual(expect.arrayContaining(["atlas none", "size 6x6"]));
        // The first answer comes after the switch: not shown.
        await packer.answer(packed());
        expect(port.take()).not.toContain("atlas");
        timers.run();
        await flush();
        const last = packer.requests[packer.requests.length - 1]!;
        expect(last.reset).toBe(true);
        expect(last.doc.name).toBe("two");
        await packer.answer(packed());
        expect(port.take()).toContain("atlas");
    });
});

describe("connectPreview: what the panel shows", () => {
    it('hands the port the atlas with "All frames", and plays the first animation', async () => {
        const { sessions, packer, timers, port, state } = setup();
        const session = sprite("hero");
        const document = sessions.getState().open(session);
        document.history.execute(addFrameCommand(session.doc, session.activeFrameId));
        expect(state.getState().status.kind).toBe("packing");
        expect(port.animation).toBe("hero");
        timers.run();
        await packer.answer(packed());
        expect(state.getState().status.kind).toBe("ready");
        expect(Object.keys(port.atlas!.sheet.animations)).toEqual(["walk", ALL_FRAMES]);
        state.setState({ chosen: ALL_FRAMES });
        expect(port.animation).toBe(ALL_FRAMES);
    });

    it("shows a too-large or an export error in place of the preview, and stops the game", async () => {
        const { sessions, packer, timers, port, state } = setup();
        sessions.getState().open(sprite("hero"));
        timers.run();
        await packer.answer({ kind: "too-large", message: "8192 px" });
        expect(state.getState().status).toEqual({ kind: "too-large", message: "8192 px" });
        expect(port.atlas).toBeNull();
        expect(port.running).toBe(false);
    });

    it("an export error is shown with its message", async () => {
        const { sessions, packer, timers, state, port } = setup();
        sessions.getState().open(sprite("hero"));
        timers.run();
        await packer.answer({ kind: "failed", message: "65536 entries" });
        expect(state.getState().status).toEqual({ kind: "error", message: "65536 entries" });
        expect(port.running).toBe(false);
    });

    it("selecting another animation packs at once while the atlas holds one tag only", async () => {
        const { sessions, packer, timers, state } = setup();
        const session = sprite("hero");
        const document = sessions.getState().open(session);
        document.history.execute(addFrameCommand(session.doc, session.activeFrameId));
        for (const name of ["A", "B"]) {
            document.history.execute(
                createTagCommand(session.doc, {
                    name,
                    color: 0xff0000ff,
                    fromFrameId: session.doc.frames[0]!.id,
                    toFrameId: session.doc.frames[1]!.id,
                    direction: "forward",
                    repeat: 0,
                }),
            );
        }
        timers.run();
        expect(packer.requests[0]!.fallbackTagId).toBe(session.doc.tags[0]!.id);
        await packer.answer({ ...packed(), scope: "tag", allFrames: null });
        state.setState({ chosen: "b" });
        expect(timers.delays()).toEqual([0]);
        timers.run();
        expect(packer.requests[1]!.fallbackTagId).toBe(session.doc.tags[1]!.id);

        // With the whole atlas, a selection needs no pack.
        await packer.answer(packed());
        state.setState({ chosen: "a" });
        expect(timers.delays()).toEqual([]);
    });
});

describe("connectPreview: when the game runs", () => {
    it("runs while a document is open and the page is visible", () => {
        const { sessions, port, visibility } = setup();
        expect(port.running).toBe(false);
        const document = sessions.getState().open(sprite("hero"));
        expect(port.running).toBe(true);
        visibility.set(false);
        expect(port.running).toBe(false);
        visibility.set(true);
        expect(port.running).toBe(true);
        sessions.getState().close(document.id);
        expect(port.running).toBe(false);
        expect(port.take()).toContain("size none");
    });

    it("stops the game and ends the packer when disposed", () => {
        const { sessions, port, packer, connection, timers } = setup();
        sessions.getState().open(sprite("hero"));
        connection.dispose();
        expect(port.running).toBe(false);
        expect(packer.disposed).toBe(true);
        expect(timers.pending.size).toBe(0);
    });
});

/** Adds a tag over the first two frames of the document: one history step. */
function addTag(document: { session: DocSession; history: History }, name: string) {
    const { doc } = document.session;
    document.history.execute(
        createTagCommand(doc, {
            name,
            color: 0xff0000ff,
            fromFrameId: doc.frames[0]!.id,
            toFrameId: doc.frames[1]!.id,
            direction: "forward",
            repeat: 0,
        }),
    );
}

describe("connectPreview: review fixes", () => {
    it("connected with no document open, resets what the panel showed before (a collapse, then every document closed)", () => {
        const { state, port } = setup({
            prepare: (state) => state.setState({ status: { kind: "ready" }, animations: ["x"] }),
        });
        expect(state.getState().status).toEqual({ kind: "none" });
        expect(state.getState().animations).toEqual([]);
        expect(port.running).toBe(false);
    });

    it("a composite that cannot be made shows its message and asks for no other pack", () => {
        const { sessions, timers, state, packer } = setup({
            composites: (real) => ({
                subscribe: real.subscribe,
                cacheOf: () =>
                    ({
                        get: () => {
                            throw new RangeError("out of memory");
                        },
                    }) as unknown as CompositeCache,
            }),
        });
        const session = sprite("hero");
        const document = sessions.getState().open(session);
        document.history.execute(addFrameCommand(session.doc, session.activeFrameId));
        addTag(document, "Walk");
        // The tag's animation is selected: the one the too-large fallback would pack.
        state.setState({ chosen: "walk" });
        timers.run();
        expect(state.getState().status).toEqual({ kind: "error", message: "out of memory" });
        expect(packer.requests).toEqual([]);
        // No pack asked for again at once, and again after it: no busy loop.
        expect(timers.pending.size).toBe(0);
        expect(state.getState().packing).toBe(false);
    });

    it(`reads composites in slices of ${PACK_SLICE_MS} ms, one task each, each slice sent as a batch`, () => {
        // Each read of the clock is 10 ms later: one frame fills a slice.
        let clock = 0;
        const { sessions, packer, timers, state } = setup({ now: () => (clock += 10) });
        const session = sprite("hero");
        const document = sessions.getState().open(session);
        for (let index = 0; index < 2; index++) {
            document.history.execute(addFrameCommand(session.doc, session.activeFrameId));
        }
        const ids = session.doc.frames.map((frame) => frame.id);
        expect(ids).toHaveLength(3);

        timers.run();
        // The first slice went as a batch that resets the worker; the next waits for a task.
        expect(packer.batches).toEqual([
            { kind: "frames", reset: true, frames: [expect.objectContaining({ id: ids[0] })] },
        ]);
        expect(packer.requests).toEqual([]);
        expect(timers.delays()).toEqual([0]);
        expect(state.getState().packing).toBe(true);

        timers.run();
        expect(packer.batches).toHaveLength(2);
        expect(packer.batches[1]).toEqual({
            kind: "frames",
            reset: false,
            frames: [expect.objectContaining({ id: ids[1] })],
        });
        expect(packer.requests).toEqual([]);

        // The last slice goes with the request.
        timers.run();
        expect(packer.requests).toHaveLength(1);
        expect(packer.requests[0]!.reset).toBe(false);
        expect(packer.requests[0]!.frames.map((frame) => frame.id)).toEqual([ids[2]]);
        expect(timers.delays()).toEqual([]);
    });

    it("a pack read in slices ends when another document is shown", () => {
        let clock = 0;
        const { sessions, packer, timers } = setup({ now: () => (clock += 10) });
        const one = sprite("one");
        const document = sessions.getState().open(one);
        document.history.execute(addFrameCommand(one.doc, one.activeFrameId));
        timers.run();
        expect(packer.batches).toHaveLength(1);

        const two = sprite("two");
        sessions.getState().open(two);
        // The pending slice of "one" is gone; "two" is packed at once, from a reset.
        expect(timers.delays()).toEqual([0]);
        timers.run();
        timers.run();
        const sentIds = [
            ...packer.batches.flatMap((batch) => batch.frames),
            ...packer.requests.flatMap((request) => request.frames),
        ].map((frame) => frame.id);
        expect(sentIds).toEqual([one.doc.frames[0]!.id, two.doc.frames[0]!.id]);
        expect(packer.requests.map((request) => request.doc.name)).toEqual(["two"]);
        expect(packer.requests[0]!.reset).toBe(true);
    });

    it("a tag change keeps the composites the worker holds: nothing is composited again", async () => {
        const { sessions, composites, packer, timers } = setup();
        const session = sprite("hero");
        const document = sessions.getState().open(session);
        document.history.execute(addFrameCommand(session.doc, session.activeFrameId));
        timers.run();
        await packer.answer(packed());

        const cache = composites.cacheOf(session)!;
        const get = vi.spyOn(cache, "get");
        addTag(document, "Walk");
        timers.run();
        expect(packer.requests).toHaveLength(2);
        expect(packer.requests[1]!.frames).toEqual([]);
        expect(packer.requests[1]!.doc.tags.map((tag) => tag.name)).toEqual(["Walk"]);
        expect(get).not.toHaveBeenCalled();
        await packer.answer(packed());

        // A change of the frame list still sends every frame.
        document.history.execute(addFrameCommand(session.doc, session.activeFrameId));
        timers.run();
        expect(packer.requests[2]!.frames).toHaveLength(3);
    });

    it("a change of the view alone is not compared and packs nothing; a field set outside the history is", async () => {
        const { sessions, packer, timers } = setup();
        const session = sprite("hero");
        const document = sessions.getState().open(session);
        document.history.execute(addFrameCommand(session.doc, session.activeFrameId));
        timers.run();
        await packer.answer(packed());

        // Every read of the frames and tags of the document is counted.
        let reads = 0;
        const counted = <Value extends object>(value: Value): Value =>
            new Proxy(value, {
                get(target, key, receiver) {
                    reads++;
                    return Reflect.get(target, key, receiver) as unknown;
                },
            });
        session.doc.frames = counted(session.doc.frames);
        session.doc.tags = counted(session.doc.tags);

        sessions.getState().setView(document.id, { scale: 4, originX: 10 });
        sessions.getState().setView(document.id, { originY: -3 });
        expect(reads).toBe(0);
        expect(timers.delays()).toEqual([]);
        expect(packer.requests).toHaveLength(1);

        // A test hook's change, told with `touch`: compared, and packed.
        session.doc.frames[0]!.durationMs = 40;
        sessions.getState().touch(document.id);
        expect(timers.delays()).toEqual([PACK_QUIET_MS]);
        timers.run();
        expect(packer.requests[1]!.doc.frames[0]!.durationMs).toBe(40);
        expect(packer.requests[1]!.frames).toEqual([]);
    });
});
