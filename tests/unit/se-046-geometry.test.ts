import { describe, expect, it } from "vitest";
import {
    hitReferenceCorner,
    minimumReferenceScale,
    moveReferenceBy,
    REFERENCE_CORNERS,
    referenceBox,
    scaleReferenceFrom,
} from "../../src/app/references/referenceTransform";
import { HANDLE_REACH, HANDLE_IDS, HANDLES } from "../../src/app/selection/transform/handles";
import {
    MAX_REFERENCE_OFFSET,
    MAX_REFERENCE_SCALE,
    MIN_REFERENCE_SCALE,
} from "../../src/core/project/format";
import { assertReferenceChange } from "../../src/core/references";
import type { ReferencePlacement } from "../../src/core/references";

// SE-046: the geometry of a reference layer's drag (SPEC §7.6; DESIGN §5.2) — its box, the
// corners a press takes, the uniform scale about the opposite corner, and the bounds a file
// holds (FORMAT.md §1.8), which a drag keeps rather than throws at (SE-033 review A).

const SIZE = { width: 30, height: 16 };
const START: ReferencePlacement = { x: 1.25, y: -3.5, scale: 0.75 };

function corner(placement: ReferencePlacement, h: number, v: number) {
    return {
        x: placement.x + (h > 0 ? SIZE.width * placement.scale : 0),
        y: placement.y + (v > 0 ? SIZE.height * placement.scale : 0),
    };
}

describe("referenceBox and hitReferenceCorner", () => {
    it("is the source's size times the scale at the layer's position, never turned", () => {
        expect(referenceBox(START, SIZE)).toEqual({
            x: 1.25,
            y: -3.5,
            width: 22.5,
            height: 12,
            angle: 0,
        });
    });

    it("takes the corners only, within the handle's reach in CSS pixels at the view's scale", () => {
        const box = referenceBox(START, SIZE);
        const scale = 4;
        for (const id of REFERENCE_CORNERS) {
            const { h, v } = HANDLES[id];
            const at = corner(START, h, v);
            // Exactly on it, and at the edge of the reach on both axes (device pixels / scale).
            expect(hitReferenceCorner(box, at, scale, 1)).toBe(id);
            const edge = HANDLE_REACH / scale;
            expect(hitReferenceCorner(box, { x: at.x + edge, y: at.y - edge }, scale, 1)).toBe(id);
            // Beyond it at ratio 1; within it at ratio 1.5, whose handles are larger.
            const beyond = { x: at.x + (HANDLE_REACH + 1) / scale, y: at.y };
            expect(hitReferenceCorner(box, beyond, scale, 1)).toBeNull();
            expect(hitReferenceCorner(box, beyond, scale, 1.5)).toBe(id);
        }
        // The middles of the sides are no handles of a reference layer.
        const sides = HANDLE_IDS.filter((id) => !(REFERENCE_CORNERS as string[]).includes(id));
        expect(sides).toHaveLength(4);
        for (const id of sides) {
            const { h, v } = HANDLES[id];
            const at = {
                x: START.x + ((h + 1) / 2) * box.width,
                y: START.y + ((v + 1) / 2) * box.height,
            };
            expect(hitReferenceCorner(box, at, scale, 1)).toBeNull();
        }
        // Inside the box, away from the corners.
        expect(hitReferenceCorner(box, { x: 10, y: 2 }, scale, 1)).toBeNull();
    });
});

describe("scaleReferenceFrom", () => {
    it("scales both sides by one factor about the opposite corner, within 0.01 document pixels", () => {
        for (const id of REFERENCE_CORNERS) {
            const { h, v } = HANDLES[id];
            const fixed = corner(START, -h, -v);
            for (const [dx, dy] of [
                [3, 0.5],
                [-2.25, 0.1],
                [0.2, 4.75],
                [7.5, -6],
            ] as const) {
                const after = scaleReferenceFrom(START, SIZE, id, h * dx, v * dy);
                const moved = corner(after, -h, -v);
                expect(Math.abs(moved.x - fixed.x), `${id} ${dx} ${dy}`).toBeLessThanOrEqual(0.01);
                expect(Math.abs(moved.y - fixed.y), `${id} ${dx} ${dy}`).toBeLessThanOrEqual(0.01);
                // The axis whose factor is farther from 1 decides (as SE-033's corner with Shift).
                const factorH = (SIZE.width * START.scale + dx) / (SIZE.width * START.scale);
                const factorV = (SIZE.height * START.scale + dy) / (SIZE.height * START.scale);
                const factor = Math.abs(factorH - 1) >= Math.abs(factorV - 1) ? factorH : factorV;
                expect(after.scale, `${id} ${dx} ${dy}`).toBeCloseTo(START.scale * factor, 12);
            }
        }
    });

    it("stops at a longer side of one document pixel, and at the largest scale a file holds", () => {
        const fixed = corner(START, -1, -1);
        const small = scaleReferenceFrom(START, SIZE, "se", -1000, -1000);
        expect(small.scale).toBe(minimumReferenceScale(SIZE));
        expect(minimumReferenceScale(SIZE)).toBe(1 / 30);
        expect(corner(small, -1, -1)).toEqual(fixed);
        expect(minimumReferenceScale({ width: 1e7, height: 1 })).toBe(MIN_REFERENCE_SCALE);

        const large = scaleReferenceFrom(START, SIZE, "se", 1e12, 0);
        expect(large.scale).toBe(MAX_REFERENCE_SCALE);
        expect(() => assertReferenceChange(large)).not.toThrow();
    });

    it("returns the start itself with no travel, also where the corners' positions round (review A)", () => {
        const fitted = [
            { x: 0, y: 1.7333333333333343, scale: 0.5333333333333332 },
            START,
            { x: 3.55e-15, y: 0.1, scale: 1 / 3 },
        ];
        for (const start of fitted) {
            for (const id of REFERENCE_CORNERS) {
                expect(scaleReferenceFrom(start, SIZE, id, 0, 0), id).toBe(start);
            }
        }
    });

    it("keeps a scale already below the minimum at a press, and lets it grow (review B)", () => {
        const tiny = { x: 4, y: 5, scale: MIN_REFERENCE_SCALE * 10 };
        expect(tiny.scale).toBeLessThan(minimumReferenceScale(SIZE));
        for (const id of REFERENCE_CORNERS) {
            expect(scaleReferenceFrom(tiny, SIZE, id, 0, 0), id).toBe(tiny);
        }
        // Smaller still is not taken; larger is.
        expect(scaleReferenceFrom(tiny, SIZE, "se", -1, -1).scale).toBe(tiny.scale);
        expect(scaleReferenceFrom(tiny, SIZE, "se", 1, 0).scale).toBeGreaterThan(tiny.scale);
    });

    it("keeps the position within a file's bounds when the opposite corner would leave them", () => {
        const far = { x: MAX_REFERENCE_OFFSET - 1, y: 0, scale: 1 };
        const after = scaleReferenceFrom(far, SIZE, "nw", -1e9, 0);
        expect(after.x).toBe(-MAX_REFERENCE_OFFSET);
        expect(() => assertReferenceChange(after)).not.toThrow();
    });
});

describe("moveReferenceBy", () => {
    it("moves by the delta, keeping the fraction and the scale, within a file's bounds", () => {
        expect(moveReferenceBy(START, 10, 4)).toEqual({ x: 11.25, y: 0.5, scale: 0.75 });
        expect(moveReferenceBy(START, 3e6, -3e6)).toEqual({
            x: MAX_REFERENCE_OFFSET,
            y: -MAX_REFERENCE_OFFSET,
            scale: 0.75,
        });
    });
});
