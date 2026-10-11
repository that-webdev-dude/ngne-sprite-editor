/**
 * Reads a WebGPU canvas back at backing resolution (SPEC §6.7). A WebGPU canvas only holds
 * its image until the frame is presented, so call this in the same task as the render (for
 * a `BrowserGame`, in `afterFrame`).
 */
export function readCanvas(canvas: HTMLCanvasElement): ImageData {
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
    if (!context) throw new Error("readCanvas: 2D context unavailable");
    context.drawImage(canvas, 0, 0);
    return context.getImageData(0, 0, copy.width, copy.height, { colorSpace: "srgb" });
}

/** RGBA of one backing pixel of a `readCanvas` result. */
export function pixelAt(image: ImageData, x: number, y: number): [number, number, number, number] {
    const o = (y * image.width + x) * 4;
    const d = image.data;
    return [d[o] ?? 0, d[o + 1] ?? 0, d[o + 2] ?? 0, d[o + 3] ?? 0];
}
