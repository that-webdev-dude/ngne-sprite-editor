import type { StoreApi } from "zustand/vanilla";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionsStore, DEFAULT_VIEW } from "../../src/app/state/sessions";
import type { SessionsState, ViewState } from "../../src/app/state/sessions";
import { fitView, MIN_VISIBLE, visibleExtent } from "../../src/app/view/navigate";
import { connectViewPolicy } from "../../src/app/view/viewPolicy";
import { createViewportRegion, createViewportSize } from "../../src/app/view/viewportSize";
import { createViewportLink } from "../../src/app/viewport/viewportLink";
import { createDocument } from "../../src/core/model";

// SE-012: the views a document gets without the user navigating.
//
// Fit: new and opened documents start fitted and centred; only a document whose view was
// never set is fitted, and once. Pan limit: at least 32 device pixels of the active document
// stay visible, also after the viewport changed its size and when a document becomes the
// active one; the view is moved then, never fitted.
//
// Both need the viewport's size: the mounted viewport's (`viewportLink`), or else that of the
// region it fills, which the interface observes also while no document is open. With a size
// known a document has its view in the task that opens or activates it — the session store
// applies the policy itself — and without one it waits for the first size reported.

const SIZE = { width: 972, height: 424 };
/** The viewport of a 1500 × 900 window. */
const LARGE = { width: 1192, height: 604 };
const viewportStub = { invalidate() {} };

function sprite(name: string, width = 32, height = 32) {
    return createDocument({ name, width, height });
}

function setup() {
    const sessions = createSessionsStore();
    const link = createViewportLink();
    const region = createViewportRegion();
    const stop = connectViewPolicy({ sessions, viewport: createViewportSize(link, region) });
    const record = (id: string) => {
        const found = sessions.getState().documents.find((document) => document.id === id);
        if (!found) throw new Error(`no document ${id}`);
        return found;
    };
    const view = (id: string) => record(id).view;
    return { sessions, link, region, stop, record, view };
}

/** What a subscriber of the store is told: the document's view and revision, and who is active. */
interface Told {
    activeId: string | null;
    view: ViewState | undefined;
    revision: number | undefined;
}

/** Records what `store` tells a subscriber about the document `id` (or the first one). */
function listen(store: StoreApi<SessionsState>, id?: () => string | undefined): Told[] {
    const told: Told[] = [];
    store.subscribe((state) => {
        const wanted = id?.();
        const document = wanted
            ? state.documents.find((entry) => entry.id === wanted)
            : state.documents[0];
        told.push({
            activeId: state.activeId,
            view: document?.view,
            revision: document?.revision,
        });
    });
    return told;
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
        sessions.getState().activate(id);
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

    it("a store without a view policy leaves every view as it is", () => {
        const sessions = createSessionsStore();
        const far = { scale: 16, originX: 90_000, originY: -90_000 };
        const a = sessions.getState().open(sprite("a"), { view: far });
        const b = sessions.getState().open(sprite("b"));
        sessions.getState().activate(a.id);
        sessions.getState().close(a.id);
        expect(a.view).toEqual(far);
        expect(sessions.getState().documents).toEqual([b]);
        expect(sessions.getState().documents[0]).toBe(b);
    });
});

describe("open and replaceActive return the document as the store holds it", () => {
    it("returns the fitted record: the view, the state and the revision the store has", () => {
        const { sessions, region } = setup();
        region.report(SIZE);
        const opened = sessions.getState().open(sprite("hero"));
        expect(opened).toBe(sessions.getState().documents[0]);
        expect(opened.view).toEqual({ scale: 12, originX: 294, originY: 20 });
        expect(opened.viewSet).toBe(true);
        // Stored once, with its view: nothing came after the opening.
        expect(opened.revision).toBe(0);

        const replaced = sessions.getState().replaceActive(sprite("wide", 256, 64));
        expect(replaced).toBe(sessions.getState().documents[0]);
        expect(replaced.view).toEqual({ scale: 3, originX: 102, originY: 116 });
        expect(replaced.viewSet).toBe(true);
        expect(replaced.revision).toBe(0);

        const background = sessions.getState().open(sprite("back", 8, 8), { activate: false });
        expect(background).toBe(sessions.getState().documents[1]);
        expect(background.view).toEqual(fitView({ width: 8, height: 8 }, SIZE));
    });

    it("returns the stored record when a subscriber changed the document as it was opened", () => {
        const sessions = createSessionsStore();
        // A subscriber that gives every new document a view of its own.
        sessions.subscribe((state) => {
            for (const document of state.documents) {
                if (!document.viewSet) state.setView(document.id, { scale: 7 });
            }
        });
        const opened = sessions.getState().open(sprite("hero"));
        expect(opened).toBe(sessions.getState().documents[0]);
        expect(opened.view).toEqual({ scale: 7, originX: 0, originY: 0 });
        expect(opened.revision).toBe(1);

        const replaced = sessions.getState().replaceActive(sprite("next"));
        expect(replaced).toBe(sessions.getState().documents[0]);
        expect(replaced.view.scale).toBe(7);
        // With no active document to replace, `replaceActive` opens.
        sessions.getState().close(replaced.id);
        const again = sessions.getState().replaceActive(sprite("again"));
        expect(again).toBe(sessions.getState().documents[0]);
        expect(again.view.scale).toBe(7);
    });

    it("returns the stored record of a store without a policy, as before", () => {
        const sessions = createSessionsStore();
        const opened = sessions.getState().open(sprite("hero"));
        expect(opened).toBe(sessions.getState().documents[0]);
        expect(opened.revision).toBe(0);
        expect(sessions.getState().replaceActive(sprite("next"))).toBe(
            sessions.getState().documents[0],
        );
    });
});

describe("fit with the viewport's size known", () => {
    it("fits the first document in the task that opens it, before any viewport is mounted", () => {
        const { sessions, region, record, view } = setup();
        // The interface observes the region while no document is open.
        region.report(SIZE);
        const opened = sessions.getState().open(sprite("hero"));
        expect(view(opened.id)).toEqual({ scale: 12, originX: 294, originY: 20 });
        expect(view(opened.id)).toEqual(fitView({ width: 32, height: 32 }, SIZE));
        expect(record(opened.id).viewSet).toBe(true);
        // The fit did not wait for the task that tells of the size, which is still to come
        // and then finds nothing left to fit.
        expect(vi.getTimerCount()).toBe(1);
        sizeDelivered();
        expect(record(opened.id)).toBe(opened);
    });

    it("fits a document opened while a viewport is mounted, for that viewport's size", () => {
        const { sessions, link, region, view } = setup();
        region.report(LARGE);
        link.mount(viewportStub, SIZE);
        const { id } = sessions.getState().open(sprite("tiles", 256, 64));
        // 256 × 3 = 768 fits 972, 256 × 4 does not.
        expect(view(id)).toEqual({ scale: 3, originX: 102, originY: 116 });
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

    it("fits once: neither a later size nor a view the user changed is fitted again", () => {
        const { sessions, link, record, view } = setup();
        const mounted = link.mount(viewportStub, SIZE);
        const { id } = sessions.getState().open(sprite("hero"));
        const fitted = record(id);
        mounted.resize({ width: 1400, height: 800 });
        sizeDelivered();
        // Not even touched: the record is the one that was opened.
        expect(record(id)).toBe(fitted);
        sessions.getState().setView(id, { scale: 2, originX: -30, originY: 7 });
        mounted.resize({ width: 600, height: 300 });
        sizeDelivered();
        expect(view(id)).toEqual({ scale: 2, originX: -30, originY: 7 });
    });

    it("tells every subscriber of the store once per opened document, and it is the fitted one", () => {
        const sessions = createSessionsStore();
        const region = createViewportRegion();
        // One subscriber from before the policy, one from after it.
        const early = listen(sessions);
        connectViewPolicy({
            sessions,
            viewport: createViewportSize(createViewportLink(), region),
        });
        const late = listen(sessions);
        region.report(SIZE);

        const opened = sessions.getState().open(sprite("hero"));
        const fitted = { scale: 12, originX: 294, originY: 20 };
        for (const told of [early, late]) {
            expect(told).toEqual([{ activeId: opened.id, view: fitted, revision: 0 }]);
        }
        // The task that tells of the size brings nothing more.
        sizeDelivered();
        expect([early.length, late.length]).toEqual([1, 1]);

        // The same for the document that replaces it.
        const next = sessions.getState().replaceActive(sprite("wide", 256, 64));
        for (const told of [early, late]) {
            expect(told.slice(1)).toEqual([
                { activeId: next.id, view: { scale: 3, originX: 102, originY: 116 }, revision: 0 },
            ]);
        }
    });

    it("fits what is already open when it is connected", () => {
        const sessions = createSessionsStore();
        const link = createViewportLink();
        link.mount(viewportStub, SIZE);
        const { id } = sessions.getState().open(sprite("hero"));
        connectViewPolicy({
            sessions,
            viewport: createViewportSize(link, createViewportRegion()),
        });
        expect(sessions.getState().documents.find((document) => document.id === id)?.view).toEqual(
            fitView({ width: 32, height: 32 }, SIZE),
        );
    });
});

describe("fit without a size: it waits for the first one", () => {
    it("fits and centres when the mounted viewport reports its first size", () => {
        const { sessions, link, record, view } = setup();
        const { id } = sessions.getState().open(sprite("hero"));
        // No viewport yet, then a viewport that is not laid out yet.
        expect(view(id)).toEqual(DEFAULT_VIEW);
        const mounted = link.mount(viewportStub, { width: 0, height: 0 });
        sizeDelivered();
        expect(view(id)).toEqual(DEFAULT_VIEW);
        expect(record(id).viewSet).toBe(false);

        mounted.resize(SIZE);
        // The size is acted on in a task of its own, not where it is reported.
        expect(view(id)).toEqual(DEFAULT_VIEW);
        sizeDelivered();
        expect(view(id)).toEqual({ scale: 12, originX: 294, originY: 20 });
        expect(record(id).viewSet).toBe(true);
    });

    it("tells every subscriber once of the opening and once of the fit, in that order", () => {
        const sessions = createSessionsStore();
        const region = createViewportRegion();
        const early = listen(sessions);
        connectViewPolicy({
            sessions,
            viewport: createViewportSize(createViewportLink(), region),
        });
        const late = listen(sessions);
        const { id } = sessions.getState().open(sprite("hero"));
        region.report(SIZE);
        sizeDelivered();
        for (const told of [early, late]) {
            expect(told).toEqual([
                { activeId: id, view: DEFAULT_VIEW, revision: 0 },
                { activeId: id, view: { scale: 12, originX: 294, originY: 20 }, revision: 1 },
            ]);
        }
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

    it("fits every document that waited, each for its own size, active or not", () => {
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

    it("fits a waiting document that becomes the active one once the size is there", () => {
        const { sessions, region, view } = setup();
        const a = sessions.getState().open(sprite("a"));
        const b = sessions.getState().open(sprite("b", 8, 8));
        // The size is reported; before the task that acts on it, the user switches documents.
        region.report(SIZE);
        sessions.getState().activate(a.id);
        expect(view(a.id)).toEqual(fitView({ width: 32, height: 32 }, SIZE));
        expect(view(b.id)).toEqual(DEFAULT_VIEW);
        sizeDelivered();
        expect(view(b.id)).toEqual(fitView({ width: 8, height: 8 }, SIZE));
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
        link.mount(viewportStub, { width: 0, height: 0 }).resize(LARGE);
        sizeDelivered();
        expect(view(second.id)).toEqual(fitView({ width: 32, height: 32 }, LARGE));
        expect(view(first.id)).toEqual(fitView({ width: 32, height: 32 }, SIZE));
    });
});

describe("pan limit after the viewport changed its size", () => {
    /** A 32 × 32 document fitted in the large viewport (16×) and panned to its bottom-right limit. */
    function pannedToTheCorner() {
        const context = setup();
        context.region.report(LARGE);
        const { id } = context.sessions.getState().open(sprite("hero"));
        expect(context.view(id)).toEqual({ scale: 16, originX: 340, originY: 46 });
        const corner = { scale: 16, originX: 1192 - 32, originY: 604 - 32 };
        context.sessions.getState().setView(id, corner);
        sizeDelivered();
        expect(context.view(id)).toEqual(corner);
        return { ...context, id, corner };
    }

    it("moves the active document back inside when the viewport shrinks", () => {
        const { region, record, view, id, corner } = pannedToTheCorner();
        // The window shrinks: nothing of the document would be left in 972 × 424.
        expect(visibleExtent(corner, { width: 32, height: 32 }, SIZE)).toEqual({
            width: 0,
            height: 0,
        });
        region.report(SIZE);
        // Acted on in a task of its own, not where the size is reported.
        expect(view(id)).toEqual(corner);
        sizeDelivered();
        expect(view(id)).toEqual({ scale: 16, originX: 972 - 32, originY: 424 - 32 });
        expect(visibleExtent(view(id), { width: 32, height: 32 }, SIZE)).toEqual({
            width: MIN_VISIBLE,
            height: MIN_VISIBLE,
        });
        // Moved, not fitted: the zoom is the user's, and the view stays a set one.
        expect(view(id).scale).toBe(16);
        expect(record(id).viewSet).toBe(true);
    });

    it("follows the mounted viewport's size as well as the region's", () => {
        const { link, region, view, id } = pannedToTheCorner();
        const mounted = link.mount(viewportStub, LARGE);
        mounted.resize({ width: 944, height: 264 });
        region.report({ width: 944, height: 264 });
        sizeDelivered();
        expect(view(id)).toEqual({ scale: 16, originX: 944 - 32, originY: 264 - 32 });
    });

    it("leaves a view inside the limits alone: the record is not even replaced", () => {
        const { sessions, region, record } = setup();
        region.report(LARGE);
        const { id } = sessions.getState().open(sprite("hero"));
        sessions.getState().setView(id, { scale: 8, originX: 40, originY: 24 });
        const before = record(id);
        const told = listen(sessions);
        region.report(SIZE);
        sizeDelivered();
        region.report({ width: 300, height: 200 });
        sizeDelivered();
        expect(record(id)).toBe(before);
        expect(told).toEqual([]);
        // The fitted view of a document is inside the limits of a larger viewport too.
        const other = sessions.getState().open(sprite("other"));
        const fitted = record(other.id);
        region.report(LARGE);
        sizeDelivered();
        expect(record(other.id)).toBe(fitted);
    });

    it("keeps a document smaller than 32 device pixels visible in full", () => {
        const { sessions, region, view } = setup();
        region.report(LARGE);
        const { id } = sessions.getState().open(sprite("dot", 8, 5));
        sessions.getState().setView(id, { scale: 1, originX: 1192 - 8, originY: 604 - 5 });
        region.report(SIZE);
        sizeDelivered();
        expect(view(id)).toEqual({ scale: 1, originX: 972 - 8, originY: 424 - 5 });
    });

    it("does nothing while the viewport has no size, and acts when it has one again", () => {
        const { region, view, id, corner } = pannedToTheCorner();
        region.report({ width: 0, height: 0 });
        sizeDelivered();
        expect(view(id)).toEqual(corner);
        region.report(SIZE);
        sizeDelivered();
        expect(view(id)).toEqual({ scale: 16, originX: 940, originY: 392 });
    });

    it("moves a view that was set before any size was known, at the first size", () => {
        const { sessions, region, view } = setup();
        const given = sessions.getState().open(sprite("given"), {
            view: { scale: 16, originX: 5000, originY: -5000 },
        });
        expect(view(given.id)).toEqual({ scale: 16, originX: 5000, originY: -5000 });
        region.report(SIZE);
        sizeDelivered();
        // 32 × 16 = 512 device pixels a side: 32 of them stay at the right and at the top.
        expect(view(given.id)).toEqual({ scale: 16, originX: 972 - 32, originY: 32 - 512 });
    });
});

describe("pan limit when a document becomes the active one", () => {
    /** Document `a` panned to the corner of the large viewport, `b` active, the viewport small. */
    function twoDocuments() {
        const context = setup();
        const { sessions, region } = context;
        region.report(LARGE);
        const a = sessions.getState().open(sprite("a"));
        const corner = { scale: 16, originX: 1160, originY: 572 };
        sessions.getState().setView(a.id, corner);
        const b = sessions.getState().open(sprite("b", 8, 8));
        region.report(SIZE);
        sizeDelivered();
        return { ...context, a, b, corner };
    }

    it("moves only the active document at a size change: the other keeps its view", () => {
        const { sessions, view, a, b, corner } = twoDocuments();
        expect(sessions.getState().activeId).toBe(b.id);
        // Nothing of `a` would be visible, and nobody is looking at it.
        expect(view(a.id)).toEqual(corner);
        // `b`, fitted for the large viewport (64×, 512 px a side), still shows most of itself
        // in the small one: it is inside the limits and keeps its view.
        expect(view(b.id)).toEqual({ scale: 64, originX: 340, originY: 46 });
        expect(view(b.id)).toEqual(fitView({ width: 8, height: 8 }, LARGE));
    });

    it("moves a document back inside as it is activated, in the same change of the store", () => {
        const { sessions, record, view, a, corner } = twoDocuments();
        const before = record(a.id);
        const told = listen(sessions, () => a.id);
        sessions.getState().activate(a.id);
        const inside = { scale: 16, originX: 940, originY: 392 };
        expect(view(a.id)).toEqual(inside);
        expect(record(a.id).viewSet).toBe(true);
        // One change: subscribers never see `a` active with the view that shows nothing.
        expect(told).toEqual([{ activeId: a.id, view: inside, revision: before.revision + 1 }]);
        expect(told[0]?.view).not.toEqual(corner);

        // Activating it again, or a document whose view is inside, moves nothing.
        const settled = record(a.id);
        sessions.getState().activate(a.id);
        expect(record(a.id)).toBe(settled);
    });

    it("moves the neighbour that becomes active when the active document is closed", () => {
        const { sessions, view, a, b } = twoDocuments();
        const told = listen(sessions, () => a.id);
        sessions.getState().close(b.id);
        expect(sessions.getState().activeId).toBe(a.id);
        expect(view(a.id)).toEqual({ scale: 16, originX: 940, originY: 392 });
        expect(told.length).toBe(1);
        expect(told[0]?.view).toEqual({ scale: 16, originX: 940, originY: 392 });
    });

    it("leaves a document that is closed in the background, and the active one, alone", () => {
        const { sessions, record, a, b } = twoDocuments();
        const active = record(b.id);
        sessions.getState().close(a.id);
        expect(sessions.getState().activeId).toBe(b.id);
        expect(record(b.id)).toBe(active);
    });

    it("moves a view passed to open, as the document opens; not one opened in the background", () => {
        const { sessions, region, record, view } = setup();
        region.report(SIZE);
        const far = { scale: 16, originX: 1160, originY: 572 };
        const told = listen(sessions);
        const opened = sessions.getState().open(sprite("opened"), { view: far });
        expect(opened).toBe(record(opened.id));
        expect(opened.view).toEqual({ scale: 16, originX: 940, originY: 392 });
        expect(opened.viewSet).toBe(true);
        expect(opened.revision).toBe(0);
        expect(told.length).toBe(1);

        const background = sessions.getState().open(sprite("back"), {
            view: far,
            activate: false,
        });
        expect(background.view).toEqual(far);
        sessions.getState().activate(background.id);
        expect(view(background.id)).toEqual({ scale: 16, originX: 940, originY: 392 });

        const replaced = sessions.getState().replaceActive(sprite("replaced"), { view: far });
        expect(replaced.view).toEqual({ scale: 16, originX: 940, originY: 392 });
        expect(replaced).toBe(record(replaced.id));
    });

    it("does not move a view while the viewport has no size", () => {
        const { sessions, region, view, a, corner } = twoDocuments();
        region.report({ width: 0, height: 0 });
        sessions.getState().activate(a.id);
        expect(view(a.id)).toEqual(corner);
    });
});

describe("the view policy of a store", () => {
    it("stops when it is disconnected, and leaves no timer behind", () => {
        const { sessions, region, stop, view } = setup();
        const waiting = sessions.getState().open(sprite("waiting"));
        region.report(SIZE);
        expect(vi.getTimerCount()).toBe(1);
        stop();
        expect(vi.getTimerCount()).toBe(0);
        sizeDelivered();
        expect(view(waiting.id)).toEqual(DEFAULT_VIEW);
        // Neither a fit at open nor a move at activation.
        const far = { scale: 16, originX: 5000, originY: 5000 };
        const opened = sessions.getState().open(sprite("hero"));
        const given = sessions.getState().open(sprite("given"), { view: far });
        sessions.getState().activate(opened.id);
        sessions.getState().activate(given.id);
        expect(view(opened.id)).toEqual(DEFAULT_VIEW);
        expect(view(given.id)).toEqual(far);
    });

    it("is the one connected last; disconnecting an earlier one leaves it in use", () => {
        // As a component that mounts, unmounts and mounts again does.
        const sessions = createSessionsStore();
        const small = createViewportRegion();
        const large = createViewportRegion();
        const stopFirst = connectViewPolicy({
            sessions,
            viewport: createViewportSize(createViewportLink(), small),
        });
        connectViewPolicy({
            sessions,
            viewport: createViewportSize(createViewportLink(), large),
        });
        small.report(SIZE);
        large.report(LARGE);
        stopFirst();
        const opened = sessions.getState().open(sprite("hero"));
        expect(opened.view).toEqual(fitView({ width: 32, height: 32 }, LARGE));
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
