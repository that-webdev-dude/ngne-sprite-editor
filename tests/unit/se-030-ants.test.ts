import { describe, expect, it } from "vitest";
import { axesOf } from "../../src/app/overlay/gridLines";
import { overlayLayers } from "../../src/app/overlay/overlayLayers";
import { DEFAULT_OVERLAY_THEME } from "../../src/app/overlay/types";
import type { OverlayFrame } from "../../src/app/overlay/types";
import {
    ANTS_DASH,
    ANTS_PERIOD,
    antsRing,
    dashShift,
    dashTile,
    forEachRingRect,
    isDarkDash,
    ringArea,
} from "../../src/app/selection/antsGeometry";
import {
    ANTS_DARK,
    ANTS_LIGHT,
    ANTS_STEP_MS,
    createSelectionAntsLayer,
    SELECTION_ANTS_ORDER,
} from "../../src/app/selection/selectionAnts.overlay";
import type { AntsSurface } from "../../src/app/selection/selectionAnts.overlay";
import { activeDocument, createSessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { createViewMapping } from "../../src/app/view/coordinates";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { BitMask } from "../../src/core/model";
import {
    deselectCommand,
    maskHas,
    rectMask,
    selectAllCommand,
    selectCommand,
    selectionBoundary,
} from "../../src/core/selection";
import type { DeviceRect } from "../../src/engine/viewport/geometry";
import { maskOf, randomMask, seeded } from "./se-030-support";

// SE-030: the marching ants (DESIGN §6). Their ring is the device pixels just outside the
// selected texels, diagonals included, checked here against a brute-force ring worked out in
// device space; their dashes are 2 px black, 2 px white along every row and column; the layer
// draws exactly that, in the same few draw calls whatever the selection, on surfaces no larger
// than the canvas; and its timer runs only while there is a selection and motion is allowed.

type View = { scale: number; originX: number; originY: number };
type Size = { width: number; height: number };

/** The pixels of `rects` as "x,y" keys. */
function pixelsOf(rects: readonly DeviceRect[]): Set<string> {
    const pixels = new Set<string>();
    for (const rect of rects) {
        for (let y = rect.y; y < rect.y + rect.height; y++) {
            for (let x = rect.x; x < rect.x + rect.width; x++) pixels.add(`${x},${y}`);
        }
    }
    return pixels;
}

/**
 * The ring by its definition, in device space: every canvas pixel outside the selected texels
 * with one of its 8 neighbours inside them. For views at a zoom of 1 or more.
 */
function bruteRing(mask: BitMask, view: View, size: Size) {
    const selected = (x: number, y: number) =>
        maskHas(
            mask,
            Math.floor((x - view.originX) / view.scale),
            Math.floor((y - view.originY) / view.scale),
        );
    const ring = new Set<string>();
    for (let y = 0; y < size.height; y++) {
        for (let x = 0; x < size.width; x++) {
            if (selected(x, y)) continue;
            let touches = false;
            for (let dy = -1; dy <= 1 && !touches; dy++) {
                for (let dx = -1; dx <= 1 && !touches; dx++) touches = selected(x + dx, y + dy);
            }
            if (touches) ring.add(`${x},${y}`);
        }
    }
    return ring;
}

function axesFor(mask: BitMask, view: View, size: Size) {
    const rect = {
        x: view.originX,
        y: view.originY,
        width: mask.width * view.scale,
        height: mask.height * view.scale,
    };
    return axesOf(rect, mask, size);
}

function ringOf(mask: BitMask, view: View, size: Size) {
    return antsRing(selectionBoundary(mask), axesFor(mask, view, size), size);
}

const L_SHAPE = maskOf([".....", ".#...", ".#...", ".###.", "....."]);
const HOLE = maskOf([".....", ".###.", ".#.#.", ".###.", "....."]);
const DIAGONAL = maskOf(["#..", ".#.", "..#"]);
const EDGES = maskOf(["##..##", "#.....", "......", ".....#"]);

/** A `side` × `side` checkerboard: the mask with the most boundary for its size. */
function checkerboard(side: number): BitMask {
    const rows: string[] = [];
    for (let y = 0; y < side; y++) {
        let row = "";
        for (let x = 0; x < side; x++) row += (x + y) % 2 === 0 ? "#" : ".";
        rows.push(row);
    }
    return maskOf(rows);
}

describe("where the ants lie", () => {
    it("on the device pixels just outside the selected texels, diagonals included", () => {
        const size = { width: 64, height: 48 };
        for (const [name, mask] of Object.entries({ L_SHAPE, HOLE, DIAGONAL, EDGES })) {
            for (const view of [
                { scale: 1, originX: 5, originY: 3 },
                { scale: 2, originX: 4, originY: 7 },
                { scale: 3, originX: 11, originY: 2 },
                { scale: 8, originX: 1, originY: 1 },
            ]) {
                const label = `${name} at ${view.scale}×`;
                expect([...pixelsOf(ringOf(mask, view, size))].sort(), label).toEqual(
                    [...bruteRing(mask, view, size)].sort(),
                );
            }
        }
    });

    it("so for one texel at 3× they are the 5 × 5 square around its 3 × 3 pixels", () => {
        const mask = maskOf(["...", ".#.", "..."]);
        const pixels = pixelsOf(
            ringOf(mask, { scale: 3, originX: 10, originY: 20 }, { width: 40, height: 40 }),
        );
        const expected = new Set<string>();
        for (let y = 22; y <= 26; y++) {
            for (let x = 12; x <= 16; x++) {
                if (x < 13 || x > 15 || y < 23 || y > 25) expected.add(`${x},${y}`);
            }
        }
        expect([...pixels].sort()).toEqual([...expected].sort());
        // The hole of a ring of texels shows its border, not its middle.
        const hole = pixelsOf(
            ringOf(HOLE, { scale: 3, originX: 0, originY: 0 }, { width: 40, height: 40 }),
        );
        expect(hole.has("7,7")).toBe(false);
        for (const pixel of ["6,6", "7,6", "8,6", "6,7", "8,7", "6,8", "7,8", "8,8"]) {
            expect(hole.has(pixel), pixel).toBe(true);
        }
    });

    it("for random masks and views partly off the canvas, also at the canvas edge", () => {
        const random = seeded(3030);
        const size = { width: 50, height: 37 };
        for (let round = 0; round < 60; round++) {
            const mask = randomMask(
                1 + Math.floor(random() * 12),
                1 + Math.floor(random() * 9),
                random(),
                random,
            );
            const view = {
                scale: [1, 2, 3, 4, 5, 8][Math.floor(random() * 6)] ?? 1,
                originX: Math.floor(random() * 60) - 20,
                originY: Math.floor(random() * 50) - 20,
            };
            const rects = ringOf(mask, view, size);
            expect([...pixelsOf(rects)].sort(), `round ${round}`).toEqual(
                [...bruteRing(mask, view, size)].sort(),
            );
            for (const rect of rects) {
                expect(Math.min(rect.width, rect.height)).toBe(1);
                expect(rect.x >= 0 && rect.y >= 0).toBe(true);
                expect(rect.x + rect.width <= size.width).toBe(true);
                expect(rect.y + rect.height <= size.height).toBe(true);
            }
        }
    });

    it("looks only at the part of the boundary on the canvas", () => {
        // A 512² checkerboard has about half a million edges; at 16× a 320 × 240 canvas shows
        // 20 × 15 texels of it.
        const mask = checkerboard(512);
        const boundary = selectionBoundary(mask);
        const total = boundary.horizontal.length + boundary.vertical.length;
        expect(total).toBeGreaterThan(500_000);
        const size = { width: 320, height: 240 };
        const view = { scale: 16, originX: -16 * 200 - 5, originY: -16 * 300 - 9 };
        const rects: DeviceRect[] = [];
        const examined = forEachRingRect(boundary, axesFor(mask, view, size), size, (rect) =>
            rects.push(rect),
        );
        expect(examined).toBeLessThan(2000);
        expect([...pixelsOf(rects)].sort()).toEqual([...bruteRing(mask, view, size)].sort());
    });

    it("at the overview steps every run keeps at least one pixel, on the canvas", () => {
        const mask = maskOf(["#.#.#.#.", "........", "#.#.#.#."]);
        const size = { width: 30, height: 20 };
        // At ½× across, a texel of odd column rounds to no device column.
        const rect = { x: 4, y: 4, width: 4, height: 2 };
        const rects = antsRing(selectionBoundary(mask), axesOf(rect, mask, size), size);
        expect(rects.length).toBeGreaterThan(0);
        for (const ring of rects) {
            expect(ring.width).toBeGreaterThan(0);
            expect(ring.height).toBeGreaterThan(0);
            expect(Math.min(ring.width, ring.height)).toBe(1);
        }
        // Worked by hand. Columns: line p lies at 4 + round(p / 2), so the selected texels
        // 0, 2, 4 and 6 take the device columns 4, 5, 6 and 7 and the odd ones none. Rows:
        // line p lies at 4 + round(2p / 3), lines 0 to 3 at 4, 5, 5 and 6, so texel row 0 is
        // device row 4, row 1 has none and row 2 is device row 5. Every texel is alone, so each
        // gives its four edges and four corners: top edges on rows 3 (row 0) and 4 (row 2),
        // bottom edges on rows 5 and 6, all over columns 4 to 7; left and right edges on
        // columns 3 to 8 over rows 4 and 5; the corners on rows 3 to 6 at columns 3 to 8. They
        // fill the block of columns 3 to 8 and rows 3 to 6, selected texels' pixels included:
        // below 1× the ring is a sketch.
        const expected = new Set<string>();
        for (let y = 3; y <= 6; y++) for (let x = 3; x <= 8; x++) expected.add(`${x},${y}`);
        expect([...pixelsOf(rects)].sort()).toEqual([...expected].sort());
    });
});

describe("the dashes", () => {
    it("are 2 px black, 2 px white along every row and column", () => {
        expect([ANTS_DASH, ANTS_PERIOD]).toEqual([2, 4]);
        // Along a row: two dark, two light, repeating.
        expect([0, 1, 2, 3, 4, 5, 6, 7].map((x) => isDarkDash(x, 0, 0))).toEqual([
            true,
            true,
            false,
            false,
            true,
            true,
            false,
            false,
        ]);
        // And down a column.
        expect([0, 1, 2, 3, 4].map((y) => isDarkDash(7, y, 0))).toEqual([
            false,
            true,
            true,
            false,
            false,
        ]);
    });

    it("move one pixel on with each step of the phase", () => {
        for (let x = 0; x < 12; x++) {
            for (let phase = 0; phase < ANTS_PERIOD; phase++) {
                expect(isDarkDash(x + 1, 5, phase + 1)).toBe(isDarkDash(x, 5, phase));
                expect(isDarkDash(5, x + 1, phase + 1)).toBe(isDarkDash(5, x, phase));
            }
        }
        expect(isDarkDash(-3, 1, 0)).toBe(isDarkDash(1, 1, 0));
    });

    it("are the 4 × 4 tile shifted by dashShift, wherever the surface lies", () => {
        const tile = dashTile(0x102030, 0xf0e0d0);
        const tileDark = (i: number, j: number) => tile[(j * ANTS_PERIOD + i) * 4] === 0x10;
        for (let j = 0; j < ANTS_PERIOD; j++) {
            for (let i = 0; i < ANTS_PERIOD; i++) {
                const at = (j * ANTS_PERIOD + i) * 4;
                expect(Array.from(tile.slice(at, at + 4))).toEqual(
                    isDarkDash(i, j, 0) ? [0x10, 0x20, 0x30, 255] : [0xf0, 0xe0, 0xd0, 255],
                );
            }
        }
        for (const [x, y] of [
            [0, 0],
            [3, 7],
            [-5, 2],
            [101, 46],
        ] as const) {
            for (let phase = 0; phase < ANTS_PERIOD; phase++) {
                const shift = dashShift(phase, x, y);
                expect(shift >= 0 && shift < ANTS_PERIOD).toBe(true);
                for (let v = 0; v < 6; v++) {
                    for (let u = 0; u < 6; u++) {
                        const i = (((u - shift) % 4) + 4) % 4;
                        expect(tileDark(i, v % 4)).toBe(isDarkDash(x + u, y + v, phase));
                    }
                }
            }
        }
    });
});

// A software stand-in for the 2D surfaces and the overlay: just the calls the ants make,
// pixel for pixel, so the layer's output is compared with the ring and the dash rule, and
// its draw calls are counted.

/** Every method called on a stand-in context, in order, by name. */
type CallLog = string[];

function fakeSurface(width: number, height: number, log: CallLog) {
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
                for (
                    let py = Math.max(0, y + state.shiftY);
                    py < Math.min(height, y + h + state.shiftY);
                    py++
                ) {
                    for (
                        let px = Math.max(0, x + state.shiftX);
                        px < Math.min(width, x + w + state.shiftX);
                        px++
                    ) {
                        const at = (py * width + px) * 4;
                        if (pixels[at + 3] === 0) continue;
                        const i = (((px - state.shiftX) % tile.width) + tile.width) % tile.width;
                        const j = (((py - state.shiftY) % tile.width) + tile.width) % tile.width;
                        const from = (j * tile.width + i) * 4;
                        pixels.set(tile.pixels.slice(from, from + 3), at);
                        pixels[at + 3] = 255;
                    }
                }
            },
        },
    };
    return surface;
}

type FakeSurface = ReturnType<typeof fakeSurface>;

/** The overlay: `drawImage` of an opaque-or-clear surface at whole pixels. */
function fakeOverlay(size: Size, log: CallLog) {
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
                        pixels.set(source.pixels.slice(from, from + 4), (ty * size.width + tx) * 4);
                    }
                }
            },
        },
    };
}

/** What the overlay must show: the ring, black where `isDarkDash`, white elsewhere. */
function expectedPixels(ring: readonly DeviceRect[], phase: number, size: Size) {
    const pixels = new Uint8ClampedArray(size.width * size.height * 4);
    for (const key of pixelsOf(ring)) {
        const [x, y] = key.split(",").map(Number) as [number, number];
        const colour = isDarkDash(x, y, phase) ? ANTS_DARK : ANTS_LIGHT;
        pixels.set(
            [(colour >> 16) & 255, (colour >> 8) & 255, colour & 255, 255],
            (y * size.width + x) * 4,
        );
    }
    return pixels;
}

/** The first pixels where two overlay images differ, as text. */
function differences(actual: Uint8ClampedArray, expected: Uint8ClampedArray, size: Size) {
    const found: string[] = [];
    for (let index = 0; index < size.width * size.height && found.length < 5; index++) {
        const a = Array.from(actual.slice(index * 4, index * 4 + 4));
        const e = Array.from(expected.slice(index * 4, index * 4 + 4));
        if (a.join() !== e.join()) {
            found.push(`${index % size.width}, ${Math.floor(index / size.width)}: ${a} not ${e}`);
        }
    }
    return found;
}

/** Motion that the test switches. */
function switchableMotion() {
    let allowed = true;
    const listeners = new Set<() => void>();
    return {
        allowed: () => allowed,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => void listeners.delete(listener);
        },
        set(value: boolean) {
            allowed = value;
            for (const listener of listeners) listener();
        },
    };
}

/** Repeating timers that run only when the test moves the clock. */
function manualIntervals() {
    let now = 0;
    let intervals: { tick: () => void; ms: number; next: number }[] = [];
    let made = 0;
    return {
        get made() {
            return made;
        },
        every(tick: () => void, ms: number): () => void {
            made++;
            const interval = { tick, ms, next: now + ms };
            intervals.push(interval);
            return () => {
                intervals = intervals.filter((entry) => entry !== interval);
            };
        },
        advance(ms: number): void {
            const end = now + ms;
            for (;;) {
                const due = intervals
                    .filter((entry) => entry.next <= end)
                    .sort((a, b) => a.next - b.next)[0];
                if (!due) break;
                now = due.next;
                due.next += due.ms;
                due.tick();
            }
            now = end;
        },
    };
}

function setUp(
    doc: Size = { width: 8, height: 6 },
    view: View = { scale: 4, originX: 2, originY: 2 },
) {
    const sessions = createSessionsStore();
    const motion = switchableMotion();
    const timers = manualIntervals();
    const log: CallLog = [];
    const surfaces: FakeSurface[] = [];
    const { layer, probe } = createSelectionAntsLayer({
        sessions,
        motion,
        every: (tick, ms) => timers.every(tick, ms),
        surface(width, height) {
            const made = fakeSurface(width, height, log);
            surfaces.push(made);
            return made as unknown as AntsSurface;
        },
    });
    let redraws = 0;
    const open = (name = "ants") =>
        sessions
            .getState()
            .open(createDocument({ name, ...doc }, sequentialIds(`${name}-`)), { view });
    const active = (): OpenDocument => {
        const document = activeDocument(sessions.getState());
        if (!document) throw new Error("no document");
        return document;
    };
    /** Draws the layer on a fresh overlay of `size`; returns the overlay and the calls made. */
    const draw = (size: Size) => {
        const overlay = fakeOverlay(size, log);
        const from = log.length;
        const document = active();
        const frame: OverlayFrame = {
            context: overlay.context as unknown as CanvasRenderingContext2D,
            size,
            document,
            mapping: createViewMapping({
                view: document.view,
                docWidth: document.session.doc.width,
                docHeight: document.session.doc.height,
                ratio: 1,
                left: 0,
                top: 0,
            }),
            cursor: null,
            theme: DEFAULT_OVERLAY_THEME,
        };
        layer.draw(frame);
        return { pixels: overlay.pixels, calls: log.slice(from) };
    };
    /** The ring of the active document's selection under its view, worked out afresh. */
    const freshRing = (size: Size) => {
        const document = active();
        const mask = document.session.selection!.mask;
        const { scale, originX, originY } = document.view;
        return ringOf(mask, { scale, originX, originY }, size);
    };
    const stop = layer.watch!(() => void redraws++);
    return {
        sessions,
        motion,
        timers,
        layer,
        probe,
        surfaces,
        open,
        active,
        draw,
        freshRing,
        stop,
        redraws: () => redraws,
        intervals: () => timers.made,
    };
}

describe("the ants' layer", () => {
    it("is registered from its own module, over the grids and under the brush cursor", () => {
        const found = overlayLayers.find((entry) => entry.id === "selection-ants");
        expect(found?.order).toBe(SELECTION_ANTS_ORDER);
        const order = (id: string) => overlayLayers.find((entry) => entry.id === id)?.order;
        expect(SELECTION_ANTS_ORDER).toBeGreaterThan(order("tile-grid") ?? Infinity);
        expect(SELECTION_ANTS_ORDER).toBeLessThan(order("brush-cursor") ?? -Infinity);
    });

    it("has no timer and asks for no redraw while there is no selection", () => {
        const t = setUp();
        const document = t.open();
        expect(t.probe.animating).toBe(false);
        // A view change, a setting and a touch: nothing the ants draw from.
        t.sessions.getState().setView(document.id, { scale: 8 });
        t.sessions.getState().updateDocSettings(document.id, (settings) => {
            settings.pixelGrid = false;
        });
        t.sessions.getState().touch(document.id);
        t.timers.advance(2000);
        expect(t.redraws()).toBe(0);
        expect(t.intervals()).toBe(0);
        t.stop();
    });

    it("marches 8 steps per second while there is a selection and motion is allowed", () => {
        expect(ANTS_STEP_MS).toBe(125);
        const t = setUp();
        const document = t.open();
        document.history.execute(selectAllCommand(document.session)!);
        // The new selection is drawn, and the timer starts.
        expect(t.redraws()).toBe(1);
        expect(t.probe.animating).toBe(true);
        const before = t.probe.steps;
        t.timers.advance(1000);
        expect(t.probe.steps - before).toBe(8);
        expect(t.redraws()).toBe(9);
        expect(t.probe.phase).toBe((before + 8) % 4);
        // A pixel edit or a view change is not a change of the selection: no extra redraw.
        t.sessions.getState().touch(document.id);
        t.sessions.getState().setView(document.id, { scale: 8 });
        expect(t.redraws()).toBe(9);
        t.stop();
        expect(t.probe.animating).toBe(false);
        t.timers.advance(1000);
        expect(t.redraws()).toBe(9);
    });

    it("stands still under reduced motion, and stops with the selection", () => {
        const t = setUp();
        const document = t.open();
        t.motion.set(false);
        document.history.execute(selectAllCommand(document.session)!);
        expect(t.redraws()).toBe(1);
        expect(t.probe.animating).toBe(false);
        t.timers.advance(2000);
        expect(t.redraws()).toBe(1);
        // Motion allowed again: the timer starts.
        t.motion.set(true);
        expect(t.probe.animating).toBe(true);
        t.timers.advance(250);
        expect(t.redraws()).toBe(3);
        // Deselect: drawn once more without ants, and the timer is gone.
        document.history.execute(deselectCommand(document.session)!);
        expect(t.redraws()).toBe(4);
        expect(t.probe.animating).toBe(false);
        t.timers.advance(2000);
        expect(t.redraws()).toBe(4);
        // Undo brings the selection, and the timer, back.
        document.history.undo();
        expect(t.redraws()).toBe(5);
        expect(t.probe.animating).toBe(true);
        t.stop();
    });

    it("follows the active document's selection", () => {
        const t = setUp();
        const first = t.open("first");
        first.history.execute(selectAllCommand(first.session)!);
        expect(t.probe.animating).toBe(true);
        const second = t.open("second");
        expect(t.active().id).toBe(second.id);
        expect(t.probe.animating).toBe(false);
        const redraws = t.redraws();
        // A selection in a document that is not the active one draws nothing.
        t.sessions.getState().activate(second.id);
        first.history.undo();
        first.history.redo();
        expect(t.redraws()).toBe(redraws);
        t.sessions.getState().activate(first.id);
        expect(t.probe.animating).toBe(true);
        t.sessions.getState().close(first.id);
        expect(t.probe.animating).toBe(false);
        t.stop();
    });

    it("draws exactly the ring, black where isDarkDash says and white elsewhere, at every phase; nothing without a selection", () => {
        const t = setUp();
        const document = t.open();
        const size = { width: 80, height: 60 };
        const empty = t.draw(size);
        expect(empty.calls).toEqual([]);
        expect(empty.pixels.every((value) => value === 0)).toBe(true);

        const shape = maskOf([
            "........",
            ".###....",
            ".#.#....",
            ".###...#",
            "........",
            "#.......",
        ]);
        document.history.execute(selectCommand(document.session, shape, "replace", "Select")!);
        const ring = t.freshRing(size);
        expect(ring.length).toBeGreaterThan(0);
        for (let step = 0; step < ANTS_PERIOD + 1; step++) {
            const { pixels } = t.draw(size);
            expect(differences(pixels, expectedPixels(ring, t.probe.phase, size), size)).toEqual(
                [],
            );
            t.timers.advance(ANTS_STEP_MS);
        }
        t.stop();
    });

    it("paints the ring afresh for another view or canvas size, and only then", () => {
        const t = setUp();
        const document = t.open();
        const shape = maskOf([
            "........",
            ".####...",
            ".#..#.#.",
            ".####...",
            "........",
            "........",
        ]);
        document.history.execute(selectCommand(document.session, shape, "replace", "Select")!);
        const check = (size: Size) => {
            const { pixels, calls } = t.draw(size);
            expect(
                differences(pixels, expectedPixels(t.freshRing(size), t.probe.phase, size), size),
            ).toEqual([]);
            return calls;
        };
        const first = { width: 80, height: 60 };
        expect(check(first)).toContain("putImageData");
        // The same view and size: the painted ring is kept.
        expect(check(first)).not.toContain("putImageData");
        // Another scale and origin.
        t.sessions.getState().setView(document.id, { scale: 3, originX: 9, originY: 5 });
        expect(check(first)).toContain("putImageData");
        // Another canvas size, the view as it is; then one that cuts the ring off.
        expect(check({ width: 50, height: 41 })).toContain("putImageData");
        expect(check({ width: 13, height: 12 })).toContain("putImageData");
        // Back to the first view and size.
        t.sessions.getState().setView(document.id, { scale: 4, originX: 2, originY: 2 });
        expect(check(first)).toContain("putImageData");
        t.stop();
    });

    it("redraws in the same few draw calls for a rectangle and a 256² checkerboard", () => {
        const doc = { width: 256, height: 256 };
        const view = { scale: 1, originX: 10, originY: 10 };
        const size = { width: 300, height: 290 };
        const calls = (mask: BitMask) => {
            const t = setUp(doc, view);
            const document = t.open();
            document.history.execute(selectCommand(document.session, mask, "replace", "Select")!);
            const build = t.draw(size).calls;
            const same = t.draw(size).calls;
            t.timers.advance(ANTS_STEP_MS);
            const stepped = t.draw(size).calls;
            // The output is right for both.
            const { pixels } = t.draw(size);
            expect(
                differences(pixels, expectedPixels(t.freshRing(size), t.probe.phase, size), size),
            ).toEqual([]);
            t.stop();
            return { build, same, stepped };
        };
        const rectangle = calls(rectMask(256, 256, { x: 20, y: 30, width: 100, height: 60 }));
        const board = calls(checkerboard(256));
        expect(board).toEqual(rectangle);
        // A redraw with the phase unchanged is one drawImage; a new phase recolours first.
        expect(rectangle.same).toEqual(["drawImage"]);
        expect(rectangle.stepped).toEqual([
            "save",
            "translate",
            "fillRect",
            "restore",
            "drawImage",
        ]);
        expect(rectangle.build.length).toBeLessThanOrEqual(12);
    });

    it("never makes a surface larger than the canvas, and none when no ring pixel is on it", () => {
        const doc = { width: 1024, height: 1024 };
        const size = { width: 640, height: 400 };
        // 8×: the document is 8192 device pixels a side; the selection's edge crosses the canvas.
        const t = setUp(doc, { scale: 8, originX: -300, originY: -200 });
        const document = t.open();
        const mask = rectMask(1024, 1024, { x: 0, y: 0, width: 100, height: 1024 });
        document.history.execute(selectCommand(document.session, mask, "replace", "Select")!);
        const { pixels } = t.draw(size);
        expect(
            differences(pixels, expectedPixels(t.freshRing(size), t.probe.phase, size), size),
        ).toEqual([]);
        expect(t.surfaces.length).toBeGreaterThan(0);
        for (const surface of t.surfaces) {
            expect(surface.width).toBeLessThanOrEqual(size.width);
            expect(surface.height).toBeLessThanOrEqual(size.height);
        }
        // Select All at 8×: the document covers the canvas, the ring lies outside it.
        const made = t.surfaces.length;
        document.history.execute(selectAllCommand(document.session)!);
        const covered = t.draw(size);
        expect(covered.calls).toEqual([]);
        expect(t.surfaces.length).toBe(made);
        // The area of a ring is the bounding rectangle of its pixels.
        const boundary = selectionBoundary(mask);
        const axes = axesFor(mask, { scale: 8, originX: -300, originY: -200 }, size);
        expect(ringArea(boundary, axes, size)).toEqual({ x: 500, y: 0, width: 1, height: 400 });
        t.stop();
    });
});
