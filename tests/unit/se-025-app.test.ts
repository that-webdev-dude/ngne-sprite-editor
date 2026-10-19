import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu, menuCommands } from "../../src/app/commands/menuModel";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import type { Command } from "../../src/app/commands/types";
import { activeOnion, setOnionSettings, viewportGhosts } from "../../src/app/onion/onion";
import { ONION_SKIN_COMMAND } from "../../src/app/onion/onion.commands";
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
});

describe("stroke echo: giving way to onion skins", () => {
    const checker = { a: 0x404040, b: 0x505050, size: 8 };
    // Opaque, translucent, transparent, opaque.
    const buffer: PixelBuffer = {
        width: 4,
        height: 1,
        data: Uint8ClampedArray.from([9, 9, 9, 255, 9, 9, 9, 128, 0, 0, 0, 0, 9, 9, 9, 255]),
    };
    const rect = { x: 0, y: 0, width: 4, height: 1 };
    const alphas = (data: Uint8ClampedArray) => [...data].filter((_, index) => index % 4 === 3);

    function openWith(onion: Partial<OnionSettings>, count = 3) {
        const session = sprite(count, onion, 4);
        session.activeFrameId = "f2";
        return sessionsStore.getState().open(session);
    }

    it("with ghosts behind draws only the opaque pixels, which hide them in NGNE too", () => {
        const document = openWith({ placement: "behind" });
        const cover = onionCover(document, false);
        expect(cover).toEqual({ behind: [{ x: 0, y: 0, width: 4, height: 1 }], front: [] });
        expect(alphas(echoPixels(buffer, rect, checker, activeEchoCover()))).toEqual([
            255, 0, 0, 255,
        ]);
    });

    it("with ghosts in front draws nothing", () => {
        openWith({ placement: "front" });
        expect(alphas(echoPixels(buffer, rect, checker, activeEchoCover()))).toEqual([0, 0, 0, 0]);
    });

    it("draws every pixel while no ghost is on screen: onion off, no neighbour, or playing", () => {
        const off = openWith({ enabled: false });
        expect(onionCover(off, false)).toEqual({ behind: [], front: [] });
        // Every pixel, the transparent one as the checkerboard.
        expect(alphas(echoPixels(buffer, rect, checker, activeEchoCover()))).toEqual([
            255, 255, 255, 255,
        ]);
        // One frame: nothing around it.
        const single = sprite(1);
        expect(viewportGhosts(single)).toEqual([]);
        // Playing hides the ghosts.
        sessionsStore.getState().close(off.id);
        const on = openWith({ placement: "front" });
        expect(onionCover(on, true)).toEqual({ behind: [], front: [] });
        expect(onionCover(on, false).front).toHaveLength(1);
    });
});
