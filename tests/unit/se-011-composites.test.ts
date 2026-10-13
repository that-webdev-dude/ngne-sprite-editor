import { describe, expect, it } from "vitest";
import { createActiveComposites } from "../../src/app/state/composites";
import { createSessionsStore } from "../../src/app/state/sessions";
import { createViewportLink, frameKey } from "../../src/app/viewport/viewportLink";
import type { ViewportLinkState } from "../../src/app/viewport/viewportLink";
import { compositeFrame } from "../../src/core/composite";
import { addFrameCommand } from "../../src/core/frames";
import { pixelPatchCommand } from "../../src/core/history";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, Touched } from "../../src/core/model";
import { createPixelBuffer } from "../../src/core/pixels";
import { RecordingViewport } from "./se-011-support";

// SE-011: what the rest of the app reaches without going through the viewport component —
// the composite cache of the active document (SPEC §5.3, one per active document) and the
// mounted viewport's size and `invalidate`.

function sprite(name: string, width = 4, height = 4): DocSession {
    return createDocument({ name, width, height }, sequentialIds(`${name}-`));
}

function setup() {
    const sessions = createSessionsStore();
    const composites = createActiveComposites(sessions);
    /** Opens `session` and paints its first cel `colour` (0xRRGGBBAA): one history step. */
    const openPainted = (session: DocSession, colour: number) => {
        const document = sessions.getState().open(session);
        const transaction = document.history.begin({
            layerId: session.activeLayerId,
            frameId: session.activeFrameId,
        });
        const { width, height } = session.doc;
        transaction.image.data.set(createPixelBuffer(width, height, colour).data);
        transaction.markDirty({ x: 0, y: 0, width, height });
        transaction.commit("Paint");
        return document;
    };
    return { sessions, composites, openPainted };
}

const firstPixel = (pixels: { data: Uint8ClampedArray } | undefined) => [
    ...(pixels?.data.slice(0, 4) ?? []),
];

describe("activeComposites: the cache of the active document", () => {
    it("has no cache while no document is open", () => {
        const { composites } = setup();
        expect(composites.cache).toBeNull();
        expect(composites.session).toBeNull();
        expect(composites.cacheOf(sprite("none"))).toBeNull();
        // Reporting a change is harmless.
        composites.invalidate({ frameIds: ["x"], layerIds: [], structure: false });
    });

    it("gives every reader the same cache for the active document", () => {
        const { composites, openPainted } = setup();
        const { session } = openPainted(sprite("hero"), 0xff0000ff);
        const cache = composites.cache;
        expect(cache?.doc).toBe(session.doc);
        expect(composites.cache).toBe(cache);
        expect(composites.cacheOf(session)).toBe(cache);
        expect(composites.session).toBe(session);
        // One composite, kept: a second reader gets the identical buffer.
        const composite = cache?.get(session.activeFrameId);
        expect(firstPixel(composite)).toEqual([255, 0, 0, 255]);
        expect(composites.cache?.get(session.activeFrameId)).toBe(composite);
    });

    it("keeps composites of the active document only", () => {
        const { sessions, composites, openPainted } = setup();
        const a = openPainted(sprite("a"), 0xff0000ff);
        const cacheA = composites.cache;
        cacheA?.get(a.session.activeFrameId);
        expect(cacheA?.bytes).toBeGreaterThan(0);

        const b = openPainted(sprite("b", 6, 2), 0x00ff00ff);
        expect(composites.cache?.doc).toBe(b.session.doc);
        expect(composites.cacheOf(b.session)).toBe(composites.cache);
        // The document left has no cache to hand out any more.
        expect(composites.cacheOf(a.session)).toBeNull();

        // Active again: a new, empty cache, not the one it had.
        sessions.getState().activate(a.id);
        expect(composites.cache?.doc).toBe(a.session.doc);
        expect(composites.cache).not.toBe(cacheA);
        expect(composites.cache?.bytes).toBe(0);

        sessions.getState().close(a.id);
        expect(composites.cache?.doc).toBe(b.session.doc);
        sessions.getState().close(b.id);
        expect(composites.cache).toBeNull();
    });

    it("treats the same file opened again as another document", () => {
        const { sessions, composites, openPainted } = setup();
        const first = openPainted(sprite("same"), 0xff0000ff);
        const before = composites.cache;
        const again = sessions.getState().replaceActive(sprite("same"));
        expect(composites.cache).not.toBe(before);
        expect(composites.cache?.doc).toBe(again.session.doc);
        expect(composites.cacheOf(first.session)).toBeNull();
    });
});

describe("activeComposites: changes", () => {
    it("drops what a history step touched before it tells its listeners", () => {
        const { composites, openPainted } = setup();
        const document = openPainted(sprite("hero"), 0xff0000ff);
        const { session, history } = document;
        const frameId = session.activeFrameId;
        const before = composites.cache?.get(frameId);

        const seen: { touched: Touched; fresh: number[]; session: DocSession }[] = [];
        const stop = composites.subscribe((touched, changed) => {
            // The cache is already up to date here.
            seen.push({
                touched,
                session: changed,
                fresh: firstPixel(composites.cache?.get(frameId)),
            });
        });
        const [cel] = [...session.doc.cels.values()];
        history.execute(
            pixelPatchCommand(session.doc, {
                label: "Patch",
                imageId: cel?.imageId ?? "",
                x: 0,
                y: 0,
                pixels: createPixelBuffer(1, 1, 0x0000ffff),
            }),
        );
        expect(seen).toHaveLength(1);
        expect(seen[0]?.touched.frameIds).toEqual([frameId]);
        expect(seen[0]?.session).toBe(session);
        expect(seen[0]?.fresh).toEqual([0, 0, 255, 255]);
        const after = composites.cache?.get(frameId);
        expect(after).not.toBe(before);
        expect(after).toEqual(compositeFrame(session.doc, frameId));
        // The buffer handed out before is not rewritten.
        expect(firstPixel(before)).toEqual([255, 0, 0, 255]);

        history.undo();
        expect(seen).toHaveLength(2);
        expect(seen[1]?.fresh).toEqual([255, 0, 0, 255]);
        history.redo();
        expect(seen).toHaveLength(3);

        stop();
        history.undo();
        expect(seen).toHaveLength(3);
    });

    it("reports a structure change and composites the frames as they are now", () => {
        const { composites, openPainted } = setup();
        const { session, history } = openPainted(sprite("hero"), 0xff0000ff);
        const first = session.activeFrameId;
        const changes: Touched[] = [];
        composites.subscribe((touched) => changes.push(touched));
        history.execute(addFrameCommand(session.doc, first, () => "second"));
        expect(changes).toHaveLength(1);
        expect(changes[0]?.structure).toBe(true);
        expect(firstPixel(composites.cache?.get(first))).toEqual([255, 0, 0, 255]);
        expect(composites.cache?.get("second").data.every((byte) => byte === 0)).toBe(true);
    });

    it("takes pixels written outside a command through invalidate", () => {
        const { composites, openPainted } = setup();
        const { session, history } = openPainted(sprite("hero"), 0xff0000ff);
        const frameId = session.activeFrameId;
        const before = composites.cache?.get(frameId);
        const changes: Touched[] = [];
        composites.subscribe((touched) => changes.push(touched));

        // An open stroke writes into the cel's image; no history step happens.
        const transaction = history.begin({ layerId: session.activeLayerId, frameId });
        transaction.image.data.set([0, 255, 0, 255], 0);
        expect(composites.cache?.get(frameId)).toBe(before);
        const touched = {
            frameIds: [frameId],
            layerIds: [session.activeLayerId],
            structure: false,
        };
        composites.invalidate(touched);
        expect(changes).toEqual([touched]);
        expect(firstPixel(composites.cache?.get(frameId))).toEqual([0, 255, 0, 255]);

        // The abort puts the pixels back, and is reported the same way.
        transaction.abort();
        composites.invalidate(touched);
        expect(changes).toHaveLength(2);
        expect(firstPixel(composites.cache?.get(frameId))).toEqual([255, 0, 0, 255]);
    });

    it("does not report steps of a document that is not the active one", () => {
        const { composites, openPainted } = setup();
        const a = openPainted(sprite("a"), 0xff0000ff);
        openPainted(sprite("b"), 0x00ff00ff);
        const changes: Touched[] = [];
        composites.subscribe((touched) => changes.push(touched));
        a.history.undo();
        expect(changes).toEqual([]);
    });

    it("serves no stale composite to a listener that runs before it is told of a step", () => {
        const { sessions, composites, openPainted } = setup();
        const { session, history, id } = openPainted(sprite("hero"), 0xff0000ff);
        const frameId = session.activeFrameId;
        composites.cache?.get(frameId);
        // The session store hears of a step before this module does; a subscriber of the
        // store that reads a composite right there must not get the one from before it.
        const read: number[][] = [];
        const stop = sessions.subscribe(() => {
            if (sessions.getState().activeId === id) {
                read.push(firstPixel(composites.cache?.get(frameId)));
            }
        });
        const [cel] = [...session.doc.cels.values()];
        history.execute(
            pixelPatchCommand(session.doc, {
                label: "Patch",
                imageId: cel?.imageId ?? "",
                x: 0,
                y: 0,
                pixels: createPixelBuffer(1, 1, 0x0000ffff),
            }),
        );
        stop();
        expect(read).toEqual([[0, 0, 255, 255]]);
        expect(firstPixel(composites.cache?.get(frameId))).toEqual([0, 0, 255, 255]);
    });

    it("stops following the stores when disposed", () => {
        const { composites, openPainted } = setup();
        const { history } = openPainted(sprite("hero"), 0xff0000ff);
        const changes: Touched[] = [];
        composites.subscribe((touched) => changes.push(touched));
        composites.dispose();
        history.undo();
        expect(changes).toEqual([]);
    });
});

describe("viewportLink: the mounted viewport", () => {
    it("has no viewport and no size until one is mounted", () => {
        const link = createViewportLink();
        expect(link.mounted).toBe(false);
        expect(link.deviceSize).toEqual({ width: 0, height: 0 });
        // Nothing to tell: harmless.
        link.invalidate([frameKey("f1")]);
        link.invalidate("all");
    });

    it("reaches the mounted viewport's invalidate", () => {
        const link = createViewportLink();
        const viewport = new RecordingViewport();
        const mount = link.mount(viewport, { width: 1132, height: 604 });
        expect(link.mounted).toBe(true);
        link.invalidate([frameKey("f1"), frameKey("f2")]);
        link.invalidate("all");
        expect(viewport.take()).toEqual(["invalidate f1:plain,f2:plain", "invalidate all"]);

        mount.unmount();
        link.invalidate("all");
        expect(viewport.take()).toEqual([]);
        expect(link.mounted).toBe(false);
        expect(link.deviceSize).toEqual({ width: 0, height: 0 });
    });

    it("reports the size of the viewport element and tells listeners when it changes", () => {
        const link = createViewportLink();
        const heard: ViewportLinkState[] = [];
        const stop = link.subscribe((state) => heard.push(state));
        const mount = link.mount(new RecordingViewport(), { width: 0, height: 0 });
        mount.resize({ width: 1132, height: 604 });
        expect(link.deviceSize).toEqual({ width: 1132, height: 604 });
        expect(link.store.getState().deviceSize).toEqual({ width: 1132, height: 604 });
        // The same size again is not a change.
        mount.resize({ width: 1132, height: 604 });
        mount.resize({ width: 1698, height: 906 });
        mount.unmount();
        expect(heard.map((state) => `${state.mounted} ${state.deviceSize.width}`)).toEqual([
            "true 0",
            "true 1132",
            "true 1698",
            "false 0",
        ]);
        stop();
        link.mount(new RecordingViewport(), { width: 10, height: 10 });
        expect(heard).toHaveLength(4);
    });

    it("keeps the viewport mounted last when an earlier one goes", () => {
        const link = createViewportLink();
        const first = new RecordingViewport();
        const second = new RecordingViewport();
        const firstMount = link.mount(first, { width: 100, height: 100 });
        link.mount(second, { width: 200, height: 200 });
        // The first one is torn down afterwards: it does not take the second with it.
        firstMount.resize({ width: 1, height: 1 });
        firstMount.unmount();
        expect(link.mounted).toBe(true);
        expect(link.deviceSize).toEqual({ width: 200, height: 200 });
        link.invalidate("all");
        expect(first.take()).toEqual([]);
        expect(second.take()).toEqual(["invalidate all"]);
    });
});
