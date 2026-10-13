import { frameKey, NgneViewport } from "../../../src/engine/NgneViewport";
import type { ViewportProbe } from "../../../src/engine/NgneViewport";

// SE-011 harness: an `NgneViewport` on its own, without the app, showing a document made
// here. The spec drives it through `window.se011` to reach states the app never rests in:
// a document with no frame on show (the checker-only baseline) and a full frame cache.

export interface ViewportHarness {
    probe: ViewportProbe;
    errors: string[];
    /** Shows a `size` × `size` document with `frames` frames and no frame on show. */
    open(size: number, frames: number): void;
    /** Puts frame `index` on show; null shows the checkerboard alone. */
    show(index: number | null): void;
    /** Gives up every cached frame that is not on show. */
    clearFrames(): void;
}

declare global {
    interface Window {
        se011?: ViewportHarness;
    }
}

const host = document.querySelector<HTMLElement>("#host");
if (!host) throw new Error("Missing host");

const errors: string[] = [];
const viewport = new NgneViewport(host, { onError: (message) => errors.push(message) });
const key = (index: number) => frameKey(`frame-${index}`);

window.se011 = {
    probe: viewport.probe,
    errors,
    open(size, frames) {
        // One opaque image per frame: the red channel is the frame's number.
        const images = new Map<string, Uint8ClampedArray>();
        viewport.setCurrent(null);
        viewport.setDocument({
            width: size,
            height: size,
            pixels(frame) {
                const index = Array.from({ length: frames }, (_, at) => key(at)).indexOf(frame);
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
        viewport.setCurrent(index === null ? null : key(index));
    },
    clearFrames() {
        viewport.invalidate("all");
    },
};
