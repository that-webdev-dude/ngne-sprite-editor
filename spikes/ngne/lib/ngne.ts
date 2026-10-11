import { BrowserGame, Camera, WebGPURenderer } from "@ngne/core";
import type { Frame, SceneDefinition, Stats } from "@ngne/core";
import { readCanvas } from "../../../src/engine/testing/readCanvas.ts";
import { diffImages, expectedImage, type Diff, type Doc, type Placement } from "./pattern.ts";

// SPEC §6.2 #9: straight alpha, sRGB, decoded without conversion.
export const BITMAP_OPTIONS: ImageBitmapOptions = {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
};

/** The viewport's 14 fixed texture slots (SPEC §6.4). */
export const VIEWPORT_SLOTS: readonly string[] = [
    "ed:checker",
    ...Array.from({ length: 8 }, (_, index) => `ed:f:${index}`),
    "ed:play",
    ...Array.from({ length: 4 }, (_, index) => `ed:ref:${index}`),
];

export function bitmapOf(doc: Doc): Promise<ImageBitmap> {
    return createImageBitmap(new ImageData(doc.pixels, doc.width, doc.height), BITMAP_OPTIONS);
}

/** Builds a bitmap from the CPU buffer, uploads it into a slot and closes the bitmap. */
export async function upload(renderer: WebGPURenderer, id: string, doc: Doc): Promise<void> {
    const bitmap = await bitmapOf(doc);
    try {
        await renderer.texture(id, bitmap);
    } finally {
        bitmap.close();
    }
}

/** Sets the canvas backing size (the caller owns it, SPEC §6.2 #1) and creates a renderer. */
export function createRenderer(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    onError: (error: unknown) => void,
): Promise<WebGPURenderer> {
    canvas.width = width;
    canvas.height = height;
    return WebGPURenderer.create(canvas, width, height, onError);
}

export function camera(pixelSnap: boolean): Camera {
    const result = new Camera();
    result.pixelSnap = pixelSnap;
    return result;
}

/** Adds a quad from an integer top-left and an integer scale (SPEC §6.2 #7, §6.4 View). */
export function placeDoc(frame: Frame, slot: string, placement: Placement, layer = 0): void {
    const width = placement.doc.width * placement.scale;
    const height = placement.doc.height * placement.scale;
    frame.sprite({
        x: placement.x + width / 2,
        y: placement.y + height / 2,
        width,
        height,
        texture: slot,
        layer,
    });
}

/** In-page readback (SPEC §6.7) compared with the expected pattern. Same task as the render. */
export function readDiff(
    canvas: HTMLCanvasElement,
    clear: number,
    placements: readonly Placement[],
): Diff {
    const image = readCanvas(canvas);
    return diffImages(
        image.data,
        expectedImage(image.width, image.height, clear, placements),
        image.width,
    );
}

export interface PreviewOptions {
    readonly canvas: HTMLCanvasElement;
    readonly width: number;
    readonly height: number;
    readonly clear: number;
    readonly pixelSnap: boolean;
    /** Builds the frame; called by the scene's render callback. */
    readonly draw: (frame: Frame, ageMs: number) => void;
    readonly diagnostic: (error: unknown) => void;
    readonly afterFrame?: (stats: Readonly<Stats>) => void;
}

export interface Preview {
    readonly app: BrowserGame<Record<string, never>, never>;
    /** First start: prepares and mounts the scene. */
    start(): Promise<void>;
}

/** A `BrowserGame` set up as SPEC §6.5 describes the preview panel. */
export function createPreview(options: PreviewOptions): Preview {
    const scene: SceneDefinition<Record<string, never>, never> = {
        id: "se-002-preview",
        setup(setup) {
            setup.camera.pixelSnap = options.pixelSnap;
            let ageMs = 0;
            setup.system(({ dt }) => {
                ageMs += dt * 1000;
            });
            setup.render((frame) => options.draw(frame, ageMs));
        },
    };
    const app = new BrowserGame<Record<string, never>, never>({
        canvas: options.canvas,
        width: options.width,
        height: options.height,
        clear: options.clear,
        seed: "se-002",
        state: {},
        transition: (state) => state,
        diagnostic: options.diagnostic,
        afterFrame: options.afterFrame,
    });
    return {
        app,
        start: async () => app.start(await app.game.prepare(scene, { key: "preview" })),
    };
}

/** NGNE reports dropped ticks through the diagnostic callback; they are not errors. */
export function isOverloadNotice(value: unknown): boolean {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as { type?: unknown }).type === "overload"
    );
}
