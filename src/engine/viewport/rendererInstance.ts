import { Camera, Frame, WebGPURenderer } from "@ngne/core";
import type {
    RendererLifecycleEvent,
    RendererResourceInspection,
    RendererStatus,
} from "@ngne/core";
import { bitmapFromPixels } from "../bitmaps";
import { instanceDiagnostic } from "./diagnostics";
import { QUAD_LAYER } from "./geometry";
import type { PixelBuffer } from "../../core/model";
import type { DeviceSize } from "./types";
import { ViewportSlots } from "./viewportSlots";
import type { Scene } from "./viewportSlots";

// One renderer of the viewport with everything that lives and dies with it (SPEC §6.4): its
// own canvas element and its texture slots. The viewport replaces the whole instance only when
// the renderer failed or an upload failed for good on it. What is uploaded where is decided by
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
    /**
     * A transition of the renderer's presentation (NGNE `onLifecycle`): `recovering`, `ready`
     * or `failed`. Called synchronously by NGNE: set flags, ask for a draw, nothing more.
     */
    onLifecycle(instance: RendererInstance, event: RendererLifecycleEvent): void;
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
    readonly #scene: Scene;
    readonly #stage: Stage;
    readonly #hooks: InstanceHooks;
    readonly #unsubscribe: () => void;
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
                releaseTexture: (id) => renderer.releaseTexture(id),
            },
            bitmap: bitmapFromPixels,
            rendererFailed: () => renderer.status === "failed",
            onChange: () => hooks.onChange(),
            onError: (error) => hooks.onError(error),
            onStuck: () => hooks.onStuck(this),
            gate: (slot) => hooks.gate(slot),
            referenceBitmap: (image, width, height) => hooks.referenceBitmap(image, width, height),
        });
        // Future transitions only: the viewport reads `status` for the present one.
        this.#unsubscribe = renderer.onLifecycle((event) => hooks.onLifecycle(this, event));
    }

    /**
     * Creates a renderer on a new canvas element of `size` device pixels. The canvas is not
     * in the document: the viewport inserts it once it has drawn. `signal` cancels the
     * creation: NGNE rejects with its reason, and a renderer created by the time it aborts is
     * disposed and the reason thrown all the same.
     */
    static async create(
        size: DeviceSize,
        scene: Scene,
        stage: Stage,
        hooks: InstanceHooks,
        signal: AbortSignal,
    ): Promise<RendererInstance> {
        const canvas = document.createElement("canvas");
        // Callers own the backing size; NGNE's creation leaves it to them.
        canvas.width = size.width;
        canvas.height = size.height;
        // Fills the viewport element: one backing pixel per device pixel.
        canvas.style.cssText = "position:absolute;inset:0;display:block;width:100%;height:100%";
        // A renderer reports why it ended `failed` once it has; the viewport replaces it, so
        // that report is passed on as `RendererReplaced` (SE-071).
        const created: { renderer?: WebGPURenderer } = {};
        const renderer = await WebGPURenderer.create(
            canvas,
            size.width,
            size.height,
            (error) => hooks.onError(instanceDiagnostic(error, created.renderer?.status)),
            signal,
        );
        // NGNE's cancellation ends with the creation; one that comes after it is the
        // viewport's to honour.
        if (signal.aborted) {
            renderer.dispose();
            throw signal.reason;
        }
        created.renderer = renderer;
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
        // The workspace as a rect: every frame has at least one sprite, so a frame NGNE
        // submitted is told from one it skipped by the sprite counter.
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
        return this.renderer.sprites > 0;
    }

    /** Ends the instance: uploads aborted, renderer disposed, canvas out of the document. */
    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        this.#unsubscribe();
        this.slots.dispose();
        try {
            this.renderer.dispose();
        } catch (error) {
            this.#hooks.onError(error);
        }
        this.canvas.remove();
    }
}
