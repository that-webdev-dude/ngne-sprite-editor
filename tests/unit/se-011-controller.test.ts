import { describe, expect, it } from "vitest";
import { createPreferenceStore } from "../../src/app/preferences/preferences";
import { createSessionsStore } from "../../src/app/state/sessions";
import { connectViewport, DEFAULT_VIEWPORT_THEME } from "../../src/app/viewport/viewportController";
import { compositeFrame } from "../../src/core/composite";
import { addFrameCommand, deleteFramesCommand } from "../../src/core/frames";
import { pixelPatchCommand } from "../../src/core/history";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";
import { createPixelBuffer } from "../../src/core/pixels";
import { frameKey } from "../../src/engine/viewport/types";
import { RecordingViewport } from "./se-011-support";

// SE-011 wiring: history change (touched) → composite cache invalidation → the viewport is
// told which frame keys to refresh; and the active frame, the active session, the view and
// the checkerboard preference reach the viewport.

function sprite(name: string, width = 4, height = 4): DocSession {
    return createDocument({ name, width, height }, sequentialIds(`${name}-`));
}

function setup() {
    const sessions = createSessionsStore();
    const preferences = createPreferenceStore(null);
    const viewport = new RecordingViewport();
    const connection = connectViewport(viewport, { sessions, preferences });
    return { sessions, preferences, viewport, connection };
}

/** Opens `session` and paints its first cel `colour` (0xRRGGBBAA): one history step. */
function openPainted(store: ReturnType<typeof setup>, session: DocSession, colour: number) {
    const document = store.sessions.getState().open(session);
    const transaction = document.history.begin({
        layerId: session.activeLayerId,
        frameId: session.activeFrameId,
    });
    transaction.image.data.set(
        createPixelBuffer(session.doc.width, session.doc.height, colour).data,
    );
    transaction.markDirty({ x: 0, y: 0, width: session.doc.width, height: session.doc.height });
    transaction.commit("Paint");
    return document;
}

describe("connectViewport: what is on show", () => {
    it("shows nothing while no document is open, with the theme's background and checkerboard", () => {
        const { viewport } = setup();
        // No document and no frame: a viewport starts out with neither.
        expect(viewport.take()).toEqual(["background f0f10", "checker 3a3a3a/4a4a4a/8"]);
        expect(viewport.document).toBeNull();
        expect(viewport.current).toBeNull();
        expect(DEFAULT_VIEWPORT_THEME).toEqual({
            checkerA: 0x3a3a3a,
            checkerB: 0x4a4a4a,
            workspace: 0x0f0f10,
        });
    });

    it("shows the active document: its size, its active frame and its view", () => {
        const { sessions, viewport } = setup();
        viewport.take();
        const session = sprite("hero", 5, 3);
        sessions.getState().open(session, { view: { scale: 8, originX: 40, originY: 24 } });
        expect(viewport.take()).toEqual([
            "document 5x3",
            `current ${frameKey(session.activeFrameId)}`,
            "view 8@40,24",
        ]);
        expect(viewport.current).toBe("hero-3:plain");
    });

    it("shows a document that is already open when the viewport is connected", () => {
        const sessions = createSessionsStore();
        const session = sprite("early");
        sessions.getState().open(session);
        const viewport = new RecordingViewport();
        connectViewport(viewport, { sessions, preferences: createPreferenceStore(null) });
        expect(viewport.document).toMatchObject({ width: 4, height: 4 });
        expect(viewport.current).toBe(frameKey(session.activeFrameId));
        expect(viewport.view).toEqual({ scale: 1, originX: 0, originY: 0 });
    });

    it("passes a view change on, and nothing else for a change that is not the view's", () => {
        const { sessions, viewport } = setup();
        const session = sprite("hero");
        const { id } = sessions.getState().open(session);
        viewport.take();
        sessions.getState().setView(id, { scale: 4, originX: 12 });
        expect(viewport.take()).toEqual(["view 4@12,0"]);
        // Document settings, saving and reference sources are not the viewport's business.
        sessions.getState().updateDocSettings(id, (settings) => {
            settings.pixelGrid = !settings.pixelGrid;
        });
        sessions.getState().markSaved(id);
        sessions.getState().setReferenceSource(id, "ref", new Uint8Array(1));
        expect(viewport.take()).toEqual([]);
    });

    it("follows the active frame, whether a command or the session itself changes it", () => {
        const { sessions, viewport } = setup();
        const session = sprite("hero");
        const { id, history } = sessions.getState().open(session);
        const first = session.activeFrameId;
        viewport.take();

        // Session state changed outside the history, as the timeline does.
        session.doc.frames.push({ id: "extra", durationMs: 100 });
        session.activeFrameId = "extra";
        sessions.getState().touch(id);
        expect(viewport.take()).toEqual(["current extra:plain"]);

        // A command that adds a frame makes it the active one.
        history.execute(addFrameCommand(session.doc, "extra", () => "added"));
        expect(viewport.take()).toEqual(["current added:plain", "invalidate all"]);
        history.undo();
        expect(viewport.take()).toEqual(["current extra:plain", "invalidate all"]);
        session.activeFrameId = first;
        sessions.getState().touch(id);
        expect(viewport.current).toBe(frameKey(first));
    });

    it("follows the active session and stops listening to the one it left", () => {
        const store = setup();
        const { sessions, viewport } = store;
        const a = openPainted(store, sprite("a", 4, 4), 0xff0000ff);
        const b = openPainted(store, sprite("b", 6, 2), 0x00ff00ff);
        viewport.take();

        sessions.getState().activate(a.id);
        expect(viewport.take()).toEqual([
            "document 4x4",
            `current ${frameKey(a.session.activeFrameId)}`,
            "view 1@0,0",
        ]);
        // A step of the document in the background does not reach the viewport.
        b.history.undo();
        expect(viewport.take()).toEqual([]);
        a.history.undo();
        expect(viewport.take()).toEqual([`invalidate ${frameKey(a.session.activeFrameId)}`]);

        sessions.getState().close(a.id);
        expect(viewport.take()).toEqual([
            "document 6x2",
            `current ${frameKey(b.session.activeFrameId)}`,
            "view 1@0,0",
        ]);
        sessions.getState().close(b.id);
        expect(viewport.take()).toEqual(["document -", "current -"]);
    });

    it("treats the same file opened again as a new document", () => {
        const { sessions, viewport } = setup();
        const first = sprite("same");
        sessions.getState().open(first);
        const before = viewport.document;
        viewport.take();
        // Same ids: only the session object tells the two apart.
        sessions.getState().replaceActive(sprite("same"));
        expect(viewport.take()).toEqual(["document 4x4", "current same-3:plain", "view 1@0,0"]);
        expect(viewport.document).not.toBe(before);
    });
});

describe("connectViewport: history → composite cache → viewport", () => {
    it("invalidates the touched frames and serves the new composite", () => {
        const store = setup();
        const session = sprite("hero");
        const document = openPainted(store, session, 0xff0000ff);
        const { viewport, connection } = store;
        const key = frameKey(session.activeFrameId);
        expect(viewport.take().at(-1)).toBe(`invalidate ${key}`);

        const before = viewport.document?.pixels(key);
        expect([...(before?.data.slice(0, 4) ?? [])]).toEqual([255, 0, 0, 255]);
        // The cache hands out the same buffer until the frame changes.
        expect(viewport.document?.pixels(key)).toBe(before);
        expect(connection.composites?.has(session.activeFrameId)).toBe(true);

        const [cel] = [...session.doc.cels.values()];
        document.history.execute(
            pixelPatchCommand(session.doc, {
                label: "Patch",
                imageId: cel?.imageId ?? "",
                x: 0,
                y: 0,
                pixels: createPixelBuffer(1, 1, 0x0000ffff),
            }),
        );
        expect(viewport.take()).toEqual([`invalidate ${key}`]);
        const after = viewport.document?.pixels(key);
        // A new buffer with the new pixels: the cache was invalidated before the viewport
        // was told, and the buffer handed out earlier is unchanged.
        expect(after).not.toBe(before);
        expect([...(after?.data.slice(0, 8) ?? [])]).toEqual([0, 0, 255, 255, 255, 0, 0, 255]);
        expect([...(before?.data.slice(0, 4) ?? [])]).toEqual([255, 0, 0, 255]);
        expect(after).toEqual(compositeFrame(session.doc, session.activeFrameId));

        document.history.undo();
        expect(viewport.take()).toEqual([`invalidate ${key}`]);
        expect([...(viewport.document?.pixels(key)?.data.slice(0, 4) ?? [])]).toEqual([
            255, 0, 0, 255,
        ]);
        document.history.redo();
        expect(viewport.take()).toEqual([`invalidate ${key}`]);
    });

    it("invalidates everything for a step that changes the structure", () => {
        const store = setup();
        const session = sprite("hero");
        const document = openPainted(store, session, 0xff0000ff);
        const { viewport } = store;
        const first = session.activeFrameId;
        viewport.take();

        document.history.execute(addFrameCommand(session.doc, first, () => "second"));
        expect(viewport.take()).toEqual(["current second:plain", "invalidate all"]);
        // The new frame is empty; the first one still composites to its pixels.
        expect(viewport.document?.pixels("second:plain")?.data.every((byte) => byte === 0)).toBe(
            true,
        );
        expect([...(viewport.document?.pixels(frameKey(first))?.data.slice(0, 4) ?? [])]).toEqual([
            255, 0, 0, 255,
        ]);

        // A frame that no longer exists has no pixels; neither has an unknown variant.
        document.history.execute(deleteFramesCommand(session.doc, ["second"]));
        expect(viewport.take()).toEqual([`current ${frameKey(first)}`, "invalidate all"]);
        expect(viewport.document?.pixels("second:plain")).toBeNull();
        expect(viewport.document?.pixels(frameKey(first, "before"))).toBeNull();
    });

    it("reports the document's size as it is now", () => {
        const { sessions, viewport } = setup();
        const session = sprite("hero", 6, 4);
        sessions.getState().open(session);
        expect(viewport.document).toMatchObject({ width: 6, height: 4 });
        session.doc.width = 9;
        session.doc.height = 7;
        expect(viewport.document?.width).toBe(9);
        expect(viewport.document?.height).toBe(7);
    });

    it("keeps composites of the active document only", () => {
        const store = setup();
        expect(store.connection.composites).toBeNull();
        const a = openPainted(store, sprite("a"), 0xff0000ff);
        const cacheA = store.connection.composites;
        expect(cacheA?.doc).toBe(a.session.doc);
        const b = openPainted(store, sprite("b"), 0x00ff00ff);
        expect(store.connection.composites?.doc).toBe(b.session.doc);
        // Back on the first document: a new cache, the old one was let go.
        store.sessions.getState().activate(a.id);
        expect(store.connection.composites?.doc).toBe(a.session.doc);
        expect(store.connection.composites).not.toBe(cacheA);
    });
});

describe("connectViewport: checkerboard and theme", () => {
    it("reads the checkerboard size and colours from the preference store", () => {
        const { preferences, viewport } = setup();
        viewport.take();
        preferences.set("checkerboard", { colors: "theme", size: 4 });
        expect(viewport.take()).toEqual(["checker 3a3a3a/4a4a4a/4"]);
        preferences.set("checkerboard", { colors: { a: 0x102030, b: 0xa0b0c0 }, size: 16 });
        expect(viewport.take()).toEqual(["checker 102030/a0b0c0/16"]);
        // Other preferences are not the viewport's.
        preferences.set("grid", { width: 8, height: 8 });
        expect(viewport.take()).toEqual([]);
        preferences.reset("checkerboard");
        expect(viewport.take()).toEqual(["checker 3a3a3a/4a4a4a/8"]);
    });

    it("uses a stored checkerboard preference from the start", () => {
        const preferences = createPreferenceStore(null);
        preferences.set("checkerboard", { colors: { a: 1, b: 2 }, size: 3 });
        const viewport = new RecordingViewport();
        connectViewport(viewport, { sessions: createSessionsStore(), preferences });
        expect(viewport.checker).toEqual({ a: 1, b: 2, size: 3 });
    });

    it("takes the workspace and the theme's checkerboard colours from the interface", () => {
        const { preferences, viewport, connection } = setup();
        viewport.take();
        connection.setTheme({ checkerA: 0xc8c8c8, checkerB: 0xffffff, workspace: 0xd9d9db });
        expect(viewport.take()).toEqual(["background d9d9db", "checker c8c8c8/ffffff/8"]);
        // Custom colours win over the theme's; the workspace still follows the theme.
        preferences.set("checkerboard", { colors: { a: 0x111111, b: 0x222222 }, size: 8 });
        viewport.take();
        connection.setTheme({ checkerA: 0x3a3a3a, checkerB: 0x4a4a4a, workspace: 0x0f0f10 });
        expect(viewport.take()).toEqual(["background f0f10", "checker 111111/222222/8"]);
    });
});

describe("connectViewport: dispose", () => {
    it("stops following the stores", () => {
        const store = setup();
        const session = sprite("hero");
        const document = openPainted(store, session, 0xff0000ff);
        store.viewport.take();
        store.connection.dispose();

        document.history.undo();
        store.sessions.getState().setView(document.id, { scale: 2 });
        store.preferences.set("checkerboard", { colors: "theme", size: 2 });
        store.sessions.getState().close(document.id);
        expect(store.viewport.take()).toEqual([]);
        expect(store.connection.composites).toBeNull();
    });
});
