import { backingSize } from "../../engine/viewport/geometry";
import type { DeviceSize } from "../../engine/viewport/types";
import type {} from "../../import-meta";
import { sessionsStore } from "../state/sessions";
import type { ViewMapping } from "../view/coordinates";
import { currentViewMapping } from "../view/viewNavigation";
import { createOverlayController } from "./overlayController";
import { overlayLayers } from "./overlayLayers";
import type { OverlayLayer, OverlayTheme } from "./types";

/** What tests read of the overlay on screen (SE-013). */
export interface OverlayProbe {
    /** Redraws since the overlay was mounted. */
    readonly redraws: number;
    /** True while a redraw is scheduled and has not run. */
    readonly pending: boolean;
    /** The canvas's backing size: that of the NGNE canvas on screen. */
    readonly canvasSize: DeviceSize;
    /** The ids of the draw layers, bottom first. */
    readonly layers: readonly string[];
}

declare module "../testing/testHooks" {
    interface EditorTestHooks {
        /** The overlay on screen (SE-013): its redraw counter and size. */
        overlay?: OverlayProbe;
    }
}

/** The overlay of the app, mounted on its canvas. */
export interface MountedOverlay {
    setTheme(theme: OverlayTheme): void;
    /**
     * The mapping of the image on screen, which client positions go through (see
     * `OverlayController.mapping`): the texel a stroke paints is the one shown under the
     * pointer, also during NGNE's resize quiet (SE-014).
     */
    mapping(): ViewMapping | null;
    dispose(): void;
}

const MIDDLE_BUTTON = 1;

/**
 * Makes `canvas` the overlay of the viewport element `container` (SPEC §6.3, SE-013): it is
 * drawn by the registered draw layers over the NGNE canvas that `ngne`, the element NGNE
 * fills, holds. It is the pointer target of the viewport: a pointer down on it focuses
 * `container`, except with the middle button, which pans and moves no focus (SE-012). It stops
 * no event: wheel and pointer events reach the listeners of view navigation on `container` by
 * bubbling. In development builds its probe is put on `window.__ngneTest`.
 *
 * Its backing size is always that of the NGNE canvas on screen, and both fill the same box.
 * After a resize NGNE keeps its old canvas, stretched over the new box, until the replacement
 * has drawn (SPEC §6.4); the overlay keeps that canvas's size meanwhile, so the two stay
 * stretched alike, and takes the new size in the task NGNE swaps its canvases.
 */
export function mountOverlay(
    canvas: HTMLCanvasElement,
    container: HTMLElement,
    ngne: HTMLElement,
    layers: readonly OverlayLayer[] = overlayLayers,
): MountedOverlay {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The overlay canvas has no 2D context.");
    // No pixels until NGNE has a canvas on screen, rather than the default 300 × 150 stretched.
    canvas.width = 0;
    canvas.height = 0;
    const controller = createOverlayController(canvas, context, layers, {
        sessions: sessionsStore,
        mapping: currentViewMapping,
        ratio: () => window.devicePixelRatio,
        nextFrame(callback) {
            const request = requestAnimationFrame(() => callback());
            return () => cancelAnimationFrame(request);
        },
    });

    // The NGNE canvas on screen. NGNE inserts a canvas only once it has drawn on it, and
    // swaps the old one for it in the same task (SPEC §6.4); the mutation is reported in a
    // microtask of that task, before the browser paints, so both change in the same frame.
    const followNgne = () => {
        const shown = ngne.querySelector("canvas");
        controller.resize(
            shown ? { width: shown.width, height: shown.height } : { width: 0, height: 0 },
        );
    };
    const swaps = new MutationObserver(followNgne);
    swaps.observe(ngne, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["width", "height"],
    });
    followNgne();

    // The device size of the box both canvases fill (the viewport element's), measured as the
    // NGNE viewport measures it: it tells how far the canvases are stretched.
    const observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const box = entry.devicePixelContentBoxSize?.[0];
        controller.setBox(
            box
                ? backingSize(box.inlineSize, box.blockSize)
                : backingSize(
                      entry.contentRect.width * devicePixelRatio,
                      entry.contentRect.height * devicePixelRatio,
                  ),
        );
    });
    try {
        observer.observe(canvas, { box: "device-pixel-content-box" });
    } catch {
        // Not supported: the content box times the pixel ratio is used instead.
        observer.observe(canvas);
    }

    // A tool may cancel the default of its pointer down, which is what focuses an element; the
    // overlay focuses the viewport element itself.
    const onPointerDown = (event: PointerEvent) => {
        if (event.button !== MIDDLE_BUTTON) container.focus({ preventScroll: true });
    };
    // The cursor is followed on the viewport element: a drag that holds the pointer there
    // (the middle-button pan) still reports it.
    const onPointer = (event: PointerEvent) =>
        controller.setCursor({ x: event.clientX, y: event.clientY });
    const onPointerLeave = () => controller.setCursor(null);
    canvas.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointerdown", onPointer);
    container.addEventListener("pointermove", onPointer);
    container.addEventListener("pointerleave", onPointerLeave);

    const hooks = import.meta.env.DEV ? window.__ngneTest : undefined;
    const ids = layers.map((layer) => layer.id);
    const probe: OverlayProbe = {
        get redraws() {
            return controller.redraws;
        },
        get pending() {
            return controller.pending;
        },
        get canvasSize() {
            return controller.size;
        },
        layers: ids,
    };
    if (hooks) hooks.overlay = probe;

    return {
        setTheme: (theme) => controller.setTheme(theme),
        mapping: () => controller.mapping(),
        dispose() {
            if (hooks?.overlay === probe) delete hooks.overlay;
            swaps.disconnect();
            observer.disconnect();
            canvas.removeEventListener("pointerdown", onPointerDown);
            container.removeEventListener("pointerdown", onPointer);
            container.removeEventListener("pointermove", onPointer);
            container.removeEventListener("pointerleave", onPointerLeave);
            controller.dispose();
        },
    };
}
