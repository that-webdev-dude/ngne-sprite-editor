import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionsStore, DEFAULT_VIEW } from "../../src/app/state/sessions";
import { connectAutoFit } from "../../src/app/view/autoFit";
import { fitView } from "../../src/app/view/navigate";
import { createViewportRegion, createViewportSize } from "../../src/app/view/viewportSize";
import { createViewportLink } from "../../src/app/viewport/viewportLink";
import { createDocument } from "../../src/core/model";

// SE-012: new and opened documents start fitted and centred. The fit applies only to a
// document whose view was never set. It needs the viewport's size: the mounted viewport's
// (`viewportLink`), or else that of the region it fills, which the interface observes also
// while no document is open. With a size known a document is fitted in the task that opens
// it; without one the fit waits for the first size reported.

const SIZE = { width: 972, height: 424 };
const viewportStub = { invalidate() {} };

function sprite(name: string, width = 32, height = 32) {
    return createDocument({ name, width, height });
}

function setup() {
    const sessions = createSessionsStore();
    const link = createViewportLink();
    const region = createViewportRegion();
    const stop = connectAutoFit({ sessions, viewport: createViewportSize(link, region) });
    const view = (id: string) =>
        sessions.getState().documents.find((document) => document.id === id)?.view;
    const viewSet = (id: string) =>
        sessions.getState().documents.find((document) => document.id === id)?.viewSet;
    return { sessions, link, region, stop, view, viewSet };
}

/** Lets the task run in which the subscribers of a size are told of it. */
const sizeDelivered = () => void vi.runAllTimers();

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("the view of a document: set or never set", () => {
    it("is never set for a document opened without a view", () => {
        const sessions = createSessionsStore();
        const document = sessions.getState().open(sprite("hero"));
        expect(document.viewSet).toBe(false);
        // Not set, though it has the values a view starts with.
        expect(document.view).toEqual(DEFAULT_VIEW);
    });

    it("is set by the view option of open, also when it names the starting values", () => {
        const sessions = createSessionsStore();
        expect(sessions.getState().open(sprite("a"), { view: { scale: 12 } }).viewSet).toBe(true);
        expect(sessions.getState().open(sprite("b"), { view: { ...DEFAULT_VIEW } }).viewSet).toBe(
            true,
        );
        expect(sessions.getState().open(sprite("c"), { view: {} }).viewSet).toBe(true);
    });

    it("is set by setView, also to the starting values, and by nothing else", () => {
        const sessions = createSessionsStore();
        const { id } = sessions.getState().open(sprite("hero"));
        const current = () => sessions.getState().documents[0];
        sessions.getState().touch(id);
        sessions.getState().markSaved(id);
        sessions.getState().updateDocSettings(id, (settings) => {
            settings.pixelGrid = !settings.pixelGrid;
        });
        expect(current()?.viewSet).toBe(false);
        sessions.getState().setView(id, { ...DEFAULT_VIEW });
        expect(current()?.viewSet).toBe(true);
        expect(current()?.view).toEqual(DEFAULT_VIEW);
    });

    it("is never set for the document that replaces the active one", () => {
        const sessions = createSessionsStore();
        const first = sessions.getState().open(sprite("first"));
        sessions.getState().setView(first.id, { scale: 4 });
        expect(sessions.getState().replaceActive(sprite("second")).viewSet).toBe(false);
    });
});

describe("auto-fit with the viewport's size known", () => {
    it("fits the first document in the task that opens it, before any viewport is mounted", () => {
        const { sessions, region, view, viewSet } = setup();
        // The interface observes the region while no document is open.
        region.report(SIZE);
        const opened = sessions.getState().open(sprite("hero"));
        expect(view(opened.id)).toEqual({ scale: 12, originX: 294, originY: 20 });
        expect(view(opened.id)).toEqual(fitView({ width: 32, height: 32 }, SIZE));
        expect(viewSet(opened.id)).toBe(true);
        // What `open` returned was made before the fit; the store holds the fitted document.
        expect(sessions.getState().documents[0]?.revision).toBe(1);
        // The fit did not wait for the task that tells of the size, which is still to come
        // and then finds nothing left to fit.
        expect(vi.getTimerCount()).toBe(1);
        sizeDelivered();
        expect(sessions.getState().documents[0]?.revision).toBe(1);
    });

    it("fits a document opened while a viewport is mounted, for that viewport's size", () => {
        const { sessions, link, view } = setup();
        link.mount(viewportStub, SIZE);
        const { id } = sessions.getState().open(sprite("tiles", 256, 64));
        // 256 × 3 = 768 fits 972, 256 × 4 does not.
        expect(view(id)).toEqual({ scale: 3, originX: 102, originY: 116 });
        expect(sessions.getState().documents[0]?.viewSet).toBe(true);
    });

    it("keeps the view a document was opened with, and a view set after it was opened", () => {
        const { sessions, link, region, view } = setup();
        region.report(SIZE);
        const given = sessions.getState().open(sprite("given"), { view: { scale: 3 } });
        expect(view(given.id)).toEqual({ scale: 3, originX: 0, originY: 0 });
        // As the SE-011 tests do: open, then set the view in the next step.
        const set = sessions.getState().open(sprite("set"));
        sessions.getState().setView(set.id, { scale: 8, originX: 40, originY: 24 });
        expect(view(set.id)).toEqual({ scale: 8, originX: 40, originY: 24 });
        // The viewport mounts and reports a size of its own: nothing is fitted again.
        link.mount(viewportStub, { width: 0, height: 0 }).resize({ width: 970, height: 420 });
        sizeDelivered();
        expect(view(given.id)).toEqual({ scale: 3, originX: 0, originY: 0 });
        expect(view(set.id)).toEqual({ scale: 8, originX: 40, originY: 24 });
    });

    it("fits the document that replaces the active one, and one opened in the background", () => {
        const { sessions, link, view } = setup();
        link.mount(viewportStub, SIZE);
        const first = sessions.getState().open(sprite("first"));
        sessions.getState().setView(first.id, { scale: 2, originX: 5, originY: 6 });
        const second = sessions.getState().replaceActive(sprite("second", 8, 8));
        expect(view(second.id)).toEqual(fitView({ width: 8, height: 8 }, SIZE));
        const third = sessions.getState().open(sprite("third", 64, 64), { activate: false });
        expect(view(third.id)).toEqual(fitView({ width: 64, height: 64 }, SIZE));
        expect(sessions.getState().activeId).toBe(second.id);
    });

    it("fits once: a later size, or a view the user changed, is not fitted again", () => {
        const { sessions, link, view } = setup();
        const mounted = link.mount(viewportStub, SIZE);
        const { id } = sessions.getState().open(sprite("hero"));
        const fitted = view(id);
        mounted.resize({ width: 1400, height: 800 });
        sizeDelivered();
        expect(view(id)).toBe(fitted);
        sessions.getState().setView(id, { scale: 2, originX: -30, originY: 7 });
        mounted.resize({ width: 600, height: 300 });
        sizeDelivered();
        expect(view(id)).toEqual({ scale: 2, originX: -30, originY: 7 });
    });

    it("tells the subscribers of the store once per fitted document", () => {
        const { sessions, link } = setup();
        link.mount(viewportStub, SIZE);
        const revisions: number[] = [];
        sessions.subscribe((state) => revisions.push(state.documents[0]?.revision ?? -1));
        sessions.getState().open(sprite("hero"));
        // The fit (revision 1) reaches the subscriber, and nothing follows it.
        expect(Math.max(...revisions)).toBe(1);
        sizeDelivered();
        expect(sessions.getState().documents[0]?.revision).toBe(1);
    });

    it("fits what is already open when it is connected", () => {
        const sessions = createSessionsStore();
        const link = createViewportLink();
        link.mount(viewportStub, SIZE);
        const { id } = sessions.getState().open(sprite("hero"));
        connectAutoFit({ sessions, viewport: createViewportSize(link, createViewportRegion()) });
        expect(sessions.getState().documents.find((document) => document.id === id)?.view).toEqual(
            fitView({ width: 32, height: 32 }, SIZE),
        );
    });
});

describe("auto-fit without a size: it waits for the first one", () => {
    it("fits and centres when the mounted viewport reports its first size", () => {
        const { sessions, link, view, viewSet } = setup();
        const { id } = sessions.getState().open(sprite("hero"));
        // No viewport yet, then a viewport that is not laid out yet.
        expect(view(id)).toEqual(DEFAULT_VIEW);
        const mounted = link.mount(viewportStub, { width: 0, height: 0 });
        sizeDelivered();
        expect(view(id)).toEqual(DEFAULT_VIEW);
        expect(viewSet(id)).toBe(false);

        mounted.resize(SIZE);
        // The size is acted on in a task of its own, not where it is reported.
        expect(view(id)).toEqual(DEFAULT_VIEW);
        sizeDelivered();
        expect(view(id)).toEqual({ scale: 12, originX: 294, originY: 20 });
        expect(viewSet(id)).toBe(true);
    });

    it("keeps a view set through the store before the first size", () => {
        const { sessions, link, view } = setup();
        const { id } = sessions.getState().open(sprite("hero"));
        sessions.getState().setView(id, { scale: 8, originX: 40, originY: 24 });
        link.mount(viewportStub, { width: 0, height: 0 }).resize(SIZE);
        sizeDelivered();
        expect(view(id)).toEqual({ scale: 8, originX: 40, originY: 24 });
    });

    it("keeps a view set between the report of the size and the task that acts on it", () => {
        const { sessions, region, view } = setup();
        const { id } = sessions.getState().open(sprite("hero"));
        region.report(SIZE);
        sessions.getState().setView(id, { scale: 6, originX: 30, originY: 18 });
        sizeDelivered();
        expect(view(id)).toEqual({ scale: 6, originX: 30, originY: 18 });
    });

    it("keeps a set view that equals the starting values: it is the state that counts", () => {
        const { sessions, link, view } = setup();
        const { id } = sessions.getState().open(sprite("hero"));
        sessions.getState().setView(id, { scale: 1, originX: 0, originY: 0 });
        link.mount(viewportStub, SIZE);
        sizeDelivered();
        expect(view(id)).toEqual({ scale: 1, originX: 0, originY: 0 });
    });

    it("fits every document that waited, each for its own size", () => {
        const { sessions, region, view } = setup();
        const a = sessions.getState().open(sprite("a", 32, 32));
        const b = sessions.getState().open(sprite("b", 1024, 1024));
        const c = sessions.getState().open(sprite("c", 5, 3));
        sessions.getState().setView(b.id, { scale: 2 });
        region.report(SIZE);
        sizeDelivered();
        expect(view(a.id)).toEqual(fitView({ width: 32, height: 32 }, SIZE));
        expect(view(b.id)).toEqual({ scale: 2, originX: 0, originY: 0 });
        expect(view(c.id)).toEqual(fitView({ width: 5, height: 3 }, SIZE));
    });

    it("does nothing while the viewport is hidden (no size), and fits when it is back", () => {
        const { sessions, link, region, view } = setup();
        // Laid out, then hidden: the window became too small.
        region.report(SIZE);
        region.report({ width: 0, height: 0 });
        sizeDelivered();
        const first = sessions.getState().open(sprite("first"));
        expect(view(first.id)).toEqual(DEFAULT_VIEW);
        region.report({ width: 972, height: 0 });
        sizeDelivered();
        expect(view(first.id)).toEqual(DEFAULT_VIEW);
        region.report(SIZE);
        sizeDelivered();
        expect(view(first.id)).toEqual(fitView({ width: 32, height: 32 }, SIZE));

        // Hidden again: a document opened now waits for the first size from either source,
        // here the mounted viewport's.
        region.report({ width: 0, height: 0 });
        const second = sessions.getState().open(sprite("second"));
        expect(view(second.id)).toEqual(DEFAULT_VIEW);
        const larger = { width: 1192, height: 604 };
        link.mount(viewportStub, { width: 0, height: 0 }).resize(larger);
        sizeDelivered();
        expect(view(second.id)).toEqual(fitView({ width: 32, height: 32 }, larger));
        expect(view(first.id)).toEqual(fitView({ width: 32, height: 32 }, SIZE));
    });

    it("stops when it is disconnected, and leaves no timer behind", () => {
        const { sessions, region, stop, view } = setup();
        const waiting = sessions.getState().open(sprite("waiting"));
        region.report(SIZE);
        expect(vi.getTimerCount()).toBe(1);
        stop();
        expect(vi.getTimerCount()).toBe(0);
        sizeDelivered();
        expect(view(waiting.id)).toEqual(DEFAULT_VIEW);
        const { id } = sessions.getState().open(sprite("hero"));
        expect(view(id)).toEqual(DEFAULT_VIEW);
    });
});

describe("the size of the viewport", () => {
    it("is the mounted viewport's size while it has one, otherwise the region's", () => {
        const link = createViewportLink();
        const region = createViewportRegion();
        const size = createViewportSize(link, region);
        expect(size.size).toEqual({ width: 0, height: 0 });
        region.report(SIZE);
        expect(size.size).toEqual(SIZE);
        const mounted = link.mount(viewportStub, { width: 0, height: 0 });
        // Mounted, not measured yet: the region's size stands.
        expect(size.size).toEqual(SIZE);
        mounted.resize({ width: 970, height: 424 });
        expect(size.size).toEqual({ width: 970, height: 424 });
        mounted.unmount();
        expect(size.size).toEqual(SIZE);
        region.report({ width: 0, height: 0 });
        expect(size.size).toEqual({ width: 0, height: 0 });
    });

    it("tells its subscribers in a task of their own, once for the reports of one task", () => {
        const link = createViewportLink();
        const region = createViewportRegion();
        const size = createViewportSize(link, region);
        const seen: unknown[] = [];
        const stop = size.subscribe(() => seen.push({ ...size.size }));

        // Two observers report in one delivery: the region and the mounted viewport.
        region.report(SIZE);
        const mounted = link.mount(viewportStub, { width: 0, height: 0 });
        mounted.resize(SIZE);
        // Nothing is run where the sizes are reported …
        expect(seen).toEqual([]);
        // … though the size itself is current at once.
        expect(size.size).toEqual(SIZE);
        sizeDelivered();
        expect(seen).toEqual([SIZE]);

        // The same size again is no news.
        region.report({ ...SIZE });
        mounted.resize({ ...SIZE });
        sizeDelivered();
        expect(seen).toEqual([SIZE]);

        mounted.resize({ width: 600, height: 300 });
        sizeDelivered();
        expect(seen).toEqual([SIZE, { width: 600, height: 300 }]);

        stop();
        region.report({ width: 1, height: 1 });
        mounted.resize({ width: 2, height: 2 });
        sizeDelivered();
        expect(seen.length).toBe(2);
    });
});
