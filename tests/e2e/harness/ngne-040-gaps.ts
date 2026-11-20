import { Camera, Frame, WebGPURenderer } from "@ngne/core";
import type { RgbaPixels, Sprite, TextureRegion, TextureSampling } from "@ngne/core";
import { readCanvas } from "../../../src/engine/testing/readCanvas";
import { adapterName } from "./adapter";
import { documentRect, imageQuad } from "../../../src/engine/viewport/geometry";
import type { ViewportView } from "../../../src/engine/viewport/types";

// The engine gaps of SPEC §6.8 that @ngne/core 0.3.1 and 0.4.0 claim to close, probed on a
// bare renderer of the pinned version: raw RGBA8 `updateTexture` (translucent precision),
// camera zoom against the viewport's own placement, per-texture sampling and odd-size pixel
// snapping. Each probe returns plain numbers for `tests/e2e/ngne-040-gaps.spec.ts`.

type Rgba = [number, number, number, number];

/** A renderer on its own canvas, disposed with the canvas once `body` settles. */
async function withRenderer<T>(
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
        errors.push(String(error));
    });
    try {
        return await body(renderer, canvas, errors);
    } finally {
        renderer.dispose();
        canvas.remove();
    }
}

/** Renders `sprites` in one scene and reads the canvas back in the same task (SPEC §6.7). */
function draw(
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

function unsnapped(): Camera {
    const camera = new Camera();
    camera.pixelSnap = false;
    return camera;
}

function image(width: number, height: number, texel: (x: number, y: number) => Rgba): Uint8Array {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) data.set(texel(x, y), (y * width + x) * 4);
    }
    return data;
}

function bitmap(width: number, height: number, data: Uint8Array): Promise<ImageBitmap> {
    const pixels = new ImageData(new Uint8ClampedArray(data), width, height);
    return createImageBitmap(pixels, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
}

function rgb(color: number): [number, number, number] {
    return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}

function pixel(read: ImageData, x: number, y: number): Rgba {
    const at = (y * read.width + x) * 4;
    const d = read.data;
    return [d[at] ?? 0, d[at + 1] ?? 0, d[at + 2] ?? 0, d[at + 3] ?? 0];
}

const same = (a: readonly number[], b: readonly number[]) => a.every((value, i) => value === b[i]);

// --- Raw RGBA8 updates (SPEC §6.8 "Whole-image asynchronous uploads", 0.3.1) -------------

const RAW_W = 256;
const RAW_H = 254;
const RAW_CLEAR = 0x204060;

/** Every value of each channel at every alpha 1–254 (the pattern of `se-011-translucency`). */
const translucent = (x: number, y: number): Rgba => [x, 255 - x, (x * 7 + y * 3) & 255, y + 1];
const opaque = (x: number, y: number): Rgba => [(x * 3) & 255, (y * 5) & 255, 90, 255];

interface Precision {
    /** Translucent texels with a channel beyond ±1 of the exact blend over the clear colour. */
    beyond: number;
    /** Worst error of any translucent channel, to three decimals. */
    worst: number;
    /** Opaque texels not shown exactly. */
    opaqueWrong: number;
    /** Translucent texels checked. */
    translucentTexels: number;
}

/**
 * The largest error of any colour channel of `shown` against the exact blend of the texel at
 * `at` in `expected` (alpha `alpha`) over `under`.
 */
function blendError(
    shown: Rgba,
    expected: Uint8Array,
    at: number,
    alpha: number,
    under: readonly number[],
): number {
    let largest = 0;
    for (let c = 0; c < 3; c++) {
        const exact = ((expected[at + c] ?? 0) * alpha + under[c]! * (255 - alpha)) / 255;
        largest = Math.max(largest, Math.abs(shown[c]! - exact));
    }
    return largest;
}

function precision(read: ImageData, expected: Uint8Array): Precision {
    const under = rgb(RAW_CLEAR);
    let beyond = 0;
    let worst = 0;
    let opaqueWrong = 0;
    let translucentTexels = 0;
    for (let y = 0; y < RAW_H; y++) {
        for (let x = 0; x < RAW_W; x++) {
            const at = (y * RAW_W + x) * 4;
            const alpha = expected[at + 3] ?? 0;
            const shown = pixel(read, x, y);
            if (alpha === 255) {
                if (!same(shown.slice(0, 3), [...expected.subarray(at, at + 3)])) opaqueWrong++;
            } else if (alpha > 0) {
                translucentTexels++;
                const error = blendError(shown, expected, at, alpha, under);
                worst = Math.max(worst, error);
                if (error > 1) beyond++;
            }
        }
    }
    return { beyond, worst: Math.round(worst * 1000) / 1000, opaqueWrong, translucentTexels };
}

const whole = (width: number, height: number): TextureRegion => ({
    sourceX: 0,
    sourceY: 0,
    width,
    height,
    destinationX: 0,
    destinationY: 0,
});

async function raw() {
    return withRenderer(RAW_W, RAW_H, async (renderer, canvas, errors) => {
        const quad = (texture: string): Sprite => ({
            texture,
            x: RAW_W / 2,
            y: RAW_H / 2,
            width: RAW_W,
            height: RAW_H,
        });
        const pattern = image(RAW_W, RAW_H, translucent);
        const base = image(RAW_W, RAW_H, opaque);
        const pixels = (data: Uint8Array): RgbaPixels => ({ width: RAW_W, height: RAW_H, data });

        // The whole image through the raw path.
        await renderer.createTexture("raw:whole", RAW_W, RAW_H);
        await renderer.updateTexture("raw:whole", pixels(pattern), whole(RAW_W, RAW_H));
        const wholeResult = precision(
            draw(renderer, canvas, unsnapped(), [quad("raw:whole")], RAW_CLEAR),
            pattern,
        );

        // A region of it sent into a texture that holds an opaque image already.
        const region = { x: 16, y: 8, width: 200, height: 230 };
        await renderer.createTexture("raw:region", RAW_W, RAW_H);
        await renderer.updateTexture("raw:region", pixels(base), whole(RAW_W, RAW_H));
        await renderer.updateTexture("raw:region", pixels(pattern), {
            sourceX: region.x,
            sourceY: region.y,
            width: region.width,
            height: region.height,
            destinationX: region.x,
            destinationY: region.y,
        });
        const mixed = image(RAW_W, RAW_H, (x, y) =>
            x >= region.x &&
            x < region.x + region.width &&
            y >= region.y &&
            y < region.y + region.height
                ? translucent(x, y)
                : opaque(x, y),
        );
        const regionResult = precision(
            draw(renderer, canvas, unsnapped(), [quad("raw:region")], RAW_CLEAR),
            mixed,
        );

        // The bitmap path the editor uses today (`texture()`), as the control.
        await renderer.texture("raw:bitmap", await bitmap(RAW_W, RAW_H, pattern));
        const bitmapResult = precision(
            draw(renderer, canvas, unsnapped(), [quad("raw:bitmap")], RAW_CLEAR),
            pattern,
        );
        return { whole: wholeResult, region: regionResult, bitmap: bitmapResult, errors };
    });
}

// --- Camera zoom (SPEC §6.8 "No camera zoom", 0.4.0) ------------------------------------

const DOC_W = 37;
const DOC_H = 23;
const docTexel = (x: number, y: number): Rgba => [
    (x * 7 + 20) & 255,
    (y * 11 + 20) & 255,
    (x * 3 + y * 5 + 40) & 255,
    255,
];

/**
 * The document drawn the way the viewport draws it (sizes and positions scaled into device
 * pixels, camera at zoom 1) against the same document at document size under a camera of
 * `zoom = scale` that puts the document's corner at the same device pixel. Returns the device
 * pixels that differ for each view.
 */
async function zoom(views: readonly ViewportView[]) {
    const width = 220;
    const height = 160;
    return withRenderer(width, height, async (renderer, canvas, errors) => {
        await renderer.texture("doc", await bitmap(DOC_W, DOC_H, image(DOC_W, DOC_H, docTexel)));
        const clear = 0x000000;
        const cases = views.map((view) => {
            const emitted = draw(
                renderer,
                canvas,
                unsnapped(),
                [imageQuad("doc", 0, view, { width: DOC_W, height: DOC_H })],
                clear,
            );
            const rect = documentRect(view, DOC_W, DOC_H);
            const camera = unsnapped();
            camera.cut(-rect.x / view.scale, -rect.y / view.scale, view.scale);
            const zoomed = draw(
                renderer,
                canvas,
                camera,
                [{ texture: "doc", x: DOC_W / 2, y: DOC_H / 2, width: DOC_W, height: DOC_H }],
                clear,
            );
            let differing = 0;
            for (let at = 0; at < emitted.data.length; at += 4) {
                if (
                    !same(
                        [...emitted.data.subarray(at, at + 4)],
                        [...zoomed.data.subarray(at, at + 4)],
                    )
                )
                    differing++;
            }
            return {
                view,
                wholeEdges:
                    Number.isInteger(DOC_W * view.scale) && Number.isInteger(DOC_H * view.scale),
                differing,
            };
        });
        return { cases, errors };
    });
}

// --- Sampling (SPEC §6.8 "No repeat addressing or linear filtering", 0.4.0) -------------

const CELL = 8;
const LIGHT: Rgba = [204, 204, 204, 255];
const DARK: Rgba = [153, 153, 153, 255];
const RAMP = [0, 85, 170, 255];

async function sampling() {
    return withRenderer(128, 96, async (renderer, canvas, errors) => {
        const clear = 0x000000;
        const sample = async (
            id: string,
            w: number,
            h: number,
            data: Uint8Array,
            s?: TextureSampling,
        ) => renderer.texture(id, await bitmap(w, h, data), undefined, s);

        // Repeat: one checker period (2 × 2 cells), tiled over a quad of 12.5 × 9.5 periods.
        const period = 2 * CELL;
        await sample("period", period, period, image(period, period, checker), {
            address: "repeat",
        });
        const quad = { x: 3, y: 2, width: 100, height: 76 };
        const tiled = draw(
            renderer,
            canvas,
            unsnapped(),
            [
                {
                    texture: "period",
                    x: quad.x + quad.width / 2,
                    y: quad.y + quad.height / 2,
                    width: quad.width,
                    height: quad.height,
                    u: 0,
                    v: 0,
                    uw: quad.width / period,
                    vh: quad.height / period,
                },
            ],
            clear,
        );
        let repeatWrong = 0;
        for (let y = 0; y < quad.height; y++) {
            for (let x = 0; x < quad.width; x++) {
                if (!same(pixel(tiled, quad.x + x, quad.y + y), checker(x, y))) repeatWrong++;
            }
        }

        // Linear against nearest: a 4 × 1 grey ramp drawn four times its size.
        const ramp = image(4, 1, (x) => [RAMP[x]!, RAMP[x]!, RAMP[x]!, 255]);
        await sample("ramp:linear", 4, 1, ramp, { filter: "linear" });
        await sample("ramp:nearest", 4, 1, ramp);
        const row = (texture: string) => {
            const read = draw(
                renderer,
                canvas,
                unsnapped(),
                [{ texture, x: 8, y: 2, width: 16, height: 4 }],
                clear,
            );
            return Array.from({ length: 16 }, (_, x) => pixel(read, x, 1)[0]);
        };
        const linear = row("ramp:linear");
        const nearest = row("ramp:nearest");
        let linearWorst = 0;
        let nearestWrong = 0;
        for (let x = 0; x < 16; x++) {
            const t = Math.min(3, Math.max(0, (x + 0.5) / 4 - 0.5));
            const i = Math.floor(t);
            const f = t - i;
            const bilinear = RAMP[i]! * (1 - f) + RAMP[Math.min(3, i + 1)]! * f;
            linearWorst = Math.max(linearWorst, Math.abs(linear[x]! - bilinear));
            if (nearest[x] !== RAMP[Math.floor(x / 4)]) nearestWrong++;
        }
        return {
            repeatWrong,
            repeatPixels: quad.width * quad.height,
            linear,
            linearWorst: Math.round(linearWorst * 1000) / 1000,
            nearest,
            nearestWrong,
            errors,
        };
    });
}

function checker(x: number, y: number): Rgba {
    return (Math.floor(x / CELL) + Math.floor(y / CELL)) % 2 === 0 ? LIGHT : DARK;
}

// --- Odd-size snapping (SPEC §6.8 "Centre snapping misaligns odd-sized sprites", 0.4.0) ---

const ODD_W = 5;
const ODD_H = 3;
const oddTexel = (x: number, y: number): Rgba => [40 + x * 40, 40 + y * 60, 200, 255];

interface SnapCase {
    x: number;
    y: number;
    flipX?: boolean;
    flipY?: boolean;
}

/** The pixels of `read` whose colour is not `clear`. */
function drawnPixels(read: ImageData, clear: number): number {
    const background = rgb(clear);
    let drawn = 0;
    for (let at = 0; at < read.data.length; at += 4) {
        if (!same([...read.data.subarray(at, at + 3)], background)) drawn++;
    }
    return drawn;
}

/** Whether the quad of `c`, its corner at (`x`, `y`), shows every texel on one pixel. */
function showsQuadAt(read: ImageData, x: number, y: number, c: SnapCase): boolean {
    for (let ty = 0; ty < ODD_H; ty++) {
        for (let tx = 0; tx < ODD_W; tx++) {
            const sx = c.flipX ? ODD_W - 1 - tx : tx;
            const sy = c.flipY ? ODD_H - 1 - ty : ty;
            if (!same(pixel(read, x + tx, y + ty), oddTexel(sx, sy))) return false;
        }
    }
    return true;
}

/** The first whole-pixel corner within a pixel of `c`'s unrounded one that shows the quad 1:1. */
function quadCorner(read: ImageData, c: SnapCase): [number, number] | null {
    const left = Math.floor(c.x - ODD_W / 2);
    const top = Math.floor(c.y - ODD_H / 2);
    for (let y = top - 1; y <= top + 1; y++) {
        for (let x = left - 1; x <= left + 1; x++) {
            if (showsQuadAt(read, x, y, c)) return [x, y];
        }
    }
    return null;
}

/**
 * An odd-sized quad drawn with `pixelSnap` on (NGNE's default) at fractional centres, also
 * flipped: whether some whole-pixel corner shows every texel exactly once (1:1) and nothing
 * else is drawn.
 */
async function snap(cases: readonly SnapCase[]) {
    return withRenderer(48, 32, async (renderer, canvas, errors) => {
        await renderer.texture("odd", await bitmap(ODD_W, ODD_H, image(ODD_W, ODD_H, oddTexel)));
        const clear = 0x000000;
        const results = cases.map((c) => {
            const read = draw(
                renderer,
                canvas,
                new Camera(),
                [
                    {
                        texture: "odd",
                        x: c.x,
                        y: c.y,
                        width: (c.flipX ? -1 : 1) * ODD_W,
                        height: (c.flipY ? -1 : 1) * ODD_H,
                    },
                ],
                clear,
            );
            const drawn = drawnPixels(read, clear);
            const corner = quadCorner(read, c);
            return { ...c, oneToOne: corner !== null && drawn === ODD_W * ODD_H, corner, drawn };
        });
        return { cases: results, errors };
    });
}

// --- Page --------------------------------------------------------------------------------

(window as unknown as { ngneGaps: unknown }).ngneGaps = { raw, zoom, sampling, snap };
const adapterOutput = document.querySelector("#adapter");
const adapter = await adapterName();
if (adapterOutput) adapterOutput.textContent = adapter;
