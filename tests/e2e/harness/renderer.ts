import { Camera, Frame, WebGPURenderer } from "@ngne/core";
import type { Sprite } from "@ngne/core";
import { readCanvas } from "../../../src/engine/testing/readCanvas";

// A bare renderer for the harness pages that probe NGNE without the viewport
// (`ngne-040-gaps.ts`, `checker-period.ts`).

/** An NGNE diagnostic as text: an error as `String` gives it, any other value as JSON. */
function diagnosticText(error: unknown): string {
    if (error instanceof Error) return String(error);
    return JSON.stringify(error) ?? typeof error;
}

/** A renderer on its own canvas, disposed with the canvas once `body` settles. */
export async function withRenderer<T>(
    width: number,
    height: number,
    body: (renderer: WebGPURenderer, canvas: HTMLCanvasElement, errors: string[]) => Promise<T>,
): Promise<T> {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    document.body.append(canvas);
    const errors: string[] = [];
    const renderer = await WebGPURenderer.create(canvas, width, height, (error) => {
        errors.push(diagnosticText(error));
    });
    try {
        return await body(renderer, canvas, errors);
    } finally {
        renderer.dispose();
        canvas.remove();
    }
}

/** Renders `sprites` in one scene and reads the canvas back in the same task (SPEC §6.7). */
export function draw(
    renderer: WebGPURenderer,
    canvas: HTMLCanvasElement,
    camera: Camera,
    sprites: readonly Sprite[],
    clear: number,
): ImageData {
    const frame = new Frame();
    frame.scene(camera, 1);
    for (const sprite of sprites) frame.sprite(sprite);
    renderer.render(frame, clear);
    return readCanvas(canvas);
}

/** A camera that places quads as the viewport does: no snapping (SPEC §6.2 #7). */
export function unsnapped(): Camera {
    const camera = new Camera();
    camera.pixelSnap = false;
    return camera;
}
