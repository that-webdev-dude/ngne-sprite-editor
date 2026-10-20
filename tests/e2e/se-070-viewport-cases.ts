import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type * as CoreModel from "../../src/core/model";
import type { OnionSettings } from "../../src/core/model";
import { collectErrors } from "./se-006-support";
import {
    DARK,
    DARK_CHECKER,
    checkerAt,
    documentRect,
    openDocument,
    openViewportEditor,
    paint,
    readback,
    settle,
} from "./se-011-support";
import type { Rgb } from "./se-011-support";
import { geometry } from "./se-012-support";
import { overlayCanvas, overlaySettled, setGrids, shot } from "./se-013-support";
import type { Shot } from "./se-013-support";
import { antsState, darkAt, setSelection } from "./se-030-support";
import { addReference, changeReference, setOpacity } from "./se-045-support";

// SE-070: viewport baselines (SPEC §6.7, §11), declared once per device pixel ratio by
// `viewportBaselineTests`: a ratio other than the configured one needs a Chrome of its own,
// so each ratio has its own spec file (se-070-viewport-dpr1, se-070-viewport-dpr15).
//
// The expected images are worked out here, from the document and the view, for every device
// pixel; no image is committed. That makes them the same on any machine, any GPU and any
// operating system with sRGB forced, and keeps fonts out (the viewport draws no text).
//
// - Image content is read back from the NGNE canvas in the page (`probe.readCanvas()`, the
//   same task as the render). The scenes are built of opaque and fully transparent pixels:
//   the checkerboard, the frame, an onion skin at full opacity behind or in front of it, and
//   reference layers at full opacity behind and in front, each covering a part of the canvas
//   of its own and parts of the others. Every device pixel is compared exactly. A second
//   scene has the defaults (references at 50%, onion skin at 50% with its tint): its opaque
//   pixels are exact, the blended ones within the blend of SE-011/SE-025/SE-045.
// - Overlay alignment is a screenshot of both canvases (SPEC §6.7), compared exactly at every
//   device pixel: the pixel and tile grids over a document of black and white texels, where
//   the white ink at any alpha has one exact result whatever the compositor's rounding (over
//   black the ink's premultiplied value, over white white); and the marching ants with
//   reduced motion, black and white dashes over opaque texels.

const WIDTH = 16;
const HEIGHT = 12;
/** View in device pixels: whole texels of 8 device pixels. */
const VIEW = { scale: 8, originX: 40, originY: 24 };
type Rgba = readonly [number, number, number, number];
type View = typeof VIEW;
/** Dark theme (DESIGN §3.1, §6): the workspace, and the outline `--border-strong`. */
const WORKSPACE = [0x0f, 0x0f, 0x10, 255];
const OUTLINE = [0x3a, 0x3a, 0x40, 255];
const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];
/** At most this many differing pixels are listed. */
const LIMIT = 8;

const FRAME: Rgba = [220, 60, 40, 255];
const GHOST: Rgba = [40, 180, 90, 255];
const REF_BEHIND: Rgba = [60, 90, 230, 255];
const REF_FRONT: Rgba = [240, 200, 30, 255];

/** A rectangle of texels: x, y, width, height. */
type Box = readonly [number, number, number, number];
const inBox = ([bx, by, bw, bh]: Box, x: number, y: number) =>
    x >= bx && y >= by && x < bx + bw && y < by + bh;

/** A WIDTH × HEIGHT image with `box` in `rgba`, the rest transparent. */
function filled(box: Box, rgba: Rgba): number[] {
    const pixels: number[] = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) pixels.push(...(inBox(box, x, y) ? rgba : [0, 0, 0, 0]));
    }
    return pixels;
}

/** Where each part of the readback scene lies, in texels. */
const PARTS = {
    frame: [4, 2, 6, 7] as Box,
    ghost: [0, 0, 10, 12] as Box,
    behind: [8, 0, 6, 12] as Box,
    front: [7, 7, 4, 4] as Box,
};

/**
 * Opens a document of three frames with the frames' pixels given, frame 2 active, the grids
 * off and the onion settings `onion`; returns its id.
 */
function openFrames(
    page: Page,
    frames: readonly (readonly number[])[],
    onion: Partial<OnionSettings>,
): Promise<string> {
    return page.evaluate(
        async ({ frames, onion, width, height, view }) => {
            const path = "/src/core/model/index.ts";
            const core = (await import(/* @vite-ignore */ path)) as typeof CoreModel;
            const session = core.createDocument({ name: "baseline", width, height });
            const { doc } = session;
            const first = doc.frames[0]!;
            doc.frames = frames.map((_, index) => ({
                id: index === 0 ? first.id : `frame-${index + 1}`,
                durationMs: 100,
            }));
            frames.forEach((pixels, index) => {
                const imageId = `image-${index + 1}`;
                doc.images.set(imageId, {
                    width,
                    height,
                    data: Uint8ClampedArray.from(pixels),
                });
                doc.cels.set(core.celKey(session.activeLayerId, doc.frames[index]!.id), {
                    imageId,
                    opacity: 255,
                });
            });
            session.activeFrameId = doc.frames[1]!.id;
            doc.settings.pixelGrid = false;
            doc.settings.grid.visible = false;
            doc.settings.onion = { ...doc.settings.onion, ...onion };
            const id = window.__ngneTest!.sessions.getState().open(session, { view }).id;
            window.__ngneTest!.assertInvariants();
            return id;
        },
        {
            frames: frames.map((frame) => [...frame]),
            onion,
            width: WIDTH,
            height: HEIGHT,
            view: VIEW,
        },
    );
}

/** Adds a flat reference layer over `box` (fitted to it: scale 1), at `opacity`, placed so. */
async function referenceOver(
    page: Page,
    box: Box,
    rgba: Rgba,
    placement: "behind" | "front",
    opacity: number | null,
): Promise<void> {
    const [x, y, width, height] = box;
    const id = await addReference(
        page,
        { kind: "flat", width, height, rgba },
        { rect: { x, y, width, height } },
    );
    expect(id).not.toBeNull();
    if (placement === "front") expect(await changeReference(page, id!, { placement })).toBe(true);
    if (opacity !== null) await setOpacity(page, id!, opacity);
}

/** The ghosts the last frame drew: their frame (from 1), variant, opacity and quad layer. */
function drawnGhosts(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        const ids = document.session.doc.frames.map((frame) => frame.id);
        return window.__ngneTest!.viewport!.onion.map((ghost) => {
            const at = ghost.key.lastIndexOf(":");
            return `${ids.indexOf(ghost.key.slice(0, at)) + 1}:${ghost.key.slice(at + 1)}@${ghost.layer}×${ghost.alpha}`;
        });
    });
}

/** What a scene must show at a texel: a colour and how far a channel may be from it. */
type Expect = (tx: number, ty: number) => { rgb: readonly number[]; tolerance: number };

/**
 * Reads the NGNE canvas back and compares every device pixel of the document rectangle with
 * `expected` at its texel, and every pixel outside it with the workspace colour, exactly.
 * Returns how many device pixels were compared exactly and with a tolerance.
 */
async function expectReadback(
    page: Page,
    expected: Expect,
): Promise<{ exact: number; near: number }> {
    const rect = documentRect({ width: WIDTH, height: HEIGHT }, VIEW);
    const { crop, outside } = await readback(page, rect, DARK.workspace);
    const wrong: string[] = [];
    let exact = 0;
    let near = 0;
    for (let y = 0; y < crop.height; y++) {
        for (let x = 0; x < crop.width; x++) {
            const tx = Math.floor(x / VIEW.scale);
            const ty = Math.floor(y / VIEW.scale);
            const { rgb, tolerance } = expected(tx, ty);
            const from = (y * crop.width + x) * 4;
            const got = crop.data.slice(from, from + 4);
            if (tolerance === 0) exact++;
            else near++;
            const same =
                got[3] === 255 &&
                [0, 1, 2].every((c) => Math.abs((got[c] ?? -99) - (rgb[c] ?? 0)) <= tolerance);
            if (!same && wrong.length < LIMIT) {
                wrong.push(
                    `(${x}, ${y}) texel ${tx},${ty}: ${got} not ${rgb.map((v) => Math.round(v))} ±${tolerance}`,
                );
            }
        }
    }
    expect(wrong).toEqual([]);
    expect(outside).toBe(0);
    return { exact, near };
}

const checker = (tx: number, ty: number): Rgb => checkerAt(DARK_CHECKER, tx, ty);

/** `colour` at `alpha` (0..1) over `under`. */
const over = (colour: readonly number[], alpha: number, under: readonly number[]) =>
    [0, 1, 2].map((c) => colour[c]! * alpha + under[c]! * (1 - alpha));

/** Where the canvases are on the screen. */
interface Placement {
    left: number;
    top: number;
    device: { width: number; height: number };
}

async function placement(page: Page): Promise<Placement> {
    const layout = await geometry(page);
    return {
        left: Math.round(layout.left * layout.ratio),
        top: Math.round(layout.top * layout.ratio),
        device: layout.device,
    };
}

/** The alpha of every device pixel of the overlay canvas's document rectangle. */
function overlayAlpha(page: Page, view: View): Promise<number[]> {
    return overlayCanvas(page).evaluate(
        (canvas, { view, width, height }) => {
            const context = (canvas as HTMLCanvasElement).getContext("2d")!;
            const image = context.getImageData(
                view.originX,
                view.originY,
                width * view.scale,
                height * view.scale,
            );
            const alpha: number[] = [];
            for (let at = 3; at < image.data.length; at += 4) alpha.push(image.data[at]!);
            return alpha;
        },
        { view, width: WIDTH, height: HEIGHT },
    );
}

/**
 * Compares every device pixel of the canvases on `shown` with `expected(x, y)`, exactly; x
 * and y are device pixels of the canvases. Returns the first few that differ.
 */
function screenMismatches(
    shown: Shot,
    place: Placement,
    expected: (x: number, y: number) => readonly number[],
): string[] {
    const wrong: string[] = [];
    for (let y = 0; y < place.device.height && wrong.length < LIMIT; y++) {
        for (let x = 0; x < place.device.width && wrong.length < LIMIT; x++) {
            const want = expected(x, y);
            const got = shown.at(place.left + x, place.top + y);
            if (got.join() !== want.join()) wrong.push(`(${x}, ${y}) ${got} not ${want}`);
        }
    }
    return wrong;
}

/** Inside the document rectangle at `view`: the texel, or null. */
function texelAt(view: View, x: number, y: number): { tx: number; ty: number } | null {
    const dx = x - view.originX;
    const dy = y - view.originY;
    if (dx < 0 || dy < 0 || dx >= WIDTH * view.scale || dy >= HEIGHT * view.scale) return null;
    return { tx: Math.floor(dx / view.scale), ty: Math.floor(dy / view.scale) };
}

/** On the 1-device-pixel ring just outside the document rectangle. */
function onOutline(view: View, x: number, y: number): boolean {
    const right = view.originX + WIDTH * view.scale;
    const bottom = view.originY + HEIGHT * view.scale;
    const ring = x >= view.originX - 1 && x <= right && y >= view.originY - 1 && y <= bottom;
    return ring && texelAt(view, x, y) === null;
}

/** Declares the baseline tests; the calling spec file has set Chrome up for `ratio`. */
export function viewportBaselineTests(ratio: number): void {
    test.describe(`device pixel ratio ${ratio}`, () => {
        test("readback: checkerboard, frame, onion skin behind and references behind and in front, all opaque, are exact at every device pixel", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            await openViewportEditor(page);
            expect(await page.evaluate(() => devicePixelRatio)).toBe(ratio);
            await openFrames(
                page,
                [
                    filled(PARTS.ghost, GHOST),
                    filled(PARTS.frame, FRAME),
                    filled(PARTS.ghost, GHOST),
                ],
                {
                    enabled: true,
                    before: 1,
                    after: 0,
                    opacity: 255,
                    tint: false,
                    placement: "behind",
                },
            );
            await referenceOver(page, PARTS.behind, REF_BEHIND, "behind", 255);
            await referenceOver(page, PARTS.front, REF_FRONT, "front", 255);
            await settle(page);
            expect(await drawnGhosts(page)).toEqual(["1:plain@3×1"]);

            // Front reference over the frame over the ghost over the behind reference over
            // the checkerboard; each covers a part of its own and parts of the others.
            const counts = await expectReadback(page, (tx, ty) => {
                const rgb = inBox(PARTS.front, tx, ty)
                    ? REF_FRONT
                    : inBox(PARTS.frame, tx, ty)
                      ? FRAME
                      : inBox(PARTS.ghost, tx, ty)
                        ? GHOST
                        : inBox(PARTS.behind, tx, ty)
                          ? REF_BEHIND
                          : checker(tx, ty);
                return { rgb, tolerance: 0 };
            });
            expect(counts).toEqual({ exact: WIDTH * HEIGHT * VIEW.scale ** 2, near: 0 });
            expect(errors).toEqual([]);
        });

        test("readback: an opaque onion skin in front covers the frame and lies under a reference in front, exact at every device pixel", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            await openViewportEditor(page);
            await openFrames(
                page,
                [
                    filled(PARTS.ghost, GHOST),
                    filled(PARTS.frame, FRAME),
                    filled(PARTS.ghost, GHOST),
                ],
                {
                    enabled: true,
                    before: 0,
                    after: 1,
                    opacity: 255,
                    tint: false,
                    placement: "front",
                },
            );
            await referenceOver(page, PARTS.behind, REF_BEHIND, "behind", 255);
            await referenceOver(page, PARTS.front, REF_FRONT, "front", 255);
            await settle(page);
            expect(await drawnGhosts(page)).toEqual(["3:plain@5×1"]);
            await expectReadback(page, (tx, ty) => {
                const rgb = inBox(PARTS.front, tx, ty)
                    ? REF_FRONT
                    : inBox(PARTS.ghost, tx, ty)
                      ? GHOST
                      : inBox(PARTS.frame, tx, ty)
                        ? FRAME
                        : inBox(PARTS.behind, tx, ty)
                          ? REF_BEHIND
                          : checker(tx, ty);
                return { rgb, tolerance: 0 };
            });
            expect(errors).toEqual([]);
        });

        test("readback: with the defaults (references and onion skin at 50%) the opaque pixels are exact and the blended ones within the blend", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            await openViewportEditor(page);
            await openFrames(
                page,
                [
                    filled(PARTS.ghost, GHOST),
                    filled(PARTS.frame, FRAME),
                    filled(PARTS.ghost, GHOST),
                ],
                {
                    enabled: true,
                    before: 1,
                    after: 0,
                    opacity: 128,
                    tint: false,
                    placement: "behind",
                },
            );
            await referenceOver(page, PARTS.behind, REF_BEHIND, "behind", null);
            await settle(page);
            const ghosts = await drawnGhosts(page);
            expect(ghosts).toHaveLength(1);
            const ghostAlpha = Number(ghosts[0]!.split("×")[1]);
            expect(ghostAlpha).toBeCloseTo(128 / 255, 6);
            const half = 128 / 255;
            const counts = await expectReadback(page, (tx, ty) => {
                if (inBox(PARTS.frame, tx, ty)) return { rgb: FRAME, tolerance: 0 };
                let under: readonly number[] = checker(tx, ty);
                // NGNE blends each quad over what lies below: the reference at 50% (within 2:
                // its CPU pre-scaling, SE-045), then the ghost at 50% (within 1, SE-025).
                let tolerance = 0;
                if (inBox(PARTS.behind, tx, ty)) {
                    under = over(REF_BEHIND, half, under);
                    tolerance = 2;
                }
                if (inBox(PARTS.ghost, tx, ty)) {
                    under = over(GHOST, ghostAlpha, under);
                    tolerance = Math.max(tolerance, 1);
                }
                return { rgb: under, tolerance };
            });
            // Both kinds were compared: the opaque frame and checkerboard, and the blends.
            expect(counts.exact).toBeGreaterThan(0);
            expect(counts.near).toBeGreaterThan(0);
            expect(errors).toEqual([]);
        });

        test("screenshot: the pixel and tile grids over black and white texels are exact at every device pixel of both canvases", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            await openViewportEditor(page);
            // Black and white texels, in no regular pattern of the grids.
            const white = (tx: number, ty: number) => (tx * 7 + ty * 3 + ((tx * ty) % 5)) % 3 === 0;
            const pixels: number[] = [];
            for (let ty = 0; ty < HEIGHT; ty++) {
                for (let tx = 0; tx < WIDTH; tx++) pixels.push(...(white(tx, ty) ? WHITE : BLACK));
            }
            const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
            await paint(page, document.id, pixels);
            const tiles = { width: 5, height: 4, offsetX: 2, offsetY: -1 };
            await setGrids(page, document.id, {
                pixelGrid: true,
                grid: { ...tiles, visible: true },
            });
            await page.mouse.move(1, 1);
            await overlaySettled(page);
            const place = await placement(page);
            const alpha = await overlayAlpha(page, VIEW);

            // The overlay's lines lie exactly on the first device pixel of each texel (the
            // pixel grid) and of each tile (the tile grid), the document's first included,
            // and nowhere else in the document; a tile line has a strength of its own.
            const lineAt = (dx: number, dy: number): "tile" | "pixel" | null => {
                const column = dx % VIEW.scale === 0 ? dx / VIEW.scale : null;
                const row = dy % VIEW.scale === 0 ? dy / VIEW.scale : null;
                const tileColumn =
                    column !== null &&
                    (((column - tiles.offsetX) % tiles.width) + tiles.width) % tiles.width === 0;
                const tileRow =
                    row !== null &&
                    (((row - tiles.offsetY) % tiles.height) + tiles.height) % tiles.height === 0;
                if (tileColumn || tileRow) return "tile";
                return column !== null || row !== null ? "pixel" : null;
            };
            const strengths = { tile: new Set<number>(), pixel: new Set<number>() };
            const misplaced: string[] = [];
            const span = WIDTH * VIEW.scale;
            alpha.forEach((value, index) => {
                const dx = index % span;
                const dy = Math.floor(index / span);
                const line = lineAt(dx, dy);
                if (line) strengths[line].add(value);
                else if (value !== 0 && misplaced.length < LIMIT)
                    misplaced.push(`(${dx}, ${dy}) ${value}`);
            });
            expect(misplaced).toEqual([]);
            expect(strengths.pixel.size).toBe(1);
            expect(strengths.tile.size).toBe(1);
            const [pixelAlpha] = [...strengths.pixel];
            const [tileAlpha] = [...strengths.tile];
            expect(pixelAlpha).toBeGreaterThan(0);
            expect(tileAlpha).toBeGreaterThan(pixelAlpha!);

            // On the screen: over a black texel the white ink at alpha a is exactly (a, a, a),
            // over a white one white; the outline and the workspace exact around it.
            const shown = await shot(page);
            expect(
                screenMismatches(shown, place, (x, y) => {
                    const texel = texelAt(VIEW, x, y);
                    if (!texel) return onOutline(VIEW, x, y) ? OUTLINE : WORKSPACE;
                    if (white(texel.tx, texel.ty)) return WHITE;
                    const dx = x - VIEW.originX;
                    const dy = y - VIEW.originY;
                    const a = alpha[dy * span + dx]!;
                    return [a, a, a, 255];
                }),
            ).toEqual([]);
            expect(errors).toEqual([]);
        });

        test("screenshot: the marching ants with reduced motion are exact at every device pixel of both canvases", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            await page.emulateMedia({ reducedMotion: "reduce" });
            await openViewportEditor(page);
            // Opaque texels, none black or white: the ants are seen on every one.
            const colour = (tx: number, ty: number): Rgba => [
                40 + tx * 12,
                50 + ty * 15,
                120 + ((tx + ty) % 4) * 30,
                255,
            ];
            const pixels: number[] = [];
            for (let ty = 0; ty < HEIGHT; ty++) {
                for (let tx = 0; tx < WIDTH; tx++) pixels.push(...colour(tx, ty));
            }
            const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
            await paint(page, document.id, pixels);
            await setGrids(page, document.id, { pixelGrid: false, grid: { visible: false } });
            // A block with a hole, a part on the document's left and bottom edges, and a
            // texel touching the block's corner diagonally.
            const SHAPE = [
                "................",
                "..######........",
                "..######...##...",
                "..##..##...##...",
                "..######........",
                "........#.......",
                "................",
                "................",
                "##..............",
                "##..............",
                "##..............",
                "####............",
            ];
            await setSelection(page, document.id, SHAPE);
            await page.mouse.move(1, 1);
            await overlaySettled(page);
            const ants = await antsState(page);
            expect(ants.animating).toBe(false);
            const place = await placement(page);
            const selected = (x: number, y: number) => {
                const texel = texelAt(VIEW, x, y);
                return texel !== null && SHAPE[texel.ty]![texel.tx] === "#";
            };
            // DESIGN §6 as SE-030 decided: the ants cover every device pixel that is not
            // selected and touches a selected one, diagonally too; 2 px black, 2 px white by
            // the sum of the coordinates, at the probe's phase.
            const onRing = (x: number, y: number) => {
                if (selected(x, y)) return false;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) if (selected(x + dx, y + dy)) return true;
                }
                return false;
            };
            let ring = 0;
            const shown = await shot(page);
            expect(
                screenMismatches(shown, place, (x, y) => {
                    if (onRing(x, y)) {
                        ring++;
                        return darkAt(x, y, ants.phase) ? BLACK : WHITE;
                    }
                    const texel = texelAt(VIEW, x, y);
                    if (!texel) return onOutline(VIEW, x, y) ? OUTLINE : WORKSPACE;
                    return [...colour(texel.tx, texel.ty)];
                }),
            ).toEqual([]);
            // The ring was there: around the block, its hole, the parts and over the outline.
            expect(ring).toBeGreaterThan(2 * (6 + 4 + 2 + 2 + 4) * VIEW.scale);
            expect(errors).toEqual([]);
        });
    });
}
