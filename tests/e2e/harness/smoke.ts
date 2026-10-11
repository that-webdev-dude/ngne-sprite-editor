import { Camera, Frame, WebGPURenderer } from "@ngne/core";
import { pixelAt, readCanvas } from "../../../src/engine/testing/readCanvas";

// SE-001 smoke page: one renderer, one rect, read back in the same task as the render.
const SIZE = 64;
const RECT = 0xff0000;
const CLEAR = 0x0000ff;

// The DOM library of the pinned TypeScript has no WebGPU types; only these fields are read.
interface GpuLike {
    requestAdapter(): Promise<{ info: { vendor: string; architecture: string } } | null>;
}

async function adapterName(): Promise<string> {
    const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
    const adapter = await gpu?.requestAdapter();
    return adapter ? `${adapter.info.vendor} ${adapter.info.architecture}`.trim() : "none";
}

async function run() {
    const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
    if (!canvas) throw new Error("Missing canvas");
    const errors: string[] = [];
    const renderer = await WebGPURenderer.create(canvas, SIZE, SIZE, (error) => {
        errors.push(String(error));
    });
    const frame = new Frame();
    frame.scene(new Camera(), 1);
    // Rects are centred: this one covers pixels 24..39 on both axes.
    frame.rect(SIZE / 2, SIZE / 2, 16, 16, RECT);
    renderer.render(frame, CLEAR);
    const image = readCanvas(canvas);
    return {
        adapter: await adapterName(),
        status: renderer.status,
        width: image.width,
        height: image.height,
        inside: pixelAt(image, 32, 32),
        insideEdge: pixelAt(image, 24, 24),
        outsideEdge: pixelAt(image, 23, 23),
        corner: pixelAt(image, 2, 2),
        errors,
    };
}

const output = document.querySelector("#result");
run().then(
    (result) => {
        if (output) output.textContent = JSON.stringify(result);
    },
    (error: unknown) => {
        if (output) output.textContent = JSON.stringify({ failed: String(error) });
    },
);
