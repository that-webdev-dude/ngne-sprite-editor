import { describe, expect, it } from "vitest";
import {
    axesOf,
    axisLines,
    cellsBetween,
    lineRects,
    outlineRects,
    PIXEL_GRID_MIN_SCALE,
    pixelGridLines,
    TILE_GRID_MIN_SPACING,
    tileGridLines,
    visiblePart,
} from "../../src/app/overlay/gridLines";
import type { Axis } from "../../src/app/overlay/gridLines";
import { createViewMapping } from "../../src/app/view/coordinates";
import { ZOOM_STEPS } from "../../src/app/view/zoom";
import type { GridSettings } from "../../src/core/model";
import { documentRect } from "../../src/engine/viewport/geometry";
import type { DeviceRect } from "../../src/engine/viewport/geometry";

// SE-013: where the overlay's lines go, in device pixels of the overlay canvas. A line lies on
// the first device pixel of a texel (of a tile), the document's first one included, as in the
// design mockup; NGNE starts that texel there (`documentRect`, the rectangle the engine draws
// the frame over).

const CANVAS = { width: 900, height: 500 };

function axis(origin: number, scale: number, length: number, canvas = CANVAS.width): Axis {
    return { origin, extent: Math.max(1, Math.round(length * scale)), length, canvas };
}

function grid(settings: Partial<GridSettings> = {}): GridSettings {
    return { width: 16, height: 16, offsetX: 0, offsetY: 0, visible: true, ...settings };
}

/** Every device pixel of a list of rectangles, as "x,y", counting repeats. */
function pixels(rects: readonly DeviceRect[]): Map<string, number> {
    const covered = new Map<string, number>();
    for (const rect of rects) {
        for (let y = rect.y; y < rect.y + rect.height; y++) {
            for (let x = rect.x; x < rect.x + rect.width; x++) {
                covered.set(`${x},${y}`, (covered.get(`${x},${y}`) ?? 0) + 1);
            }
        }
    }
    return covered;
}

describe("pixel grid", () => {
    it("puts a line on the first device pixel of every texel, the first included, at 8×, 12× and 16×", () => {
        for (const scale of [8, 12, 16]) {
            for (const origin of [0, 37, 40, 101]) {
                const along = axis(origin, scale, 12);
                const expected = Array.from({ length: 12 }, (_, index) => origin + index * scale);
                expect(axisLines(along, 0, 1), `${scale}× at ${origin}`).toEqual(expected);
                // The same pixel the mapping names as the start of that texel.
                const mapping = createViewMapping({
                    view: { scale, originX: origin, originY: 0 },
                    docWidth: 12,
                    docHeight: 1,
                    ratio: 1.5,
                    left: 44,
                    top: 72,
                });
                for (const [index, column] of expected.entries()) {
                    expect(mapping.docToDevice(index, 0).x).toBe(column);
                    expect(mapping.deviceToDoc(column, 0).x).toBe(index);
                    expect(mapping.deviceToDoc(column - 1, 0).x).toBeLessThan(index);
                }
                // Nothing at the document's far edge: that pixel is the outline's.
                expect(expected).not.toContain(origin + 12 * scale);
            }
        }
    });

    it("is drawn from 8× up and not below", () => {
        const doc = { width: 12, height: 9 };
        // Large enough for the whole document at 64×.
        const canvas = { width: 1000, height: 1000 };
        for (const scale of ZOOM_STEPS) {
            const view = { scale, originX: 20, originY: 10 };
            const lines = pixelGridLines(axesOf(documentRect(view, 12, 9), doc, canvas), scale);
            if (scale >= PIXEL_GRID_MIN_SCALE) {
                expect(lines.columns, `${scale}×`).toHaveLength(12);
                expect(lines.rows, `${scale}×`).toHaveLength(9);
                expect(lines.columns[0], `${scale}×`).toBe(20);
                expect(lines.rows[0], `${scale}×`).toBe(10);
            } else {
                expect(lines, `${scale}×`).toEqual({ columns: [], rows: [] });
            }
        }
        expect(PIXEL_GRID_MIN_SCALE).toBe(8);
    });

    it("keeps only the lines on the canvas, and looks only at those", () => {
        // 1024 texels at 64×: 65 536 device pixels, of which 900 are on the canvas.
        const along = axis(-30_001, 64, 1024);
        const lines = axisLines(along, 0, 1);
        expect(lines[0]).toBe(-30_001 + 469 * 64);
        expect(lines.every((x) => x >= 0 && x < CANVAS.width)).toBe(true);
        expect(lines).toHaveLength(14);
        for (const [index, x] of lines.entries()) {
            if (index > 0) expect(x - (lines[index - 1] ?? 0)).toBe(64);
        }
        // Wholly off the canvas, on either side.
        expect(axisLines(axis(-5000, 8, 32), 0, 1)).toEqual([]);
        expect(axisLines(axis(CANVAS.width, 8, 32), 0, 1)).toEqual([]);
        // A texel that starts at the canvas's first pixel has its line; one that starts at its
        // last pixel too.
        expect(axisLines(axis(-8, 8, 4), 0, 1)).toEqual([0, 8, 16]);
        expect(axisLines(axis(CANVAS.width - 9, 8, 4), 0, 1)).toEqual([
            CANVAS.width - 9,
            CANVAS.width - 1,
        ]);
    });

    it("has one line in a document one pixel wide, on its first device pixel", () => {
        expect(axisLines(axis(10, 16, 1), 0, 1)).toEqual([10]);
    });
});

describe("tile grid", () => {
    it("puts a line at offset + n × size inside the document, for offsets on either side", () => {
        const along = axis(30, 8, 20);
        // With no offset the first tile starts at the document's corner, and has its line.
        expect(axisLines(along, 0, 5)).toEqual([0, 5, 10, 15].map((x) => 30 + x * 8));
        expect(axisLines(along, 2, 5)).toEqual([2, 7, 12, 17].map((x) => 30 + x * 8));
        expect(axisLines(along, -1, 5)).toEqual([4, 9, 14, 19].map((x) => 30 + x * 8));
        expect(axisLines(along, 23, 5)).toEqual([3, 8, 13, 18].map((x) => 30 + x * 8));
        expect(axisLines(along, -21, 5)).toEqual([4, 9, 14, 19].map((x) => 30 + x * 8));
        // A cell larger than the document: only the line inside it, or none.
        expect(axisLines(along, 7, 64)).toEqual([30 + 7 * 8]);
        expect(axisLines(along, 0, 64)).toEqual([30]);
        expect(axisLines(along, 64, 64)).toEqual([30]);
        expect(axisLines(along, 20, 64)).toEqual([]);
        expect(axisLines(along, -44, 64)).toEqual([]);
    });

    it("is drawn along an axis while a cell is at least 4 device pixels on screen", () => {
        const doc = { width: 64, height: 64 };
        // Offsets of 1: a line near the corner is on the canvas at every step.
        const settings = grid({ width: 16, height: 8, offsetX: 1, offsetY: 1 });
        for (const scale of ZOOM_STEPS) {
            const rect = documentRect({ scale, originX: 3, originY: 5 }, 64, 64);
            const lines = tileGridLines(axesOf(rect, doc, CANVAS), settings);
            expect(lines.columns.length > 0, `columns at ${scale}×`).toBe(16 * scale >= 4);
            expect(lines.rows.length > 0, `rows at ${scale}×`).toBe(8 * scale >= 4);
        }
        expect(TILE_GRID_MIN_SPACING).toBe(4);
    });

    it("at the overview steps rounds each line to a device pixel, each once", () => {
        const along = axis(10, 1 / 4, 256);
        expect(along.extent).toBe(64);
        expect(axisLines(along, 0, 16)).toEqual(
            Array.from({ length: 16 }, (_, index) => 10 + index * 4),
        );
        // 1/8 of a 37-pixel document is 5 device pixels (rounded): positions are rounded.
        const odd = axis(0, 1 / 8, 37);
        expect(odd.extent).toBe(5);
        expect(axisLines(odd, 0, 8)).toEqual([0, 1, 2, 3, 4]);
        // A position that rounds onto the document's far edge is left to the outline.
        expect(axisLines(odd, 0, 1)).toEqual([0, 1, 2, 3, 4]);
        expect(axisLines(odd, 36, 37)).toEqual([]);
    });
});

describe("rectangles", () => {
    it("takes the part of the document on the canvas", () => {
        expect(visiblePart({ x: -10, y: 20, width: 100, height: 40 }, CANVAS)).toEqual({
            x: 0,
            y: 20,
            width: 90,
            height: 40,
        });
        expect(visiblePart({ x: 850, y: 480, width: 100, height: 40 }, CANVAS)).toEqual({
            x: 850,
            y: 480,
            width: 50,
            height: 20,
        });
        expect(visiblePart({ x: 900, y: 0, width: 10, height: 10 }, CANVAS)).toBeNull();
        expect(visiblePart({ x: -10, y: 0, width: 10, height: 10 }, CANVAS)).toBeNull();
    });

    it("draws each line across the visible document, 1 device pixel wide", () => {
        const area = { x: 40, y: 24, width: 96, height: 64 };
        expect(lineRects({ columns: [48, 56], rows: [32] }, area)).toEqual([
            { x: 48, y: 24, width: 1, height: 64 },
            { x: 56, y: 24, width: 1, height: 64 },
            { x: 40, y: 32, width: 96, height: 1 },
        ]);
    });

    it("leaves cells between the lines that cover the rest of the area exactly once", () => {
        const area = { x: 7, y: 3, width: 40, height: 30 };
        const lines = { columns: [7, 15, 16, 30, 46], rows: [10, 20, 32] };
        const cells = cellsBetween(lines, area);
        const inCells = pixels(cells);
        const onLines = pixels(lineRects(lines, area));
        for (let y = area.y; y < area.y + area.height; y++) {
            for (let x = area.x; x < area.x + area.width; x++) {
                const key = `${x},${y}`;
                // A pixel is on a line or in exactly one cell, never both.
                expect(onLines.has(key) ? 0 : 1, key).toBe(inCells.get(key) ?? 0);
            }
        }
        expect([...inCells.keys()].every((key) => !onLines.has(key))).toBe(true);
        // No lines: the area itself.
        expect(cellsBetween({ columns: [], rows: [] }, area)).toEqual([area]);
    });

    it("puts the outline 1 device pixel outside the document, all round", () => {
        const rect = { x: 40, y: 24, width: 40, height: 24 };
        const ring = pixels(outlineRects(rect));
        const expected = new Set<string>();
        for (let x = 39; x <= 80; x++) expected.add(`${x},23`).add(`${x},48`);
        for (let y = 24; y < 48; y++) expected.add(`39,${y}`).add(`80,${y}`);
        expect(new Set(ring.keys())).toEqual(expected);
        // Each pixel once: the corners are not painted twice.
        expect([...ring.values()].every((count) => count === 1)).toBe(true);
    });
});
