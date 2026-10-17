import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { keyContextStore } from "../../src/app/keymap/contextState";
import { installKeymap } from "../../src/app/keymap/install";
import type { KeyEnvironment } from "../../src/app/keymap/resolve";
import { DEFAULT_TOOL, editorStore } from "../../src/app/state/editor";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import { toolState } from "../../src/app/tools/activeTool";
import { connectToolMapping, toolPipeline } from "../../src/app/tools/appPipeline";
import type { PointerInput } from "../../src/app/tools/pipeline";
import { holdCommandId } from "../../src/app/tools/tools.commands";
import { createViewMapping } from "../../src/app/view/coordinates";
import { setViewSurface } from "../../src/app/view/viewNavigation";
import { viewportLink } from "../../src/app/viewport/viewportLink";
import type { ViewportMount } from "../../src/app/viewport/viewportLink";
import { createDocument } from "../../src/core/model";

// SE-065 review (A): the holds on the app's own stores and keymap. While a gesture of several
// presses is open — the curve, the polygon, the polygon lasso — neither Space (the hand) nor
// Alt (the eyedropper) acts: the gesture keeps its tool, nothing is cancelled, its preview
// stays. Once the gesture is closed both holds act again.

const SIZE = { width: 400, height: 300 };
const VIEW = { scale: 8, originX: 40, originY: 20 };

let mounted: ViewportMount | null = null;
let disconnect: (() => void) | null = null;
let uninstall: (() => void) | null = null;
const target = new EventTarget();
/** The keys' environment: the viewport focused, the gesture context as the app sets it. */
const environment = (): KeyEnvironment => ({
    overlayOpen: false,
    focus: "viewport",
    inTimeline: false,
    nativeKeys: new Set(),
    typeahead: false,
    gesture: keyContextStore.getState().gesture,
    floating: keyContextStore.getState().floating,
});
/** The viewport element, as far as the Space hold looks at it: it has the focus. */
const surface = { ownerDocument: { activeElement: null as unknown } };

beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    mounted = viewportLink.mount({ invalidate() {} }, SIZE);
    disconnect = connectToolMapping(() => {
        const document = activeDocument(sessionsStore.getState());
        if (!document) return null;
        return createViewMapping({
            view: document.view,
            docWidth: document.session.doc.width,
            docHeight: document.session.doc.height,
            ratio: 1,
            left: 0,
            top: 0,
        });
    });
    surface.ownerDocument.activeElement = surface;
    setViewSurface(surface as unknown as HTMLElement);
    uninstall = installKeymap({ registry: appCommands, target, environment });
});

afterEach(() => {
    toolPipeline.cancel();
    uninstall?.();
    disconnect?.();
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    mounted?.unmount();
    setViewSurface(null);
    editorStore.getState().setTool(DEFAULT_TOOL);
    vi.unstubAllGlobals();
});

function open() {
    return sessionsStore
        .getState()
        .open(createDocument({ name: "holds", width: 12, height: 10 }), { view: VIEW });
}

/** Dispatches a key event and reports whether its default was prevented. */
function key(type: "keydown" | "keyup", name: string, init: { altKey?: boolean } = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), {
        key: name,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        repeat: false,
        isComposing: false,
        ...init,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
}

/** A pointer input over the centre of document pixel `x, y`. */
function pixel(x: number, y: number, fields: Partial<PointerInput> = {}): PointerInput {
    return {
        pointerId: 1,
        button: 0,
        buttons: 1,
        clientX: VIEW.originX + (x + 0.5) * VIEW.scale,
        clientY: VIEW.originY + (y + 0.5) * VIEW.scale,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        timeStamp: 0,
        ...fields,
    };
}

function click(x: number, y: number) {
    toolPipeline.down(pixel(x, y));
    toolPipeline.up(pixel(x, y, { buttons: 0 }));
}

const hand = () => appCommands.get(holdCommandId({ id: "hand" }))!;
const eyedropper = () => appCommands.get(holdCommandId({ id: "eyedropper" }))!;

/** Opens each tool's gesture: the curve after its drag, the others after three clicks. */
const gestures: [string, () => void][] = [
    [
        "curve",
        () => {
            toolPipeline.down(pixel(1, 8));
            toolPipeline.move([pixel(10, 8)]);
            toolPipeline.up(pixel(10, 8, { buttons: 0 }));
            toolPipeline.move([pixel(5, 1, { buttons: 0 })]);
        },
    ],
    [
        "polygon",
        () => {
            click(1, 1);
            click(9, 2);
            click(8, 8);
        },
    ],
    [
        "polygon-lasso",
        () => {
            click(1, 1);
            click(9, 2);
            click(8, 8);
        },
    ],
];

describe("the holds during an open gesture", () => {
    for (const [id, openGesture] of gestures) {
        it(`${id}: Space and Alt do nothing while it is open; the gesture keeps its tool and its preview, and both act again once it is closed`, () => {
            const { session, history } = open();
            toolState.select(id);
            openGesture();
            expect(toolPipeline.gesture).toBe(true);
            expect(keyContextStore.getState().gesture).toBe(true);
            const cel = () => {
                const entry = session.doc.cels.get(
                    `${session.activeLayerId}:${session.activeFrameId}`,
                );
                const image = entry ? session.doc.images.get(entry.imageId) : undefined;
                return image ? Array.from(image.data) : null;
            };
            const shown = cel();
            if (id !== "polygon-lasso") expect(shown?.some((value) => value !== 0)).toBe(true);

            // Disabled, in the palette as on the keys.
            expect(hand().enabled()).toBe(false);
            expect(eyedropper().enabled()).toBe(false);
            for (const [name, init] of [
                [" ", {}],
                ["Alt", { altKey: true }],
            ] as const) {
                key("keydown", name, init);
                expect(toolState.activeId(), name).toBe(id);
                expect(toolState.held(), name).toEqual([]);
                expect(toolPipeline.gesture, name).toBe(true);
                expect(toolPipeline.strokeTool?.id, name).toBe(id);
                key("keyup", name);
                expect(toolPipeline.gesture, name).toBe(true);
            }
            expect(cel()).toEqual(shown);
            expect(history.transaction !== null).toBe(id !== "polygon-lasso");
            expect(history.undoCount).toBe(0);

            // Closed: one entry, and the holds act again.
            expect(key("keydown", "Enter")).toBe(true);
            expect(toolPipeline.gesture).toBe(false);
            expect(history.undoCount).toBe(1);
            expect(hand().enabled()).toBe(true);
            key("keydown", " ");
            expect(toolState.activeId()).toBe("hand");
            key("keyup", " ");
            expect(toolState.activeId()).toBe(id);
            // Alt takes the eyedropper from a tool that paints, as before (SE-016).
            const paints = id !== "polygon-lasso";
            expect(eyedropper().enabled()).toBe(paints);
            key("keydown", "Alt", { altKey: true });
            expect(toolState.activeId()).toBe(paints ? "eyedropper" : id);
            key("keyup", "Alt");
            expect(toolState.activeId()).toBe(id);
        });
    }

    it("the wheel and the middle button are not holds: a gesture stays open while the view pans", () => {
        open();
        toolState.select("polygon");
        click(1, 1);
        click(9, 2);
        // The middle button is navigation's: the pipeline takes no press of it.
        expect(toolPipeline.down(pixel(5, 5, { button: 1, buttons: 4 }))).toBe(false);
        expect(toolPipeline.gesture).toBe(true);
        expect(toolState.activeId()).toBe("polygon");
    });
});
