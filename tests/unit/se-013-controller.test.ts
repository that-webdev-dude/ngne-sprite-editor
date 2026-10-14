import { describe, expect, it, vi } from "vitest";
import { createOverlayController } from "../../src/app/overlay/overlayController";
import type { OverlaySources } from "../../src/app/overlay/overlayController";
import { stretchedMapping } from "../../src/app/overlay/stretchedMapping";
import { DEFAULT_OVERLAY_THEME } from "../../src/app/overlay/types";
import type { OverlayFrame, OverlayLayer } from "../../src/app/overlay/types";
import { activeDocument, createSessionsStore } from "../../src/app/state/sessions";
import { createViewMapping } from "../../src/app/view/coordinates";
import { createDocument, sequentialIds } from "../../src/core/model";

// SE-013: when the overlay redraws. Only a change of the view, of the cursor or a layer's
// request redraws it, at most once per animation frame; a change of the canvas's size draws
// at once. The canvas, the animation frames and the mapping are stand-ins here.

/** A 2D context that records what the controller itself does with it. */
function recordingContext() {
    const calls: string[] = [];
    let depth = 0;
    const context = {
        calls,
        get depth() {
            return depth;
        },
        clearRect: (x: number, y: number, width: number, height: number) =>
            void calls.push(`clear ${x},${y},${width}x${height}`),
        save: () => {
            depth++;
            calls.push("save");
        },
        restore: () => {
            depth--;
            calls.push("restore");
        },
    };
    return context;
}

/** Layers that record their draws; `request` asks for a redraw as a layer's `watch` would. */
function recordingLayer(id: string, order: number, log: string[]) {
    let request: (() => void) | null = null;
    const frames: OverlayFrame[] = [];
    const stop = vi.fn();
    const layer: OverlayLayer = {
        id,
        order,
        draw(frame) {
            log.push(id);
            frames.push(frame);
        },
        watch(redraw) {
            request = redraw;
            return stop;
        },
    };
    return { layer, frames, stop, request: () => request?.() };
}

const RATIO = 1.5;
/** The viewport element's corner in client coordinates: device pixels 66, 108. */
const LEFT = 44;
const TOP = 72;

/** The client position of a device position of the viewport element. */
function clientAt(x: number, y: number) {
    return { x: (x + LEFT * RATIO) / RATIO, y: (y + TOP * RATIO) / RATIO };
}

/** Where the viewport element lies: device pixels per CSS pixel and its corner, CSS pixels. */
interface Placement {
    ratio: number;
    left: number;
    top: number;
}

function setup(
    layers: OverlayLayer[] = [],
    { ratio, left, top }: Placement = { ratio: RATIO, left: LEFT, top: TOP },
) {
    const sessions = createSessionsStore();
    const canvas = { width: 0, height: 0 };
    const context = recordingContext();
    const frames: (() => void)[] = [];
    const errors: string[] = [];
    let surface = true;
    const sources: OverlaySources = {
        sessions,
        mapping() {
            const document = activeDocument(sessions.getState());
            if (!document || !surface) return null;
            const { width, height } = document.session.doc;
            return createViewMapping({
                view: document.view,
                docWidth: width,
                docHeight: height,
                ratio,
                left,
                top,
            });
        },
        ratio: () => ratio,
        nextFrame(callback) {
            frames.push(callback);
            return () => {
                const at = frames.indexOf(callback);
                if (at >= 0) frames.splice(at, 1);
            };
        },
        onError: (layer, error) => void errors.push(`${layer}: ${String(error)}`),
    };
    const controller = createOverlayController(
        canvas,
        context as unknown as CanvasRenderingContext2D,
        layers,
        sources,
    );
    /** Runs the animation frames that are due; returns how many ran. */
    const frame = () => {
        const due = frames.splice(0);
        for (const callback of due) callback();
        return due.length;
    };
    const open = (view = { scale: 8, originX: 40, originY: 24 }) =>
        sessions
            .getState()
            .open(createDocument({ name: "hero", width: 5, height: 3 }, sequentialIds("h-")), {
                view,
            });
    return {
        sessions,
        canvas,
        context,
        controller,
        frame,
        frames,
        errors,
        open,
        setSurface: (value: boolean) => void (surface = value),
    };
}

describe("overlay redraws", () => {
    it("draws once after it is created and then nothing while nothing changes", () => {
        const log: string[] = [];
        const { layer } = recordingLayer("a", 1, log);
        const { controller, frame, open, canvas } = setup([layer]);
        open();
        canvas.width = 300;
        canvas.height = 200;
        expect(controller.pending).toBe(true);
        expect(controller.redraws).toBe(0);
        expect(frame()).toBe(1);
        expect(controller.redraws).toBe(1);
        expect(log).toEqual(["a"]);
        expect(controller.pending).toBe(false);
        // Idle: no frame is asked for, nothing is drawn.
        for (let index = 0; index < 5; index++) expect(frame()).toBe(0);
        expect(controller.redraws).toBe(1);
    });

    it("draws a new size of the canvas at once, in the same task, and only a new size", () => {
        const log: string[] = [];
        const { layer } = recordingLayer("a", 1, log);
        const { controller, frame, open, canvas, context } = setup([layer]);
        open();
        frame();
        context.calls.length = 0;
        const before = controller.redraws;
        controller.resize({ width: 640, height: 360 });
        expect(canvas).toEqual({ width: 640, height: 360 });
        expect(controller.size).toEqual({ width: 640, height: 360 });
        expect(controller.redraws).toBe(before + 1);
        expect(context.calls[0]).toBe("clear 0,0,640x360");
        // A redraw that was scheduled is taken by the one done now.
        controller.requestRedraw();
        controller.resize({ width: 641, height: 360 });
        expect(controller.pending).toBe(false);
        expect(frame()).toBe(0);
        expect(controller.redraws).toBe(before + 2);
        controller.resize({ width: 641, height: 360 });
        expect(controller.redraws).toBe(before + 2);
        expect(frame()).toBe(0);
    });

    it("redraws when the view changes, once per animation frame however many changes", () => {
        const { controller, frame, open, sessions, canvas } = setup();
        const document = open();
        canvas.width = 300;
        canvas.height = 200;
        frame();
        const before = controller.redraws;
        sessions.getState().setView(document.id, { originX: 41 });
        sessions.getState().setView(document.id, { scale: 12 });
        sessions.getState().setView(document.id, { originY: -3 });
        expect(controller.pending).toBe(true);
        expect(frame()).toBe(1);
        expect(controller.redraws).toBe(before + 1);
        // The same view set again is no change.
        sessions.getState().setView(document.id, { scale: 12, originX: 41, originY: -3 });
        expect(controller.pending).toBe(false);
    });

    it("redraws when the document's size changes or another document becomes the active one", () => {
        const { controller, frame, open, sessions } = setup();
        const first = open();
        frame();
        let count = controller.redraws;
        const second = sessions
            .getState()
            .open(createDocument({ name: "other", width: 5, height: 3 }, sequentialIds("o-")), {
                view: { scale: 8, originX: 40, originY: 24 },
            });
        expect(frame()).toBe(1);
        expect(controller.redraws).toBe(++count);
        sessions.getState().activate(first.id);
        expect(frame()).toBe(1);
        expect(controller.redraws).toBe(++count);
        // The size of the document is part of what is drawn (the outline).
        first.session.doc.width = 7;
        sessions.getState().touch(first.id);
        expect(frame()).toBe(1);
        expect(controller.redraws).toBe(++count);
        sessions.getState().close(first.id);
        sessions.getState().close(second.id);
        expect(frame()).toBe(1);
        expect(controller.redraws).toBe(count + 1);
    });

    it("does not redraw for a history step, a setting or a change of another document", () => {
        const { controller, frame, open, sessions } = setup();
        const document = open();
        frame();
        const before = controller.redraws;
        const { session, history } = document;
        const transaction = history.begin({
            layerId: session.activeLayerId,
            frameId: session.activeFrameId,
        });
        transaction.image.data.fill(255);
        transaction.markDirty({ x: 0, y: 0, width: 5, height: 3 });
        transaction.commit("Paint");
        history.undo();
        sessions.getState().updateDocSettings(document.id, (settings) => {
            settings.pixelGrid = !settings.pixelGrid;
        });
        sessions.getState().markSaved(document.id);
        const other = sessions
            .getState()
            .open(createDocument({ name: "other", width: 2, height: 2 }, sequentialIds("o-")), {
                activate: false,
            });
        sessions.getState().setView(other.id, { scale: 4 });
        expect(controller.pending).toBe(false);
        expect(frame()).toBe(0);
        expect(controller.redraws).toBe(before);
    });

    it("redraws when the cursor moves to another device pixel, enters or leaves", () => {
        const { controller, frame, open } = setup();
        open();
        frame();
        let count = controller.redraws;
        // Device pixel 100, 60 at a ratio of 1.5 spans client 66.67 … 67.33.
        controller.setCursor({ x: 100 / RATIO, y: 60 / RATIO });
        expect(frame()).toBe(1);
        expect(controller.redraws).toBe(++count);
        controller.setCursor({ x: 100.5 / RATIO, y: 60.9 / RATIO });
        expect(controller.pending).toBe(false);
        controller.setCursor({ x: 101 / RATIO, y: 60.9 / RATIO });
        controller.setCursor({ x: 102 / RATIO, y: 61 / RATIO });
        expect(frame()).toBe(1);
        expect(controller.redraws).toBe(++count);
        controller.setCursor(null);
        expect(frame()).toBe(1);
        expect(controller.redraws).toBe(count + 1);
        controller.setCursor(null);
        expect(controller.pending).toBe(false);
    });

    it("redraws when a layer asks for it, and for a new theme", () => {
        const log: string[] = [];
        const watched = recordingLayer("watched", 1, log);
        const { controller, frame, open } = setup([watched.layer]);
        open();
        controller.resize({ width: 100, height: 100 });
        frame();
        const before = controller.redraws;
        watched.request();
        watched.request();
        expect(frame()).toBe(1);
        expect(controller.redraws).toBe(before + 1);
        controller.setTheme({ ...DEFAULT_OVERLAY_THEME });
        expect(controller.pending).toBe(false);
        controller.setTheme({ outline: 0xb4b4ba, ink: 0 });
        expect(frame()).toBe(1);
        expect(controller.redraws).toBe(before + 2);
        expect(watched.frames.at(-1)?.theme).toEqual({ outline: 0xb4b4ba, ink: 0 });
    });

    it("stops redrawing and stops the layers' watches when disposed", () => {
        const log: string[] = [];
        const watched = recordingLayer("watched", 1, log);
        const { controller, frame, open, sessions, frames } = setup([watched.layer]);
        const document = open();
        controller.requestRedraw();
        controller.dispose();
        expect(frames).toHaveLength(0);
        expect(watched.stop).toHaveBeenCalledTimes(1);
        watched.request();
        sessions.getState().setView(document.id, { scale: 2 });
        controller.setCursor({ x: 3, y: 4 });
        controller.resize({ width: 10, height: 10 });
        expect(frame()).toBe(0);
        expect(controller.redraws).toBe(0);
    });
});

describe("the cursor's device pixel", () => {
    it("is the one the mapping names, with Chrome's float noise settled (ratio 1.25)", () => {
        const log: string[] = [];
        const { layer, frames: drawn } = recordingLayer("a", 1, log);
        const ratio = 1.25;
        const { controller, frame, open } = setup([layer], { ratio, left: 0, top: 0 });
        open();
        controller.resize({ width: 300, height: 200 });
        // A mouse on device pixel n, as Chrome reports it at 1.25: n times the 32-bit
        // reciprocal of the ratio, as a 32-bit float. Device pixel 102 arrives just short of
        // 81.6 CSS pixels, which the ratio alone puts in device pixel 101.
        const client = (n: number) => Math.fround(n * Math.fround(1 / ratio));
        expect(client(102)).toBe(81.5999984741211);
        expect(Math.floor(client(102) * ratio)).toBe(101);
        controller.setCursor({ x: client(101), y: client(40) });
        expect(frame()).toBe(1);
        expect(drawn.at(-1)?.cursor?.device).toEqual({ x: 101, y: 40 });
        const before = controller.redraws;

        // 101 → 102: another device pixel, so a redraw, which names 102.
        controller.setCursor({ x: client(102), y: client(40) });
        expect(controller.pending).toBe(true);
        expect(frame()).toBe(1);
        expect(controller.redraws).toBe(before + 1);
        expect(drawn.at(-1)?.cursor?.device.x).toBe(102);
        expect(drawn.at(-1)?.cursor?.pixel).toEqual({ x: 7, y: 2 });
    });

    it("comes from the ratio alone while no document is open", () => {
        const { controller, frame } = setup([], { ratio: 2, left: 0, top: 0 });
        frame();
        controller.setCursor({ x: 10, y: 10 });
        expect(frame()).toBe(1);
        // 10.2 and 10.4 CSS pixels are device pixel 20 at a ratio of 2; 10.5 is 21.
        controller.setCursor({ x: 10.2, y: 10.4 });
        expect(controller.pending).toBe(false);
        controller.setCursor({ x: 10.5, y: 10.4 });
        expect(frame()).toBe(1);
    });
});

describe("a canvas stretched over its box", () => {
    // After a resize NGNE keeps its old canvas on screen, stretched over the new box, and
    // keeps drawing the view on it: the document rectangle is the view's, in that canvas's
    // backing pixels. The overlay has the same backing size and box.

    it("draws the document rectangle as NGNE drew it and maps the pointer to the canvas pixel under it", () => {
        const log: string[] = [];
        const { layer, frames: drawn } = recordingLayer("a", 1, log);
        const { controller, frame, open } = setup([layer], { ratio: 1, left: 0, top: 0 });
        open({ scale: 8, originX: 40, originY: 24 });
        // A box of 400 × 400 device pixels, a canvas of 200 × 100: stretched 2× and 4×.
        controller.setBox({ width: 400, height: 400 });
        controller.resize({ width: 200, height: 100 });
        controller.setCursor({ x: 100, y: 120 });
        frame();
        const stretched = drawn.at(-1)!;
        expect(stretched.size).toEqual({ width: 200, height: 100 });
        expect(stretched.mapping.rect).toEqual({ x: 40, y: 24, width: 40, height: 24 });
        expect(stretched.mapping.docToDevice(1, 1)).toEqual({ x: 48, y: 32 });
        expect(stretched.cursor?.device).toEqual({ x: 50, y: 30 });
        expect(stretched.cursor?.pixel).toEqual({ x: 1, y: 0 });
        expect(stretched.mapping.clientToDoc(100, 120)).toEqual({ x: 1, y: 0 });
        expect(stretched.mapping.docToClient(1, 0)).toEqual({ x: 96, y: 96 });
        expect(stretched.mapping.deviceToClient(50, 30)).toEqual({ x: 100, y: 120 });

        // NGNE's new canvas has the box's size: the mapping of the viewport itself.
        controller.resize({ width: 400, height: 400 });
        const swapped = drawn.at(-1)!;
        expect(swapped.size).toEqual({ width: 400, height: 400 });
        expect(swapped.mapping.rect).toEqual({ x: 40, y: 24, width: 40, height: 24 });
        expect(swapped.cursor?.device).toEqual({ x: 100, y: 120 });
        expect(swapped.cursor?.pixel).toEqual({ x: 7, y: 12 });
    });

    it("redraws when the box changes, and not for the same box", () => {
        const { controller, frame, open } = setup();
        open();
        controller.resize({ width: 200, height: 100 });
        frame();
        const before = controller.redraws;
        controller.setBox({ width: 200, height: 100 });
        expect(frame()).toBe(1);
        controller.setBox({ width: 200, height: 100 });
        expect(controller.pending).toBe(false);
        controller.setBox({ width: 240, height: 100 });
        expect(frame()).toBe(1);
        expect(controller.redraws).toBe(before + 2);
        // The canvas keeps its size: it follows NGNE's canvas, not the box.
        expect(controller.size).toEqual({ width: 200, height: 100 });
    });

    it("is the viewport's own mapping while the sizes agree or one is not known", () => {
        const base = createViewMapping({
            view: { scale: 4, originX: 3, originY: 5 },
            docWidth: 10,
            docHeight: 10,
            ratio: 1.5,
            left: 44,
            top: 72,
        });
        const same = { width: 640, height: 480 };
        expect(stretchedMapping(base, same, { ...same })).toBe(base);
        expect(stretchedMapping(base, same, { width: 0, height: 0 })).toBe(base);
        expect(stretchedMapping(base, { width: 0, height: 0 }, same)).toBe(base);
        const stretched = stretchedMapping(base, same, { width: 1280, height: 480 });
        expect(stretched).not.toBe(base);
        expect(stretched.rect).toBe(base.rect);
        expect(stretched.clientToDevice(44 + 20, 72 + 20)).toEqual({ x: 15, y: 30 });
    });
});

describe("what a redraw draws", () => {
    it("clears the canvas and runs the layers bottom first, each between save and restore", () => {
        const log: string[] = [];
        const layers = [
            recordingLayer("top", 300, log),
            recordingLayer("bottom", 100, log),
            recordingLayer("middle", 200, log),
        ];
        // The controller draws in the order it is given; the registry sorts (overlayLayers).
        const sorted = [layers[1], layers[2], layers[0]].map((entry) => entry!.layer);
        const { controller, frame, open, context } = setup(sorted);
        open();
        frame();
        context.calls.length = 0;
        log.length = 0;
        controller.resize({ width: 320, height: 240 });
        expect(log).toEqual(["bottom", "middle", "top"]);
        expect(context.calls).toEqual([
            "clear 0,0,320x240",
            "save",
            "restore",
            "save",
            "restore",
            "save",
            "restore",
        ]);
        expect(context.depth).toBe(0);
    });

    it("gives the layers the document, its mapping on screen, the cursor, the size and the theme", () => {
        const log: string[] = [];
        const { layer, frames } = recordingLayer("a", 1, log);
        const { controller, frame, open } = setup([layer]);
        const document = open({ scale: 8, originX: 40, originY: 24 });
        controller.setCursor(clientAt(40 + 8 * 3 + 2, 24 + 8 * 1));
        controller.resize({ width: 320, height: 240 });
        frame();
        const drawn = frames.at(-1)!;
        expect(drawn.document.id).toBe(document.id);
        expect(drawn.size).toEqual({ width: 320, height: 240 });
        expect(drawn.mapping.rect).toEqual({ x: 40, y: 24, width: 40, height: 24 });
        expect(drawn.cursor?.pixel).toEqual({ x: 3, y: 1 });
        expect(drawn.cursor?.device.x).toBeCloseTo(40 + 8 * 3 + 2, 6);
        expect(drawn.theme).toEqual(DEFAULT_OVERLAY_THEME);
        controller.setCursor(null);
        frame();
        expect(frames.at(-1)?.cursor).toBeNull();
    });

    it("only clears while no document is open, the viewport is not on the page or has no size", () => {
        const log: string[] = [];
        const { layer } = recordingLayer("a", 1, log);
        const { controller, frame, open, setSurface, sessions, context } = setup([layer]);
        controller.resize({ width: 200, height: 100 });
        expect(log).toEqual([]);
        const document = open();
        frame();
        expect(log).toEqual(["a"]);
        setSurface(false);
        sessions.getState().setView(document.id, { scale: 3 });
        context.calls.length = 0;
        frame();
        expect(log).toEqual(["a"]);
        expect(context.calls).toEqual(["clear 0,0,200x100"]);
        setSurface(true);
        controller.resize({ width: 0, height: 100 });
        expect(log).toEqual(["a"]);
    });

    it("draws the other layers when one throws, and reports each failure once", () => {
        const log: string[] = [];
        const before = recordingLayer("before", 1, log);
        const after = recordingLayer("after", 3, log);
        const failing: OverlayLayer = {
            id: "failing",
            order: 2,
            draw() {
                throw new Error("broken");
            },
        };
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { controller, frame, open, errors, context } = setup([
                before.layer,
                failing,
                after.layer,
            ]);
            open();
            controller.resize({ width: 50, height: 50 });
            controller.requestRedraw();
            frame();
            expect(log).toEqual(["before", "after", "before", "after"]);
            expect(errors).toEqual(["failing: Error: broken"]);
            expect(quiet).toHaveBeenCalledTimes(1);
            expect(context.depth).toBe(0);
        } finally {
            quiet.mockRestore();
        }
    });
});
