import { describe, expect, it } from "vitest";
import { axesOf } from "../../src/app/overlay/gridLines";
import { overlayLayers } from "../../src/app/overlay/overlayLayers";
import { DEFAULT_OVERLAY_THEME } from "../../src/app/overlay/types";
import type { OverlayFrame } from "../../src/app/overlay/types";
import {
    ANTS_DASH,
    ANTS_PERIOD,
    antsDashes,
    antsRing,
    isDarkDash,
} from "../../src/app/selection/antsGeometry";
import {
    ANTS_DARK,
    ANTS_LIGHT,
    ANTS_STEP_MS,
    createSelectionAntsLayer,
    SELECTION_ANTS_ORDER,
} from "../../src/app/selection/selectionAnts.overlay";
import { activeDocument, createSessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { createViewMapping } from "../../src/app/view/coordinates";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { BitMask } from "../../src/core/model";
import {
    deselectCommand,
    maskHas,
    selectAllCommand,
    selectCommand,
    selectionBoundary,
} from "../../src/core/selection";
import type { DeviceRect } from "../../src/engine/viewport/geometry";
import { maskOf, randomMask, seeded } from "./se-030-support";

// SE-030: the marching ants (DESIGN §6). Their ring is the device pixels just outside the
// selected texels, diagonals included, checked here against a brute-force ring worked out in
// device space; their dashes are 2 px black, 2 px white along every row and column; and the
// layer's timer runs only while there is a selection and motion is allowed.

type View = { scale: number; originX: number; originY: number };

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
function bruteRing(mask: BitMask, view: View, size: { width: number; height: number }) {
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

function ringOf(mask: BitMask, view: View, size: { width: number; height: number }) {
    const rect = {
        x: view.originX,
        y: view.originY,
        width: mask.width * view.scale,
        height: mask.height * view.scale,
    };
    return antsRing(selectionBoundary(mask), axesOf(rect, mask, size), size);
}

const L_SHAPE = maskOf([".....", ".#...", ".#...", ".###.", "....."]);
const HOLE = maskOf([".....", ".###.", ".#.#.", ".###.", "....."]);
const DIAGONAL = maskOf(["#..", ".#.", "..#"]);
const EDGES = maskOf(["##..##", "#.....", "......", ".....#"]);

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
            ringOf(
                mask,
                { scale: 3, originX: 10, originY: 20 },
                {
                    width: 40,
                    height: 40,
                },
            ),
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
            ringOf(
                HOLE,
                { scale: 3, originX: 0, originY: 0 },
                {
                    width: 40,
                    height: 40,
                },
            ),
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

    it("at the overview steps every run keeps at least one pixel, on the canvas", () => {
        const mask = maskOf(["#.#.#.#.", "........", "#.#.#.#."]);
        const size = { width: 30, height: 20 };
        // At ½× a texel of odd column rounds to no device column.
        const rect = { x: 4, y: 4, width: 4, height: 2 };
        const rects = antsRing(selectionBoundary(mask), axesOf(rect, mask, size), size);
        expect(rects.length).toBeGreaterThan(0);
        for (const ring of rects) {
            expect(ring.width).toBeGreaterThan(0);
            expect(ring.height).toBeGreaterThan(0);
            expect(Math.min(ring.width, ring.height)).toBe(1);
        }
    });
});

describe("the dashes", () => {
    it("are 2 px black, 2 px white along every row and column of the ring", () => {
        expect([ANTS_DASH, ANTS_PERIOD]).toEqual([2, 4]);
        const size = { width: 64, height: 48 };
        const ring = ringOf(L_SHAPE, { scale: 5, originX: 3, originY: 4 }, size);
        for (const phase of [0, 1, 2, 3]) {
            const dark = pixelsOf(antsDashes(ring, phase));
            const all = pixelsOf(ring);
            for (const pixel of dark) expect(all.has(pixel)).toBe(true);
            for (const pixel of all) {
                const [x, y] = pixel.split(",").map(Number) as [number, number];
                expect(dark.has(pixel), `${pixel} at phase ${phase}`).toBe(isDarkDash(x, y, phase));
            }
        }
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
});

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

/** A 2D context that records the rectangles of each fill with its style. */
function recordingContext() {
    const fills: { style: string; rects: DeviceRect[] }[] = [];
    let path: DeviceRect[] = [];
    const context = {
        fills,
        fillStyle: "",
        beginPath: () => void (path = []),
        rect: (x: number, y: number, width: number, height: number) =>
            void path.push({ x, y, width, height }),
        fill: () => void fills.push({ style: context.fillStyle, rects: path }),
    };
    return context;
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

function setUp() {
    const sessions = createSessionsStore();
    const motion = switchableMotion();
    const timers = manualIntervals();
    const { layer, probe } = createSelectionAntsLayer({
        sessions,
        motion,
        every: (tick, ms) => timers.every(tick, ms),
    });
    let redraws = 0;
    const open = (name = "ants") =>
        sessions
            .getState()
            .open(createDocument({ name, width: 8, height: 6 }, sequentialIds(`${name}-`)), {
                view: { scale: 4, originX: 2, originY: 2 },
            });
    const active = (): OpenDocument => {
        const document = activeDocument(sessions.getState());
        if (!document) throw new Error("no document");
        return document;
    };
    const stop = layer.watch!(() => void redraws++);
    return {
        sessions,
        motion,
        timers,
        layer,
        probe,
        open,
        active,
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

    it("draws the ring in white and its dark dashes in black, and nothing without a selection", () => {
        const t = setUp();
        const document = t.open();
        const frame = (context: ReturnType<typeof recordingContext>): OverlayFrame => ({
            context: context as unknown as CanvasRenderingContext2D,
            size: { width: 80, height: 60 },
            document: t.active(),
            mapping: createViewMapping({
                view: t.active().view,
                docWidth: 8,
                docHeight: 6,
                ratio: 1,
                left: 0,
                top: 0,
            }),
            cursor: null,
            theme: DEFAULT_OVERLAY_THEME,
        });
        const empty = recordingContext();
        t.layer.draw(frame(empty));
        expect(empty.fills).toEqual([]);

        const shape = maskOf([
            "........",
            ".###....",
            ".#.#....",
            ".###....",
            "........",
            "........",
        ]);
        document.history.execute(selectCommand(document.session, shape, "replace", "Select")!);
        const drawn = recordingContext();
        t.layer.draw(frame(drawn));
        const size = { width: 80, height: 60 };
        const ring = ringOf(shape, { scale: 4, originX: 2, originY: 2 }, size);
        expect(drawn.fills.map((fill) => fill.style)).toEqual([
            `rgb(${ANTS_LIGHT >> 16} ${(ANTS_LIGHT >> 8) & 255} ${ANTS_LIGHT & 255} / 1)`,
            `rgb(${ANTS_DARK >> 16} ${(ANTS_DARK >> 8) & 255} ${ANTS_DARK & 255} / 1)`,
        ]);
        expect(pixelsOf(drawn.fills[0]!.rects)).toEqual(pixelsOf(ring));
        expect(pixelsOf(drawn.fills[1]!.rects)).toEqual(pixelsOf(antsDashes(ring, t.probe.phase)));
        t.stop();
    });
});
