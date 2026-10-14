import { eventKey } from "../commands/chord";
import type {} from "../../import-meta";
import type { ViewMapping } from "../view/coordinates";
import { toolState } from "./activeTool";
import { connectToolMapping, toolPipeline } from "./appPipeline";
import type { PointerInput } from "./pipeline";
import type { ToolModifiers } from "./types";

/** What tests read of the tools on the page (SE-014). */
export interface ToolsProbe {
    /** The id of the tool the user selected. */
    readonly selected: string;
    /** The id of the active tool: a held one, or the selected one. */
    readonly active: string;
    /** True while a stroke is in progress. */
    readonly stroking: boolean;
    /** The cursor over the viewport. */
    readonly cursor: string;
}

declare module "../testing/testHooks" {
    interface EditorTestHooks {
        /** The tools and the pointer pipeline (SE-014), while a viewport is on the page. */
        tools?: ToolsProbe;
    }
}

/**
 * The CSS custom property of the viewport element that holds the active tool's cursor. The
 * element's stylesheet uses it, so a middle-drag's own cursor still wins (SE-012).
 */
export const TOOL_CURSOR_PROPERTY = "--shell-tool-cursor";

const NO_MODIFIERS: ToolModifiers = { shift: false, ctrl: false, alt: false, meta: false };
/** `PointerEvent.button` of the right button. */
const RIGHT = 2;

/** The fields of a pointer event the pipeline reads. */
function pointerInput(event: PointerEvent): PointerInput {
    return {
        pointerId: event.pointerId,
        button: event.button,
        buttons: event.buttons,
        clientX: event.clientX,
        clientY: event.clientY,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        timeStamp: event.timeStamp,
    };
}

/**
 * Connects the app's pointer pipeline (SE-014) to the overlay canvas `canvas`, the pointer
 * target of the viewport element `container` (SPEC §6.3). `mapping` is the overlay's mapping
 * of the image on screen. The pipeline gets every left or right press on the canvas, captures
 * the pointer for the stroke it begins (so a stroke goes on outside the canvas), every
 * coalesced sample of its moves, its release, and a pointer cancel. No event is stopped: the
 * overlay and view navigation follow the same events on `container`. The middle button is not
 * taken (SE-012). Over the viewport the right button paints, so the context menu is cancelled.
 * Keys reach the stroke's tool before the shortcuts, and the cursor follows the active tool,
 * the modifiers and whether the pointer is over the document. Returns the function that disconnects all of it.
 */
export function attachToolPointer(
    canvas: HTMLCanvasElement,
    container: HTMLElement,
    mapping: () => ViewMapping | null,
): () => void {
    const disconnect = connectToolMapping(mapping);
    let modifiers: ToolModifiers = NO_MODIFIERS;
    /** A right-button stroke began, and the context menu that follows it has not come yet. */
    let strokeMenu = false;
    /** Where the pointer is over the viewport, in client coordinates; null when it is not. */
    let pointer: { x: number; y: number } | null = null;
    let cursor = "";

    const overDocument = () => {
        const shown = pointer ? mapping() : null;
        return shown !== null && pointer !== null
            ? shown.contains(shown.clientToDoc(pointer.x, pointer.y))
            : false;
    };

    const updateCursor = () => {
        const tool = toolPipeline.strokeTool ?? toolState.active();
        const spec = tool?.cursor;
        const next =
            typeof spec === "function"
                ? spec({ modifiers, pressed: toolPipeline.stroking, overDocument: overDocument() })
                : (spec ?? "default");
        if (next === cursor) return;
        cursor = next;
        container.style.setProperty(TOOL_CURSOR_PROPERTY, next);
    };

    const takeModifiers = (event: MouseEvent | KeyboardEvent) => {
        if (
            event.shiftKey !== modifiers.shift ||
            event.ctrlKey !== modifiers.ctrl ||
            event.altKey !== modifiers.alt ||
            event.metaKey !== modifiers.meta
        ) {
            modifiers = {
                shift: event.shiftKey,
                ctrl: event.ctrlKey,
                alt: event.altKey,
                meta: event.metaKey,
            };
        }
        updateCursor();
    };

    const onPointerDown = (event: PointerEvent) => {
        takeModifiers(event);
        if (!toolPipeline.down(pointerInput(event))) return;
        // The context menu of a right-button stroke is the stroke's, wherever it comes up.
        if (event.button === RIGHT) strokeMenu = true;
        // No text selection or native drag from a stroke.
        event.preventDefault();
        try {
            canvas.setPointerCapture(event.pointerId);
        } catch {
            // The pointer is gone already; its cancel or release ends the stroke.
        }
        updateCursor();
    };

    const onPointerMove = (event: PointerEvent) => {
        takeModifiers(event);
        if (event.pointerId !== toolPipeline.strokePointer) return;
        const samples = event.getCoalescedEvents?.() ?? [];
        toolPipeline.move((samples.length > 0 ? samples : [event]).map(pointerInput));
        updateCursor();
    };

    const onPointerUp = (event: PointerEvent) => {
        toolPipeline.up(pointerInput(event));
        updateCursor();
    };

    const onPointerCancel = (event: PointerEvent) => {
        if (event.pointerId === toolPipeline.strokePointer) toolPipeline.cancel();
        updateCursor();
    };

    // The position is followed on the viewport element, as the overlay follows it: a drag
    // that holds the pointer there (the middle-button pan) still reports it.
    const onPointerAt = (event: PointerEvent) => {
        pointer = { x: event.clientX, y: event.clientY };
        updateCursor();
    };
    const onPointerLeave = () => {
        pointer = null;
        updateCursor();
    };

    // Over the viewport the right button means the background colour (DESIGN §4).
    const onContextMenu = (event: Event) => event.preventDefault();

    // The browser sends a right-button stroke's context menu at the press (Linux, macOS) or
    // at the release (Windows), to the element under the pointer then: a stroke released over
    // another region would open the menu there. The one menu that follows a right-button
    // stroke is cancelled wherever it goes, in the capture phase; any later press, or the
    // keyboard's menu key, ends that.
    const onAnyContextMenu = (event: Event) => {
        if (!strokeMenu) return;
        strokeMenu = false;
        event.preventDefault();
    };
    const onAnyPointerDown = () => {
        strokeMenu = false;
    };

    // In the capture phase: before the keymap, which leaves a key whose default is prevented.
    const onKey = (event: KeyboardEvent) => {
        takeModifiers(event);
        // A menu asked for from the keyboard is not a stroke's.
        if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
            strokeMenu = false;
        }
        const used = toolPipeline.key({
            type: event.type === "keyup" ? "up" : "down",
            key: eventKey(event),
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
            repeat: event.repeat,
        });
        if (used) event.preventDefault();
    };

    const onBlur = () => {
        modifiers = NO_MODIFIERS;
        updateCursor();
    };

    const stopTools = toolState.subscribe(updateCursor);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    // Capture lost without a release (the canvas left the page): the stroke is cancelled.
    canvas.addEventListener("lostpointercapture", onPointerCancel);
    container.addEventListener("pointerdown", onPointerAt, true);
    container.addEventListener("pointermove", onPointerAt, true);
    container.addEventListener("pointerleave", onPointerLeave);
    container.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("contextmenu", onAnyContextMenu, true);
    // Before the canvas's own listener, which arms the cancel for the stroke it begins.
    window.addEventListener("pointerdown", onAnyPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", onBlur);
    updateCursor();

    const hooks = import.meta.env.DEV ? window.__ngneTest : undefined;
    const probe: ToolsProbe = {
        get selected() {
            return toolState.selectedId();
        },
        get active() {
            return toolState.activeId();
        },
        get stroking() {
            return toolPipeline.stroking;
        },
        get cursor() {
            return cursor;
        },
    };
    if (hooks) hooks.tools = probe;

    return () => {
        if (hooks?.tools === probe) delete hooks.tools;
        stopTools();
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerCancel);
        canvas.removeEventListener("lostpointercapture", onPointerCancel);
        container.removeEventListener("pointerdown", onPointerAt, true);
        container.removeEventListener("pointermove", onPointerAt, true);
        container.removeEventListener("pointerleave", onPointerLeave);
        container.removeEventListener("contextmenu", onContextMenu);
        window.removeEventListener("contextmenu", onAnyContextMenu, true);
        window.removeEventListener("pointerdown", onAnyPointerDown, true);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("keyup", onKey, true);
        window.removeEventListener("blur", onBlur);
        disconnect();
        container.style.removeProperty(TOOL_CURSOR_PROPERTY);
    };
}
