import { describe, expect, it } from "vitest";
import { createToolState } from "../../src/app/tools/activeTool";
import { createToolPipeline } from "../../src/app/tools/pipeline";
import type { PointerInput } from "../../src/app/tools/pipeline";
import { createToolRegistry } from "../../src/app/tools/registry";
import { pencilTool } from "../../src/app/tools/pencil/pencil.tools";
import { createStrokeEcho } from "../../src/app/tools/strokeEcho";
import type { EchoTarget, StrokeEcho } from "../../src/app/tools/strokeEcho";
import { echoPixels, STROKE_ECHO_ORDER } from "../../src/app/tools/strokeEcho.overlay";
import { overlayLayers } from "../../src/app/overlay/overlayLayers";
import { createActiveComposites } from "../../src/app/state/composites";
import { createEditorStore } from "../../src/app/state/editor";
import { activeDocument, createSessionsStore } from "../../src/app/state/sessions";
import { createStatusStore } from "../../src/app/state/status";
import { createViewMapping } from "../../src/app/view/coordinates";
import { frameKey } from "../../src/app/viewport/viewportLink";
import { compositeFrame } from "../../src/core/composite";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import { ViewportSlots, replaceSceneDocument } from "../../src/engine/viewport/viewportSlots";
import type { Scene } from "../../src/engine/viewport/viewportSlots";
import { bitmap, FakeRenderer, flush } from "./se-011-support";
import { manualFrames, manualTimers } from "./se-014-support";

// SE-015: the overlay stroke echo of SPEC §6.6. A region of a stroke is echoed from the moment
// it is composited until the viewport has drawn an upload that contains it — read at a
// version at least the region's; a later change in the same place keeps it echoed until an
// upload contains that change. Cancel, and any change of the frame after the stroke, clear it
// at once. The viewport carries the version of each upload to the frame it draws.

const FRAME_KEY = "frame:plain";

function target(session: DocSession = { doc: null, selection: null } as never): EchoTarget {
    return {
        session,
        frameId: "frame",
        buffer: { width: 4, height: 4, data: new Uint8ClampedArray(64) },
        prepare() {},
    };
}

/** An echo whose versions count from 1. */
function echo(): { echo: StrokeEcho; notified: () => number } {
    let version = 0;
    let notified = 0;
    const value = createStrokeEcho({ nextVersion: () => ++version });
    value.subscribe(() => notified++);
    return { echo: value, notified: () => notified };
}

const versions = (value: StrokeEcho) => value.regions().map((region) => region.version);

describe("the echo's clear rule", () => {
    it("clears a region only when an upload of its version or later is drawn", () => {
        const { echo: value, notified } = echo();
        value.start(target());
        value.composited({ x: 0, y: 0, width: 1, height: 1 });
        value.composited({ x: 2, y: 0, width: 1, height: 1 });
        expect(versions(value)).toEqual([1, 2]);
        // Another key, or a frame with no version: nothing is on screen through NGNE.
        value.drawn("other:plain", 9);
        value.drawn(FRAME_KEY, undefined);
        expect(versions(value)).toEqual([1, 2]);
        // An upload read before the first region: neither.
        value.drawn(FRAME_KEY, 0);
        expect(versions(value)).toEqual([1, 2]);
        const before = notified();
        value.drawn(FRAME_KEY, 1);
        expect(versions(value)).toEqual([2]);
        expect(notified()).toBe(before + 1);
        value.drawn(FRAME_KEY, 2);
        expect(versions(value)).toEqual([]);
    });

    it("keeps a place echoed while a later change there has not been drawn", () => {
        const { echo: value } = echo();
        value.start(target());
        const place = { x: 1, y: 1, width: 2, height: 2 };
        value.composited(place);
        value.composited(place);
        value.drawn(FRAME_KEY, 1);
        expect(value.regions()).toEqual([{ rect: place, version: 2 }]);
        value.drawn(FRAME_KEY, 2);
        expect(value.regions()).toEqual([]);
    });

    it("after the stroke, keeps its regions until they are drawn, and a later change of the frame clears them at once", () => {
        const { echo: value } = echo();
        const session = { doc: null, selection: null } as never as DocSession;
        value.start(target(session));
        value.composited({ x: 0, y: 0, width: 1, height: 1 });
        // The stroke's own history step comes while it is still under way: ignored.
        value.touched(session, { frameIds: ["frame"], layerIds: [], structure: false });
        expect(versions(value)).toEqual([1]);
        value.release();
        expect(value.stroking).toBe(false);
        expect(value.target).not.toBeNull();
        // Another frame's change, or another session's: not this echo's.
        value.touched(session, { frameIds: ["other"], layerIds: [], structure: false });
        value.touched({} as DocSession, { frameIds: ["frame"], layerIds: [], structure: false });
        expect(versions(value)).toEqual([1]);
        // Undo, redo or any command on the frame.
        value.touched(session, { frameIds: ["frame"], layerIds: [], structure: false });
        expect(value.regions()).toEqual([]);
        expect(value.target).toBeNull();
    });

    it("ends when its last region is drawn after the stroke", () => {
        const { echo: value } = echo();
        value.start(target());
        value.composited({ x: 0, y: 0, width: 1, height: 1 });
        value.release();
        value.drawn(FRAME_KEY, 1);
        expect(value.target).toBeNull();
    });

    it("clears at once on clear (a cancel); echoes nothing while switched off", () => {
        const { echo: value, notified } = echo();
        value.start(target());
        value.composited({ x: 0, y: 0, width: 1, height: 1 });
        const before = notified();
        value.clear();
        expect(value.regions()).toEqual([]);
        expect(value.target).toBeNull();
        expect(notified()).toBe(before + 1);

        value.enabled = false;
        value.start(target());
        value.composited({ x: 0, y: 0, width: 1, height: 1 });
        value.changed();
        expect(value.target).toBeNull();
        expect(value.regions()).toEqual([]);
    });

    it("a new stroke on the same frame keeps the regions of the one before; on another frame drops them", () => {
        const { echo: value } = echo();
        const session = { doc: null, selection: null } as never as DocSession;
        value.start(target(session));
        value.composited({ x: 0, y: 0, width: 1, height: 1 });
        value.release();
        value.start(target(session));
        expect(versions(value)).toEqual([1]);
        value.release();
        value.start({ ...target(session), frameId: "other" });
        expect(value.regions()).toEqual([]);
    });
});

describe("the echo through the pointer pipeline", () => {
    /** A pipeline with the pencil, an echo and a viewport that records the version of each upload. */
    function setup() {
        const sessions = createSessionsStore();
        const composites = createActiveComposites(sessions);
        const editor = createEditorStore();
        editor.getState().setForeground(0x000000ff);
        const status = createStatusStore();
        const registry = createToolRegistry();
        registry.register(pencilTool, "pencil.tools.ts");
        const tools = createToolState(editor, registry);
        tools.select("pencil");
        const frames = manualFrames();
        const timers = manualTimers();
        let version = 0;
        const value = createStrokeEcho({ nextVersion: () => ++version });
        /** The version each upload the viewport was asked for read (at once, for the test). */
        const uploads: number[] = [];
        composites.subscribe((touched, session) => value.touched(session, touched));
        // As the viewport does (SE-011): a change of the composites is uploaded again.
        composites.subscribe(() => void uploads.push(version));
        const errors: unknown[] = [];
        const pipeline = createToolPipeline({
            sessions,
            composites,
            viewport: { invalidate: () => void uploads.push(version) },
            status,
            editor,
            tools,
            mapping() {
                const document = activeDocument(sessions.getState());
                if (!document) return null;
                return createViewMapping({
                    view: document.view,
                    docWidth: document.session.doc.width,
                    docHeight: document.session.doc.height,
                    ratio: 1,
                    left: 0,
                    top: 0,
                });
            },
            nextFrame: frames.request,
            later: timers.set,
            onError: (error) => void errors.push(error),
            echo: value,
        });
        const session = createDocument({ name: "echo", width: 8, height: 6 }, sequentialIds("e-"));
        const document = sessions.getState().open(session, {
            view: { scale: 8, originX: 0, originY: 0 },
        });
        const at = (x: number, y: number, fields: Partial<PointerInput> = {}): PointerInput => ({
            pointerId: 1,
            button: -1,
            buttons: 1,
            clientX: x * 8 + 4,
            clientY: y * 8 + 4,
            shiftKey: false,
            ctrlKey: false,
            altKey: false,
            metaKey: false,
            timeStamp: 0,
            ...fields,
        });
        return {
            echo: value,
            pipeline,
            frames,
            uploads,
            session,
            document,
            at,
            errors,
            composites,
        };
    }

    it("echoes each composited change until an upload that contains it is drawn", () => {
        const { echo: value, pipeline, frames, uploads, session, at } = setup();
        const key = frameKey(session.activeFrameId);
        pipeline.down(at(1, 1, { button: 0 }));
        // The press is composited and the viewport told at once: that upload has it.
        expect(versions(value)).toEqual([1]);
        expect(uploads).toEqual([1]);
        // A second sample in the same animation frame waits; the overlay composites it.
        pipeline.move([at(2, 1)]);
        expect(versions(value)).toEqual([1]);
        value.prepare();
        expect(versions(value)).toEqual([1, 2]);
        expect(value.regions()[1]?.rect).toEqual({ x: 2, y: 1, width: 1, height: 1 });
        // The first upload is drawn: the press is on screen through NGNE, the second sample not.
        value.drawn(key, uploads[0]);
        expect(versions(value)).toEqual([2]);
        // Shown to the viewport in the next animation frame, then drawn.
        frames.run();
        expect(uploads).toEqual([1, 2]);
        value.drawn(key, uploads[1]);
        expect(value.regions()).toEqual([]);
        pipeline.up(at(2, 1, { button: 0, buttons: 0 }));
    });

    it("draws the live composite's pixels, which become NGNE's", () => {
        const { echo: value, pipeline, session, at, composites } = setup();
        pipeline.down(at(3, 2, { button: 0 }));
        pipeline.move([at(5, 2)]);
        value.prepare();
        const buffer = value.target!.buffer;
        expect(composites.cache?.get(session.activeFrameId)).toBe(buffer);
        // Every echoed region of the buffer equals a full composite of the document now.
        const full = compositeFrame(session.doc, session.activeFrameId);
        for (const { rect } of value.regions()) {
            for (let y = rect.y; y < rect.y + rect.height; y++) {
                for (let x = rect.x; x < rect.x + rect.width; x++) {
                    const at4 = (y * buffer.width + x) * 4;
                    expect(Array.from(buffer.data.subarray(at4, at4 + 4))).toEqual(
                        Array.from(full.data.subarray(at4, at4 + 4)),
                    );
                }
            }
        }
        pipeline.up(at(5, 2, { button: 0, buttons: 0 }));
    });

    it("Escape clears the echo at once", () => {
        const { echo: value, pipeline, at } = setup();
        pipeline.down(at(1, 1, { button: 0 }));
        pipeline.move([at(4, 4)]);
        value.prepare();
        expect(value.regions().length).toBeGreaterThan(0);
        pipeline.cancel();
        expect(value.regions()).toEqual([]);
        expect(value.target).toBeNull();
    });

    it("after the commit, keeps the regions until the history step's upload is drawn; undo clears them at once", () => {
        const { echo: value, pipeline, session, at, document } = setup();
        const key = frameKey(session.activeFrameId);
        pipeline.down(at(1, 1, { button: 0 }));
        pipeline.move([at(3, 1)]);
        pipeline.up(at(3, 1, { button: 0, buttons: 0 }));
        expect(document.history.undoCount).toBe(1);
        expect(value.stroking).toBe(false);
        expect(value.regions().length).toBeGreaterThan(0);
        // The history step's upload reads the latest version: it has every region.
        value.drawn(key, value.regions().at(-1)!.version);
        expect(value.regions()).toEqual([]);

        pipeline.down(at(5, 5, { button: 0 }));
        pipeline.up(at(5, 5, { button: 0, buttons: 0 }));
        expect(value.regions().length).toBeGreaterThan(0);
        document.history.undo();
        expect(value.regions()).toEqual([]);
    });

    it("a stroke that changes nothing in the end is shown anew, and its echo kept until then", () => {
        const { echo: value, pipeline, uploads, session, at, document } = setup();
        const key = frameKey(session.activeFrameId);
        pipeline.down(at(2, 2, { button: 0 }));
        pipeline.move([at(2, 3)]);
        // Escape is not used: the pixels are put back by hand before the release.
        const image = document.session.doc.images.get(
            document.session.doc.cels.get(`${session.activeLayerId}:${session.activeFrameId}`)!
                .imageId,
        )!;
        image.data.fill(0);
        pipeline.up(at(2, 3, { button: 0, buttons: 0 }));
        expect(document.history.undoCount).toBe(0);
        // The frame is shown anew: an upload is asked for after the stroke's last region.
        const last = Math.max(...value.regions().map((region) => region.version));
        expect(uploads.at(-1)).toBeGreaterThanOrEqual(last);
        value.drawn(key, uploads.at(-1));
        expect(value.regions()).toEqual([]);
    });
});

describe("the viewport carries an upload's version to the frame it draws", () => {
    it("reads the version with the pixels and reports it with the frame image drawn", async () => {
        const renderer = new FakeRenderer();
        const scene: Scene = {
            document: null,
            epoch: 0,
            current: null,
            view: { scale: 2, originX: 0, originY: 0 },
            checker: { a: 0x111111, b: 0x222222, size: 2 },
            background: 0,
        };
        const slots = new ViewportSlots(scene, {
            target: renderer,
            bitmap: async () => bitmap("image"),
            rendererFailed: () => false,
            onChange() {},
            onError() {},
            onStuck() {},
            gate: () => undefined,
        });
        let version = 7;
        const pixels: PixelBuffer = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
        replaceSceneDocument(scene, {
            width: 2,
            height: 2,
            pixels: () => pixels,
            version: () => version,
        });
        slots.documentChanged();
        scene.current = FRAME_KEY;
        slots.sync();
        await flush();
        // Read when the upload started; later changes of the version are not this upload's.
        version = 8;
        for (const call of renderer.calls) call.resolve();
        await flush();
        slots.quads();
        expect(slots.drawnFrame()).toMatchObject({ key: FRAME_KEY, version: 7 });

        slots.invalidate([FRAME_KEY]);
        await flush();
        version = 9;
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        slots.quads();
        expect(slots.drawnFrame()).toMatchObject({ key: FRAME_KEY, version: 8 });
    });

    it("reports no version for a document that gives none, and no frame for the checkerboard alone", async () => {
        const renderer = new FakeRenderer();
        const scene: Scene = {
            document: null,
            epoch: 0,
            current: null,
            view: { scale: 1, originX: 0, originY: 0 },
            checker: { a: 0x111111, b: 0x222222, size: 2 },
            background: 0,
        };
        const slots = new ViewportSlots(scene, {
            target: renderer,
            bitmap: async () => bitmap("image"),
            rendererFailed: () => false,
            onChange() {},
            onError() {},
            onStuck() {},
            gate: () => undefined,
        });
        const pixels: PixelBuffer = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
        replaceSceneDocument(scene, { width: 2, height: 2, pixels: () => pixels });
        slots.documentChanged();
        slots.quads();
        expect(slots.drawnFrame()).toBeNull();
        scene.current = FRAME_KEY;
        slots.sync();
        await flush();
        for (const call of renderer.calls) call.resolve();
        await flush();
        slots.quads();
        expect(slots.drawnFrame()).toEqual({ key: FRAME_KEY, width: 2, height: 2 });
    });
});

describe("the echo's pixels and its layer", () => {
    it("are NGNE's: the composite over the checkerboard, opaque", () => {
        const buffer: PixelBuffer = {
            width: 4,
            height: 1,
            data: Uint8ClampedArray.from([
                ...[10, 20, 30, 255],
                ...[200, 100, 50, 0],
                ...[255, 0, 0, 128],
                ...[0, 0, 0, 0],
            ]),
        };
        const checker = { a: 0x112233, b: 0x445566, size: 2 };
        expect(
            Array.from(echoPixels(buffer, { x: 0, y: 0, width: 4, height: 1 }, checker)),
        ).toEqual([
            ...[10, 20, 30, 255],
            // Transparent: the checkerboard, `a` for the first square of 2.
            ...[0x11, 0x22, 0x33, 255],
            // Half red over `b`: round((255 * 128 + 0x44 * 127) / 255) and so on.
            ...[
                Math.round((255 * 128 + 0x44 * 127) / 255),
                Math.round((0x55 * 127) / 255),
                Math.round((0x66 * 127) / 255),
                255,
            ],
            ...[0x44, 0x55, 0x66, 255],
        ]);
    });

    it("is drawn under the outline, the grids and the brush cursor", () => {
        const layer = overlayLayers.find((entry) => entry.id === "stroke-echo");
        expect(layer?.order).toBe(STROKE_ECHO_ORDER);
        for (const id of ["document-outline", "pixel-grid", "tile-grid", "brush-cursor"]) {
            const above = overlayLayers.find((entry) => entry.id === id);
            expect(above?.order, id).toBeGreaterThan(STROKE_ECHO_ORDER);
        }
    });
});
