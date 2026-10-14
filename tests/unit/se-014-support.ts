import { createToolState } from "../../src/app/tools/activeTool";
import type { ToolState } from "../../src/app/tools/activeTool";
import { createToolPipeline } from "../../src/app/tools/pipeline";
import type { PointerInput, ToolPipeline } from "../../src/app/tools/pipeline";
import { createToolRegistry } from "../../src/app/tools/registry";
import type { ToolRegistry } from "../../src/app/tools/registry";
import type { ToolContext, ToolPointer, ToolSpec } from "../../src/app/tools/types";
import { createActiveComposites } from "../../src/app/state/composites";
import type { ActiveComposites } from "../../src/app/state/composites";
import { createEditorStore } from "../../src/app/state/editor";
import type { EditorState } from "../../src/app/state/editor";
import { activeDocument, createSessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument, SessionsState, ViewState } from "../../src/app/state/sessions";
import { createStatusStore } from "../../src/app/state/status";
import type { StatusState } from "../../src/app/state/status";
import { createViewMapping } from "../../src/app/view/coordinates";
import type { Point, ViewMapping } from "../../src/app/view/coordinates";
import type { DocSession } from "../../src/core/model";
import type { StoreApi } from "zustand/vanilla";

// Shared by the SE-014 unit tests: a pointer pipeline on stores of its own, with recorded
// animation frames, timers and viewport invalidations, driven by synthetic pointer input, and
// a painting tool of the tests' own.

/** The id of `dotFixture`. */
export const DOT = "se014.dot";

function writeDot(context: ToolContext, pointer: ToolPointer): void {
    const { paint } = context;
    if (!paint || !pointer.inside) return;
    const { x, y } = pointer.pixel;
    const at = (y * paint.image.width + x) * 4;
    const alpha = Number(context.options.alpha);
    paint.image.data[at] = context.colour >>> 24;
    paint.image.data[at + 1] = (context.colour >>> 16) & 0xff;
    paint.image.data[at + 2] = (context.colour >>> 8) & 0xff;
    paint.image.data[at + 3] = Math.round(((context.colour & 0xff) * alpha) / 255);
    paint.markDirty({ x, y, width: 1, height: 1 });
}

/**
 * A painting tool that writes one pixel per pointer sample, in the colour of the button with
 * its alpha scaled by its Alpha option: the strokes of the SE-014 tests. It is the tests' own,
 * so the development dot tool of `src/app/tools/dot` can go without touching them (SE-015).
 */
export const dotFixture: ToolSpec = {
    id: DOT,
    label: "Dot",
    paints: true,
    cursor: "crosshair",
    options: [{ kind: "number", key: "alpha", label: "Alpha", min: 0, max: 255, default: 255 }],
    onDown: writeDot,
    onMove: writeDot,
};

/** Animation frames that run only when the test says so. */
export function manualFrames() {
    let queue: (() => void)[] = [];
    return {
        get pending() {
            return queue.length;
        },
        request(callback: () => void): () => void {
            queue.push(callback);
            return () => {
                queue = queue.filter((entry) => entry !== callback);
            };
        },
        /** Runs the callbacks requested so far, as one animation frame. */
        run(): void {
            const due = queue;
            queue = [];
            for (const callback of due) callback();
        },
    };
}

/** Timers that run only when the test says so. */
export function manualTimers() {
    let timers: { callback: () => void; at: number }[] = [];
    let now = 0;
    return {
        set(callback: () => void, ms: number): () => void {
            const timer = { callback, at: now + ms };
            timers.push(timer);
            return () => {
                timers = timers.filter((entry) => entry !== timer);
            };
        },
        advance(ms: number): void {
            now += ms;
            const due = timers.filter((timer) => timer.at <= now);
            timers = timers.filter((timer) => timer.at > now);
            for (const timer of due) timer.callback();
        },
    };
}

export interface Harness {
    sessions: StoreApi<SessionsState>;
    composites: ActiveComposites;
    editor: StoreApi<EditorState>;
    status: StoreApi<StatusState>;
    registry: ToolRegistry;
    tools: ToolState;
    pipeline: ToolPipeline;
    frames: ReturnType<typeof manualFrames>;
    timers: ReturnType<typeof manualTimers>;
    /** Every call of the viewport link's `invalidate`. */
    invalidated: (readonly string[] | "all")[];
    /** Every change the composites reported to their listeners, as frame ids. */
    compositeChanges: string[][];
    errors: unknown[];
    /** The mapping the pipeline reads; replace it to map through a stretch. */
    mapping: () => ViewMapping | null;
    open(session: DocSession, view?: ViewState): OpenDocument;
    document(): OpenDocument;
}

/** The mapping of the active document for a viewport element at the client origin, ratio 1. */
export function plainMapping(sessions: StoreApi<SessionsState>): ViewMapping | null {
    const document = activeDocument(sessions.getState());
    if (!document) return null;
    const { width, height } = document.session.doc;
    return createViewMapping({
        view: document.view,
        docWidth: width,
        docHeight: height,
        ratio: 1,
        left: 0,
        top: 0,
    });
}

/**
 * A pipeline with `dotFixture` (and `extra` tools) registered and `dotFixture` selected, on
 * stores of its own; the viewport element sits at the client origin at a ratio of 1.
 */
export function harness(extra: readonly ToolSpec[] = []): Harness {
    const sessions = createSessionsStore();
    const composites = createActiveComposites(sessions);
    const editor = createEditorStore();
    const status = createStatusStore();
    const registry = createToolRegistry();
    registry.register(dotFixture, "se-014-support.ts");
    for (const tool of extra) registry.register(tool, "test");
    const tools = createToolState(editor, registry);
    tools.select(DOT);
    const frames = manualFrames();
    const timers = manualTimers();
    const invalidated: (readonly string[] | "all")[] = [];
    const compositeChanges: string[][] = [];
    composites.subscribe((touched) => void compositeChanges.push([...touched.frameIds]));
    const errors: unknown[] = [];
    const value: Harness = {
        sessions,
        composites,
        editor,
        status,
        registry,
        tools,
        frames,
        timers,
        invalidated,
        compositeChanges,
        errors,
        mapping: () => plainMapping(sessions),
        pipeline: createToolPipeline({
            sessions,
            composites,
            viewport: { invalidate: (keys) => void invalidated.push(keys) },
            status,
            editor,
            tools,
            mapping: () => value.mapping(),
            nextFrame: frames.request,
            later: timers.set,
            onError: (error) => void errors.push(error),
        }),
        open: (session, view) =>
            sessions
                .getState()
                .open(session, { view: view ?? { scale: 8, originX: 0, originY: 0 } }),
        document() {
            const document = activeDocument(sessions.getState());
            if (!document) throw new Error("no active document");
            return document;
        },
    };
    return value;
}

/**
 * A pointer input at the centre of document pixel `pixel` under the active view (ratio 1, the
 * viewport element at the client origin).
 */
export function at(
    h: Pick<Harness, "document">,
    pixel: Point,
    fields: Partial<PointerInput> = {},
): PointerInput {
    const { scale, originX, originY } = h.document().view;
    return {
        pointerId: 1,
        button: -1,
        buttons: 1,
        clientX: originX + (pixel.x + 0.5) * scale,
        clientY: originY + (pixel.y + 0.5) * scale,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        timeStamp: 0,
        ...fields,
    };
}

/** Left-button press, moves and release over the given pixels: one stroke. */
export function stroke(h: Harness, pixels: readonly Point[], fields: Partial<PointerInput> = {}) {
    const [first, ...rest] = pixels;
    if (!first) throw new Error("stroke: no pixel");
    const button = fields.button ?? 0;
    const buttons = button === 2 ? 2 : 1;
    const started = h.pipeline.down(at(h, first, { ...fields, button, buttons }));
    for (const pixel of rest) h.pipeline.move([at(h, pixel, { ...fields, button: -1, buttons })]);
    const last = rest[rest.length - 1] ?? first;
    h.pipeline.up(at(h, last, { ...fields, button, buttons: 0 }));
    return started;
}

/** RGBA of pixel `x, y` of an image. */
export function rgbaAt(image: { width: number; data: Uint8ClampedArray }, x: number, y: number) {
    const at = (y * image.width + x) * 4;
    return Array.from(image.data.slice(at, at + 4));
}
