import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "../../src/ui/platform/storage";
import {
    defaultTimelineHeight,
    isWindowTooSmall,
    parseStoredLayout,
    railColumns,
    railOneColumnHeight,
    resolveDockWidth,
    resolveTimelineHeight,
    timelineMaxHeight,
} from "../../src/ui/shell/layout";
import { createLayoutStore, LAYOUT_STORAGE_KEY } from "../../src/ui/shell/layoutStore";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
    data: Map<string, string>;
} {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => void data.set(key, value),
        removeItem: (key) => void data.delete(key),
    };
}

describe("shell layout (DESIGN §2)", () => {
    it("shows the too-small notice below 1280×720 only", () => {
        expect(isWindowTooSmall(1280, 720)).toBe(false);
        expect(isWindowTooSmall(1440, 900)).toBe(false);
        expect(isWindowTooSmall(1279, 720)).toBe(true);
        expect(isWindowTooSmall(1280, 719)).toBe(true);
    });

    it("defaults the timeline to min(200 px, 28% of the window height)", () => {
        expect(defaultTimelineHeight(900)).toBe(200);
        expect(defaultTimelineHeight(720)).toBe(200);
        expect(defaultTimelineHeight(600)).toBe(168);
    });

    it("keeps the timeline within 120 px and 50% of the window height", () => {
        expect(timelineMaxHeight(900)).toBe(450);
        expect(resolveTimelineHeight(null, 900)).toBe(200);
        expect(resolveTimelineHeight(300, 900)).toBe(300);
        expect(resolveTimelineHeight(40, 900)).toBe(120);
        expect(resolveTimelineHeight(700, 900)).toBe(450);
        expect(resolveTimelineHeight(400, 720)).toBe(360);
    });

    it("keeps the dock within 220 and 360 px, 264 px by default", () => {
        expect(resolveDockWidth(null)).toBe(264);
        expect(resolveDockWidth(300)).toBe(300);
        expect(resolveDockWidth(100)).toBe(220);
        expect(resolveDockWidth(900)).toBe(360);
    });

    it("measures the rail's one-column height from its groups and footer", () => {
        // DESIGN §5.1: 4 draw, 3 shape, 4 select and 2 navigate tools.
        expect(railOneColumnHeight([4, 3, 4, 2])).toBe(437);
        expect(railOneColumnHeight([4, 3, 4, 2], 28)).toBe(467);
        expect(railOneColumnHeight([])).toBe(16);
    });

    it("switches the rail to two columns only when one column does not fit", () => {
        expect(railColumns([4, 3, 4, 2], 0, 640)).toBe(1);
        expect(railColumns([4, 3, 4, 2], 0, 437)).toBe(1);
        expect(railColumns([4, 3, 4, 2], 0, 436)).toBe(2);
        // 1280×720 with the default timeline leaves 460 px: the colour chips tip it over.
        expect(railColumns([4, 3, 4, 2], 0, 460)).toBe(1);
        expect(railColumns([4, 3, 4, 2], 28, 460)).toBe(2);
    });
});

describe("persisted shell sizes", () => {
    it("reads a stored record and falls back per field on malformed values", () => {
        expect(parseStoredLayout({ dockWidth: 300, timelineHeight: 240 })).toEqual({
            dockWidth: 300,
            timelineHeight: 240,
        });
        expect(parseStoredLayout({ dockWidth: "wide", timelineHeight: -5 })).toEqual({
            dockWidth: null,
            timelineHeight: null,
        });
        for (const value of [undefined, null, 7, "x", [], { dockWidth: Number.NaN }]) {
            expect(parseStoredLayout(value)).toEqual({ dockWidth: null, timelineHeight: null });
        }
    });

    it("starts from defaults with an empty or corrupt store", () => {
        expect(createLayoutStore(memoryStorage()).getState()).toMatchObject({
            dockWidth: null,
            timelineHeight: null,
        });
        const corrupt = memoryStorage({ [LAYOUT_STORAGE_KEY]: "{not json" });
        expect(createLayoutStore(corrupt).getState()).toMatchObject({
            dockWidth: null,
            timelineHeight: null,
        });
        expect(createLayoutStore(null).getState().dockWidth).toBeNull();
    });

    it("writes every change and restores it in a new store", () => {
        const storage = memoryStorage();
        const store = createLayoutStore(storage);
        store.getState().setDockWidth(312);
        store.getState().setTimelineHeight(260);
        expect(JSON.parse(storage.data.get(LAYOUT_STORAGE_KEY) ?? "")).toEqual({
            dockWidth: 312,
            timelineHeight: 260,
        });
        expect(createLayoutStore(storage).getState()).toMatchObject({
            dockWidth: 312,
            timelineHeight: 260,
        });

        store.getState().setDockWidth(null);
        expect(createLayoutStore(storage).getState()).toMatchObject({
            dockWidth: null,
            timelineHeight: 260,
        });
    });

    it("keeps working when the store rejects writes", () => {
        const storage = memoryStorage();
        storage.setItem = () => {
            throw new Error("quota");
        };
        const store = createLayoutStore(storage);
        store.getState().setDockWidth(300);
        expect(store.getState().dockWidth).toBe(300);
    });
});
