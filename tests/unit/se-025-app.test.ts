import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu, menuCommands } from "../../src/app/commands/menuModel";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import type { Command } from "../../src/app/commands/types";
import {
    activeOnion,
    onionEdit,
    setOnionSettings,
    viewportGhosts,
    withOnionPatch,
} from "../../src/app/onion/onion";
import { ONION_SETTINGS_COMMAND, ONION_SKIN_COMMAND } from "../../src/app/onion/onion.commands";
import { activeEchoCover, onionCover } from "../../src/app/onion/onionCover";
import { keepsPlaying } from "../../src/app/playback/playbackState";
import { createPreferenceStore, preferences } from "../../src/app/preferences/preferences";
import { spriteDialogs } from "../../src/app/sprite/dialogs";
import { createActiveComposites } from "../../src/app/state/composites";
import {
    activeDocument,
    createSessionsStore,
    isDirty,
    sessionsStore,
} from "../../src/app/state/sessions";
import { echoPixels } from "../../src/app/tools/strokeEcho.overlay";
import { connectViewport } from "../../src/app/viewport/viewportController";
import { compositeFrame } from "../../src/core/composite";
import { celKey, createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, OnionSettings, PixelBuffer } from "../../src/core/model";
import { frameKey } from "../../src/engine/viewport/types";
import type { ViewportGhost } from "../../src/engine/viewport/types";
import { RecordingViewport } from "./se-011-support";

// SE-025 in `app`: the ghosts the viewport is given and the pixels of the tinted variants, the
// onion settings' setters (saved, not undoable, never dirty), the F3 toggle, the defaults of a
// new document, and how the stroke echo gives way to onion skins.

/**
 * A document of `count` frames of `width`×1: in frame i the first pixel is opaque grey
 * 10 × (i + 1), the others transparent. Onion skin is on with `onion`.
 */
function sprite(count: number, onion: Partial<OnionSettings> = {}, width = 2): DocSession {
    const session = createDocument({ name: "onion", width, height: 1 }, sequentialIds("o-"));
    const { doc } = session;
    const first = doc.frames[0]!;
    doc.frames = Array.from({ length: count }, (_, index) => ({
        id: index === 0 ? first.id : `f${index + 1}`,
        durationMs: 100,
    }));
    for (const [index, frame] of doc.frames.entries()) {
        const grey = 10 * (index + 1);
        const imageId = `image-${index}`;
        const data = new Uint8ClampedArray(width * 4);
        data.set([grey, grey, grey, 255]);
        doc.images.set(imageId, { width, height: 1, data });
        doc.cels.set(celKey(session.activeLayerId, frame.id), { imageId, opacity: 255 });
    }
    doc.settings.onion = { ...doc.settings.onion, enabled: true, ...onion };
    return session;
}

class OnionViewport extends RecordingViewport {
    ghosts: readonly ViewportGhost[] = [];
    setOnion(ghosts: readonly ViewportGhost[]): void {
        this.calls.push(`onion ${ghosts.map((ghost) => ghost.key).join(",")}`);
        this.ghosts = ghosts;
    }
}

function connect() {
    const sessions = createSessionsStore();
    const viewport = new OnionViewport();
    connectViewport(viewport, {
        sessions,
        preferences: createPreferenceStore(null),
        composites: createActiveComposites(sessions),
    });
    return { sessions, viewport };
}

describe("connectViewport: onion skins", () => {
    it("gives the viewport the ghosts of the active frame: plain keys with tint off, after the frame key", () => {
        const { sessions, viewport } = connect();
        const session = sprite(4, { before: 1, after: 2, opacity: 128, falloff: 0.5 });
        session.activeFrameId = "f2";
        const { id } = sessions.getState().open(session);
        const calls = viewport.take();
        expect(calls.indexOf("onion o-3:plain,f4:plain,f3:plain")).toBeGreaterThan(
            calls.indexOf("current f2:plain"),
        );
        expect(viewport.ghosts).toEqual([
            { key: "o-3:plain", alpha: 128 / 255, placement: "behind" },
            { key: "f4:plain", alpha: 64 / 255, placement: "behind" },
            { key: "f3:plain", alpha: 128 / 255, placement: "behind" },
        ]);

        // Tint and placement are settings, with no history entry.
        sessions.getState().updateDocSettings(id, (settings) => {
            settings.onion = { ...settings.onion, tint: true, placement: "front", after: 0 };
        });
        expect(viewport.ghosts).toEqual([
            { key: "o-3:before", alpha: 128 / 255, placement: "front" },
        ]);
        // Another active frame: its own ghosts.
        session.activeFrameId = "f3";
        sessions.getState().touch(id);
        expect(viewport.ghosts.map((ghost) => ghost.key)).toEqual(["f2:before"]);
        // Off: none.
        sessions.getState().updateDocSettings(id, (settings) => {
            settings.onion.enabled = false;
        });
        expect(viewport.ghosts).toEqual([]);
        // No document: none.
        sessions.getState().close(id);
        expect(viewport.ghosts).toEqual([]);
    });

    it("gives the tinted variants their pixels: the composite 50% toward red or blue, alpha kept", () => {
        const { sessions, viewport } = connect();
        sessions.getState().open(sprite(3));
        const pixels = (key: string) => [...(viewport.document?.pixels(key)?.data ?? [])];
        expect(pixels(frameKey("f2"))).toEqual([20, 20, 20, 255, 0, 0, 0, 0]);
        expect(pixels(frameKey("f2", "before"))).toEqual([138, 10, 10, 255, 0, 0, 0, 0]);
        expect(pixels(frameKey("f2", "after"))).toEqual([10, 10, 138, 255, 0, 0, 0, 0]);
        // The composite in the cache is not tinted.
        expect(pixels(frameKey("f2"))).toEqual([20, 20, 20, 255, 0, 0, 0, 0]);
        expect(viewport.document?.pixels(frameKey("nope", "before"))).toBeNull();
    });

    it("tells the viewport of a change of a ghost's frame by its plain key, as of any frame", () => {
        const { sessions, viewport } = connect();
        const session = sprite(2, { tint: true });
        session.activeFrameId = "f2";
        const document = sessions.getState().open(session);
        viewport.take();
        const transaction = document.history.begin({
            layerId: session.activeLayerId,
            frameId: session.doc.frames[0]!.id,
        });
        transaction.image.data.set([200, 0, 0, 255]);
        transaction.markDirty({ x: 0, y: 0, width: 1, height: 1 });
        transaction.commit("Paint");
        expect(viewport.take()).toContain("invalidate o-3:plain");
        expect(viewport.ghosts.map((ghost) => ghost.key)).toEqual(["o-3:before"]);
        expect([...(viewport.document?.pixels("o-3:before")?.data.slice(0, 4) ?? [])]).toEqual([
            228, 0, 0, 255,
        ]);
    });
});

function command(id: string): Command {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

function active() {
    const document = activeDocument(sessionsStore.getState());
    if (!document) throw new Error("no document");
    return document;
}

beforeAll(() => spriteDialogs.attachHost());

afterEach(() => {
    spriteDialogs.store.getState().request?.answer(null);
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    preferences.reset();
});

describe("onion settings and the toggle", () => {
    it("Show/Hide Onion Skin takes its planned View item, binds F3 globally and leaves playback running", () => {
        const toggle = command(ONION_SKIN_COMMAND);
        const plan = plannedCommands.find((entry) => entry.id === ONION_SKIN_COMMAND);
        expect(toggle.planned).toBe(false);
        expect(toggle.menuPath).toEqual(["View"]);
        expect(toggle.menuOrder).toBe(plan?.menuOrder);
        expect(toggle.shortcuts).toEqual(["F3"]);
        expect(toggle.contexts).toEqual(["global"]);
        expect(keepsPlaying(ONION_SKIN_COMMAND)).toBe(true);
        const view = menuCommands(buildMenu(appCommands.list(), ["View"])).map((entry) => entry.id);
        expect(view).toContain(ONION_SKIN_COMMAND);
        // Disabled with no document.
        expect(toggle.enabled()).toBe(false);
        expect(toggle.title()).toBe("Show Onion Skin");
    });

    it("toggles the active document's setting: no history entry, never dirty, enabled while a stroke is open", async () => {
        const document = sessionsStore
            .getState()
            .open(createDocument({ name: "a", width: 4, height: 4 }));
        const toggle = command(ONION_SKIN_COMMAND);
        const position = document.history.position;
        expect(toggle.enabled()).toBe(true);
        await toggle.run();
        expect(active().session.doc.settings.onion.enabled).toBe(true);
        expect(toggle.title()).toBe("Hide Onion Skin");
        expect(document.history.position).toBe(position);
        expect(document.history.canUndo).toBe(false);
        expect(isDirty(active())).toBe(false);

        // A transaction open (a stroke, or a floating selection): the setting still changes.
        const transaction = document.history.begin({
            layerId: document.session.activeLayerId,
            frameId: document.session.activeFrameId,
        });
        expect(toggle.enabled()).toBe(true);
        await toggle.run();
        expect(activeOnion()?.enabled).toBe(false);
        setOnionSettings({ before: 3, tint: true });
        expect(activeOnion()).toMatchObject({ before: 3, tint: true });
        transaction.abort();
        expect(isDirty(active())).toBe(false);
    });

    it("refuses a value outside DocSettings.onion before changing anything", () => {
        sessionsStore.getState().open(createDocument({ name: "a", width: 4, height: 4 }));
        const before = { ...activeOnion()! };
        for (const patch of [
            { before: 4 },
            { after: -1 },
            { before: 1.5 },
            { opacity: 256 },
            { falloff: 1.5 },
            { falloff: Number.NaN },
            { placement: "middle" as "front" },
        ]) {
            expect(() => setOnionSettings(patch), JSON.stringify(patch)).toThrow(RangeError);
        }
        expect(activeOnion()).toEqual(before);
    });

    it("a new sprite takes its onion settings from the preference store", async () => {
        const defaults: OnionSettings = {
            enabled: true,
            before: 2,
            after: 3,
            opacity: 99,
            falloff: 0.25,
            tint: true,
            placement: "front",
            withinTag: true,
        };
        preferences.set("onion", defaults);
        const done = command("file.new").run();
        const request = spriteDialogs.store.getState().request;
        if (request?.kind !== "new-sprite") throw new Error("no New sprite dialog");
        request.answer({ name: "n", width: 8, height: 8 });
        await done;
        expect(active().session.doc.settings.onion).toEqual(defaults);
        // A copy: changing the document leaves the preference.
        setOnionSettings({ before: 0 });
        expect(preferences.get("onion").before).toBe(2);
    });

    it("Apply Onion Skin Settings applies the change handed to it, outside the menus and without a key", async () => {
        const apply = command(ONION_SETTINGS_COMMAND);
        expect(apply.menuPath).toBeNull();
        expect(apply.shortcuts).toEqual([]);
        expect(keepsPlaying(ONION_SETTINGS_COMMAND)).toBe(true);
        sessionsStore.getState().open(createDocument({ name: "a", width: 4, height: 4 }));
        // Nothing handed to it: disabled.
        expect(apply.enabled()).toBe(false);
        let enabled = false;
        withOnionPatch({ before: 3, placement: "front" }, () => {
            enabled = apply.enabled();
            void apply.run();
        });
        expect(enabled).toBe(true);
        expect(activeOnion()).toMatchObject({ before: 3, placement: "front" });
        // Taken out again afterwards, also when the run throws.
        expect(onionEdit.getState().patch).toBeNull();
        expect(() =>
            withOnionPatch({ before: 9 }, () => {
                void apply.run();
            }),
        ).toThrow(RangeError);
        expect(onionEdit.getState().patch).toBeNull();
        expect(activeOnion()?.before).toBe(3);
    });
});

describe("what readers of the composites get with onion skin on", () => {
    it("the cache's composites have no ghost in them, also after tinted ghosts were read", () => {
        const sessions = createSessionsStore();
        const composites = createActiveComposites(sessions);
        const viewport = new OnionViewport();
        connectViewport(viewport, {
            sessions,
            preferences: createPreferenceStore(null),
            composites,
        });
        const session = sprite(3, { before: 1, after: 1, opacity: 255, tint: true });
        session.activeFrameId = "f2";
        sessions.getState().open(session);
        expect(viewport.ghosts.map((ghost) => ghost.key)).toEqual(["o-3:before", "f3:after"]);
        // The viewport reads the tinted ghosts, twice, as two uploads would.
        for (let round = 0; round < 2; round++) {
            for (const ghost of viewport.ghosts) viewport.document?.pixels(ghost.key);
        }
        // Every frame's composite as the cache hands it out equals the composite of the same
        // document with onion skin off.
        const off = structuredClone(session.doc);
        off.settings.onion.enabled = false;
        const cache = composites.cacheOf(session)!;
        for (const frame of session.doc.frames) {
            expect([...cache.get(frame.id).data], frame.id).toEqual([
                ...compositeFrame(off, frame.id).data,
            ]);
        }
        expect([...cache.get("f2").data]).toEqual([20, 20, 20, 255, 0, 0, 0, 0]);
    });

    it("reuses one buffer per tinted ghost, rewritten with the frame's pixels at each read", () => {
        const { sessions, viewport } = connect();
        const session = sprite(2, { before: 1, after: 0, tint: true });
        session.activeFrameId = "f2";
        const document = sessions.getState().open(session);
        const key = "o-3:before";
        const first = viewport.document!.pixels(key)!;
        expect([...first.data]).toEqual([133, 5, 5, 255, 0, 0, 0, 0]);
        // The frame changes: the same buffer, with the new pixels, the transparent one cleared.
        const transaction = document.history.begin({
            layerId: session.activeLayerId,
            frameId: "o-3",
        });
        transaction.image.data.set([0, 0, 0, 0, 0, 0, 0, 255]);
        transaction.markDirty({ x: 0, y: 0, width: 2, height: 1 });
        transaction.commit("Paint");
        const second = viewport.document!.pixels(key)!;
        expect(second.data).toBe(first.data);
        expect([...second.data]).toEqual([0, 0, 0, 0, 128, 0, 0, 255]);
        // A ghost no longer on screen lets its buffer go.
        sessions.getState().updateDocSettings(document.id, (settings) => {
            settings.onion.enabled = false;
        });
        sessions.getState().updateDocSettings(document.id, (settings) => {
            settings.onion.enabled = true;
        });
        expect(viewport.document!.pixels(key)!.data).not.toBe(first.data);
    });
});

describe("stroke echo: giving way to onion skins", () => {
    const checker = { a: 0x404040, b: 0x505050, size: 8 };
    // Opaque, translucent, transparent, translucent, transparent.
    const buffer: PixelBuffer = {
        width: 5,
        height: 1,
        data: Uint8ClampedArray.from([
            9, 9, 9, 255, 9, 9, 9, 128, 0, 0, 0, 0, 9, 9, 9, 128, 0, 0, 0, 0,
        ]),
    };
    const rect = { x: 0, y: 0, width: 5, height: 1 };
    const alphas = (data: Uint8ClampedArray) => [...data].filter((_, index) => index % 4 === 3);
    const pixel = (rgba: readonly number[]) => rgba;
    const CLEAR = [0, 0, 0, 0];
    const INK = [200, 0, 0, 255];

    /**
     * A 5×1 document of three frames, the second active: the ghost before it (frame 1) has
     * content in pixels 1 and 2, the ghost after it (frame 3) in pixel 2, frame 2 none.
     */
    function openWith(onion: Partial<OnionSettings>) {
        const session = sprite(3, onion, 5);
        session.activeFrameId = "f2";
        const images = session.doc.images;
        const fill = (imageId: string, pixels: (readonly number[])[]) =>
            images.set(imageId, {
                width: 5,
                height: 1,
                data: Uint8ClampedArray.from(pixels.flatMap(pixel)),
            });
        fill("image-0", [CLEAR, INK, INK, CLEAR, CLEAR]);
        fill("image-1", [CLEAR, CLEAR, CLEAR, CLEAR, CLEAR]);
        fill("image-2", [CLEAR, CLEAR, [0, 0, 200, 64], CLEAR, CLEAR]);
        return sessionsStore.getState().open(session);
    }

    it("covers the bounds of each ghost's content, not the whole canvas", () => {
        const document = openWith({ placement: "behind" });
        expect(onionCover(document, false)).toEqual({
            behind: [
                { x: 1, y: 0, width: 2, height: 1 },
                { x: 2, y: 0, width: 1, height: 1 },
            ],
            front: [],
        });
    });

    it("with ghosts behind draws only the opaque pixels over their content, every pixel elsewhere", () => {
        openWith({ placement: "behind" });
        expect(alphas(echoPixels(buffer, rect, checker, activeEchoCover()))).toEqual([
            255, 0, 0, 255, 255,
        ]);
    });

    it("with ghosts in front draws nothing over their content, every pixel elsewhere", () => {
        openWith({ placement: "front" });
        expect(alphas(echoPixels(buffer, rect, checker, activeEchoCover()))).toEqual([
            255, 0, 0, 255, 255,
        ]);
    });

    it("follows a change of a ghost's frame, told by the composite cache", () => {
        const document = openWith({ placement: "front" });
        expect(alphas(echoPixels(buffer, rect, checker, activeEchoCover()))[4]).toBe(255);
        const transaction = document.history.begin({
            layerId: document.session.activeLayerId,
            frameId: document.session.doc.frames[0]!.id,
        });
        transaction.image.data.set(INK, 4 * 4);
        transaction.markDirty({ x: 4, y: 0, width: 1, height: 1 });
        transaction.commit("Paint");
        expect(onionCover(document, false).front[0]).toEqual({ x: 1, y: 0, width: 4, height: 1 });
        expect(alphas(echoPixels(buffer, rect, checker, activeEchoCover()))).toEqual([
            255, 0, 0, 0, 0,
        ]);
    });

    it("draws every pixel while no ghost is on screen: onion off, no neighbour, or playing", () => {
        const off = openWith({ enabled: false });
        expect(onionCover(off, false)).toEqual({ behind: [], front: [] });
        // Every pixel, the transparent ones as the checkerboard.
        expect(alphas(echoPixels(buffer, rect, checker, activeEchoCover()))).toEqual([
            255, 255, 255, 255, 255,
        ]);
        sessionsStore.getState().close(off.id);
        // One frame: nothing around it.
        const single = sessionsStore.getState().open(sprite(1, { placement: "front" }, 5));
        expect(viewportGhosts(single.session)).toEqual([]);
        expect(onionCover(single, false)).toEqual({ behind: [], front: [] });
        sessionsStore.getState().close(single.id);
        // Playing hides the ghosts.
        const on = openWith({ placement: "front" });
        expect(onionCover(on, true)).toEqual({ behind: [], front: [] });
        expect(onionCover(on, false).front).toHaveLength(2);
    });
});
