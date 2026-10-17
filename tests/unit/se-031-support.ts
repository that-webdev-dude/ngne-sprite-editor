import type { AntsSurface } from "../../src/app/selection/ringPainter";

// Shared by the SE-031 unit tests of the ring painter and the preview: software stand-ins for
// the 2D surfaces and the overlay that do just the calls the painter makes, pixel for pixel
// (after SE-030's in se-030-ants.test.ts), so that output is compared and draw calls counted.

/** Every method called on a stand-in context, in order, by name. */
export type CallLog = string[];

export interface FakeSurface extends AntsSurface {
    readonly pixels: Uint8ClampedArray;
}

/** A surface of `width` × `height`: putImageData, and pattern fills `source-atop`. */
export function fakeSurface(width: number, height: number, log: CallLog): FakeSurface {
    const pixels = new Uint8ClampedArray(width * height * 4);
    let state = { operation: "source-over", fill: null as unknown, shiftX: 0, shiftY: 0 };
    const stack: (typeof state)[] = [];
    const surface = {
        width,
        height,
        pixels,
        get image() {
            return surface as unknown as CanvasImageSource;
        },
        context: {
            imageSmoothingEnabled: true,
            get globalCompositeOperation() {
                return state.operation as GlobalCompositeOperation;
            },
            set globalCompositeOperation(value: GlobalCompositeOperation) {
                state.operation = value;
            },
            get fillStyle() {
                return state.fill as CanvasPattern;
            },
            set fillStyle(value: unknown) {
                state.fill = value;
            },
            createImageData(w: number, h: number) {
                log.push("createImageData");
                return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
            },
            putImageData(image: { width: number; height: number; data: Uint8ClampedArray }) {
                log.push("putImageData");
                if (image.width !== width || image.height !== height) throw new Error("size");
                pixels.set(image.data);
            },
            createPattern(source: { pixels: Uint8ClampedArray; width: number }) {
                log.push("createPattern");
                return { tile: source };
            },
            save() {
                log.push("save");
                stack.push({ ...state });
            },
            restore() {
                log.push("restore");
                state = stack.pop() ?? state;
            },
            translate(x: number, y: number) {
                log.push("translate");
                state.shiftX += x;
                state.shiftY += y;
            },
            fillRect(x: number, y: number, w: number, h: number) {
                log.push("fillRect");
                const fill = state.fill as { tile?: { pixels: Uint8ClampedArray; width: number } };
                if (!fill?.tile || state.operation !== "source-atop") {
                    throw new Error("only a pattern fill, source-atop, is drawn here");
                }
                const tile = fill.tile;
                const top = Math.max(0, y + state.shiftY);
                const bottom = Math.min(height, y + h + state.shiftY);
                const left = Math.max(0, x + state.shiftX);
                const right = Math.min(width, x + w + state.shiftX);
                for (let py = top; py < bottom; py++) {
                    for (let px = left; px < right; px++) {
                        const at = (py * width + px) * 4;
                        if (pixels[at + 3] === 0) continue;
                        const i = (((px - state.shiftX) % tile.width) + tile.width) % tile.width;
                        const j = (((py - state.shiftY) % tile.width) + tile.width) % tile.width;
                        const from = (j * tile.width + i) * 4;
                        pixels.set(tile.pixels.subarray(from, from + 3), at);
                        pixels[at + 3] = 255;
                    }
                }
            },
        },
    };
    return surface as unknown as FakeSurface;
}

/** The overlay: `drawImage` of an opaque-or-clear surface at whole pixels. */
export function fakeOverlay(size: { width: number; height: number }, log: CallLog) {
    const pixels = new Uint8ClampedArray(size.width * size.height * 4);
    return {
        pixels,
        context: {
            imageSmoothingEnabled: true,
            drawImage(source: FakeSurface, dx: number, dy: number) {
                log.push("drawImage");
                for (let y = 0; y < source.height; y++) {
                    for (let x = 0; x < source.width; x++) {
                        const from = (y * source.width + x) * 4;
                        const alpha = source.pixels[from + 3];
                        if (alpha === 0) continue;
                        if (alpha !== 255) throw new Error("a translucent pixel");
                        const tx = dx + x;
                        const ty = dy + y;
                        if (tx < 0 || ty < 0 || tx >= size.width || ty >= size.height) continue;
                        pixels.set(
                            source.pixels.subarray(from, from + 4),
                            (ty * size.width + tx) * 4,
                        );
                    }
                }
            },
        } as unknown as CanvasRenderingContext2D,
    };
}

/** Surfaces made by a painter, kept so a test can read the last one. */
export function surfaceMaker(log: CallLog) {
    const made: FakeSurface[] = [];
    return {
        made,
        make(width: number, height: number): AntsSurface {
            const surface = fakeSurface(width, height, log);
            made.push(surface);
            return surface;
        },
    };
}
