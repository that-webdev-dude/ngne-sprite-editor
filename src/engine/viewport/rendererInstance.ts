import { Camera, Frame, WebGPURenderer } from "@ngne/core";
import type { RendererResourceInspection, RendererStatus } from "@ngne/core";
import { bitmapFromPixels } from "../bitmaps";
import { QUAD_LAYER } from "./geometry";
import type { PixelBuffer } from "../../core/model";
import type { DeviceSize } from "./types";
import { ViewportSlots } from "./viewportSlots";
import type { Scene } from "./viewportSlots";

// One renderer of the viewport with everything that lives and dies with it (SPEC §6.4): its
// own canvas element and its texture slots. The viewport replaces the whole instance when
// the size changes or the renderer fails. What is uploaded where is decided by
// `ViewportSlots`; this file is the part that needs NGNE and a canvas.

/**
 * The one `Frame` and the one `Camera` of a viewport. Every renderer instance builds its
 * draws in them; draws are synchronous, so two instances never use them at once.
 */
export interface Stage {
    readonly frame: Frame;
    readonly camera: Camera;
}

export function createStage(): Stage {
    const camera = new Camera();
    // Quads are placed from an integer top-left; snapping would round their centres
    // (SPEC §6.2 #7).
    camera.pixelSnap = false;
    return { frame: new Frame(), camera };
}

/** What an instance tells its viewport. */
export interface InstanceHooks {
    /** A `texture()` call is about to be made. */
    onTexture(slot: string): void;
    /** A slot changed what it shows: the scene has to be drawn again. */
    onChange(): void;
    /** An NGNE diagnostic, a failed upload or an image that could not be made. */
    onError(error: unknown): void;
    /** The instance can no longer show the scene in full: it asks to be replaced, once. */
    onStuck(instance: RendererInstance): void;
    /** Test hook: when it returns a promise, the upload of `slot` starts after it. */
    gate(slot: string): Promise<void> | undefined;
    /** Makes the upload source of a reference at a size (SE-045, `ReferenceSources`). */
    referenceBitmap(image: PixelBuffer, width: number, height: number): Promise<ImageBitmap>;
}

/** A renderer on its own canvas, with its texture slots. */
export class RendererInstance {
    readonly canvas: HTMLCanvasElement;
    readonly renderer: WebGPURenderer;
    readonly slots: ViewportSlots;
    /** `renderer.sprites` after the last draw; NGNE zeroes the counter on device loss. */
    drewSprites = 0;
    /** The status seen at the last read, to notice the way back to `ready`. */
    lastStatus: RendererStatus = "ready";
    readonly #scene: Scene;
    readonly #stage: Stage;
    readonly #hooks: InstanceHooks;
    #disposed = false;

    private constructor(
        canvas: HTMLCanvasElement,
        renderer: WebGPURenderer,
        scene: Scene,
        stage: Stage,
        hooks: InstanceHooks,
    ) {
        this.canvas = canvas;
        this.renderer = renderer;
        this.#scene = scene;
        this.#stage = stage;
        this.#hooks = hooks;
        this.slots = new ViewportSlots(scene, {
            target: {
                texture: (id, source, signal) => {
                    hooks.onTexture(id);
                    return renderer.texture(id, source, signal);
                },
            },
            bitmap: bitmapFromPixels,
            rendererFailed: () => renderer.status === "failed",
            onChange: () => hooks.onChange(),
            onError: (error) => hooks.onError(error),
            onStuck: () => hooks.onStuck(this),
            gate: (slot) => hooks.gate(slot),
            referenceBitmap: (image, width, height) => hooks.referenceBitmap(image, width, height),
        });
    }

    /**
     * Creates a renderer on a new canvas element of `size` device pixels. The canvas is not
     * in the document: the viewport inserts it once it has drawn.
     */
    static async create(
        size: DeviceSize,
        scene: Scene,
        stage: Stage,
        hooks: InstanceHooks,
    ): Promise<RendererInstance> {
        const canvas = document.createElement("canvas");
        // Callers own the backing size; the renderer's logical size is fixed (SPEC §6.2 #1).
        canvas.width = size.width;
        canvas.height = size.height;
        // Fills the viewport element: one backing pixel per device pixel while the sizes
        // match, stretched while a replacement for a new size is on its way.
        canvas.style.cssText = "position:absolute;inset:0;display:block;width:100%;height:100%";
        const renderer = await WebGPURenderer.create(canvas, size.width, size.height, (error) =>
            hooks.onError(error),
        );
        return new RendererInstance(canvas, renderer, scene, stage, hooks);
    }

    get width(): number {
        return this.renderer.width;
    }

    get height(): number {
        return this.renderer.height;
    }

    get status(): RendererStatus {
        return this.renderer.status;
    }

    get disposed(): boolean {
        return this.#disposed;
    }

    /** True once an upload failed for good here: only a fresh renderer shows the scene. */
    get stuck(): boolean {
        return this.slots.stuck;
    }

    inspect(): RendererResourceInspection {
        return this.renderer.inspect();
    }

    /**
     * Builds the frame from the slots that are ready and submits it. Returns false when NGNE
     * drew nothing: the renderer is not ready, or it reports why through the diagnostic
     * callback.
     */
    draw(): boolean {
        const scene = this.#scene;
        const { frame, camera } = this.#stage;
        frame.reset();
        frame.scene(camera, 1);
        // The workspace as a rect, so that every frame has at least one sprite: the sprite
        // counter then tells a device loss from a frame that had nothing to draw.
        frame.rect(
            this.width / 2,
            this.height / 2,
            this.width,
            this.height,
            scene.background,
            1,
            QUAD_LAYER.workspace,
        );
        for (const quad of this.slots.quads()) frame.sprite(quad);
        this.renderer.render(frame, scene.background);
        this.drewSprites = this.renderer.sprites;
        return this.drewSprites > 0;
    }

    /** Ends the instance: uploads aborted, renderer disposed, canvas out of the document. */
    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        this.slots.dispose();
        try {
            this.renderer.dispose();
        } catch (error) {
            this.#hooks.onError(error);
        }
        this.canvas.remove();
    }
}
