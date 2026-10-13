import { frameKey, NgneViewport } from "../../../src/engine/NgneViewport";
import type { ViewportProbe } from "../../../src/engine/NgneViewport";

// SE-011 harness: an `NgneViewport` on its own, without the app, showing a document made
// here. The specs drive it through `window.se011` to reach states the app never rests in (a
// document with no frame on show, a full frame cache) and to create, resize and dispose the
// viewport at chosen moments. With `?manual` in the address no viewport is created on load.

export interface ViewportHarness {
    /** The probe of the viewport; null while there is none. */
    readonly probe: ViewportProbe | null;
    /** Messages the viewport reported through `onError`. */
    errors: string[];
    /** Creates the viewport in the host element. */
    create(): void;
    /** Disposes the viewport. */
    dispose(): void;
    /** Sets the host element's size in CSS pixels. */
    resize(width: number, height: number): void;
    /** Shows a `size` × `size` document with `frames` frames and no frame on show. */
    open(size: number, frames: number): void;
    /** Puts frame `index` on show; null shows the checkerboard alone. */
    show(index: number | null): void;
    /** Gives up every cached frame that is not on show. */
    clearFrames(): void;
    /** Changes the workspace colour, which asks for one draw and nothing else. */
    redraw(): void;
}

declare global {
    interface Window {
        se011?: ViewportHarness;
    }
}

const host = document.querySelector<HTMLElement>("#host");
if (!host) throw new Error("Missing host");

const errors: string[] = [];
const key = (index: number) => frameKey(`frame-${index}`);
let viewport: NgneViewport | null = null;
let background = 0x0f0f10;

/** The viewport, for a call that needs one. */
function mounted(): NgneViewport {
    if (!viewport) throw new Error("se-011 harness: no viewport");
    return viewport;
}

const harness: ViewportHarness = {
    get probe() {
        return viewport?.probe ?? null;
    },
    errors,
    create() {
        if (viewport) throw new Error("se-011 harness: a viewport exists");
        viewport = new NgneViewport(host, { onError: (message) => errors.push(message) });
    },
    dispose() {
        mounted().dispose();
        viewport = null;
    },
    resize(width, height) {
        host.style.width = `${width}px`;
        host.style.height = `${height}px`;
    },
    open(size, frames) {
        // One opaque image per frame: the red channel is the frame's number.
        const keys = Array.from({ length: frames }, (_, at) => key(at));
        const images = new Map<string, Uint8ClampedArray>();
        mounted().setDocument({
            width: size,
            height: size,
            pixels(frame) {
                const index = keys.indexOf(frame);
                if (index === -1) return null;
                let data = images.get(frame);
                if (!data) {
                    data = new Uint8ClampedArray(size * size * 4).fill(255);
                    for (let at = 0; at < data.length; at += 4) data[at] = index * 20;
                    images.set(frame, data);
                }
                return { width: size, height: size, data };
            },
        });
    },
    show(index) {
        mounted().setCurrent(index === null ? null : key(index));
    },
    clearFrames() {
        mounted().invalidate("all");
    },
    redraw() {
        background = background === 0x0f0f10 ? 0x101010 : 0x0f0f10;
        mounted().setBackground(background);
    },
};

window.se011 = harness;
if (!new URLSearchParams(window.location.search).has("manual")) harness.create();
