import { describe, expect, it } from "vitest";
import {
    ANGLE_SNAP,
    HANDLE_IDS,
    HANDLE_REACH,
    handlePoints,
    hitBox,
    ROTATE_REACH,
    rotateBoxTo,
    scaleBox,
} from "../../src/app/selection/transform/handles";
import type { FreeTransform } from "../../src/core/floating";

// SE-033: the geometry of a transform box's handles (DESIGN §5.2, §6), shared by the overlay
// and the Move tool (and SE-046's reference layers): where the eight handles are, what a press
// hits at a zoom and a device pixel ratio, how a handle drag scales the box with the opposite
// side kept (Shift: the aspect ratio), and how a drag outside it turns it (Shift: 15° steps).

const BOX: FreeTransform = { x: 2, y: 1, width: 4, height: 2, angle: 0 };

describe("handles", () => {
    it("sit on the corners and the middles of the sides, turned with the box", () => {
        const points = Object.fromEntries(handlePoints(BOX).map(({ id, point }) => [id, point]));
        expect(Object.keys(points).sort()).toEqual([...HANDLE_IDS].sort());
        expect(points).toEqual({
            nw: { x: 2, y: 1 },
            ne: { x: 6, y: 1 },
            se: { x: 6, y: 3 },
            sw: { x: 2, y: 3 },
            n: { x: 4, y: 1 },
            e: { x: 6, y: 2 },
            s: { x: 4, y: 3 },
            w: { x: 2, y: 2 },
        });
        // A quarter turn about the centre (4, 2): the north-west corner goes to the north-east.
        const turned = handlePoints({ ...BOX, angle: 90 });
        const nw = turned.find(({ id }) => id === "nw")!.point;
        expect(nw.x).toBeCloseTo(5);
        expect(nw.y).toBeCloseTo(0);
    });

    it("a press hits a handle within its reach in device pixels, the nearest one; inside; the ring around; beyond it nothing", () => {
        const scale = 8;
        const ratio = 1.5;
        const reach = (HANDLE_REACH * ratio) / scale;
        expect(hitBox(BOX, { x: 6 + reach * 0.9, y: 3 - reach * 0.9 }, scale, ratio)).toEqual({
            kind: "handle",
            handle: "se",
        });
        expect(hitBox(BOX, { x: 4.1, y: 1 }, scale, ratio)).toEqual({
            kind: "handle",
            handle: "n",
        });
        expect(hitBox(BOX, { x: 3, y: 2 }, scale, ratio)).toEqual({ kind: "inside" });
        const ring = (ROTATE_REACH * ratio) / scale;
        expect(hitBox(BOX, { x: 6 + ring * 0.9, y: 2.5 }, scale, ratio)).toEqual({
            kind: "rotate",
        });
        expect(hitBox(BOX, { x: 6 + ring * 1.1, y: 2.5 }, scale, ratio)).toEqual({
            kind: "outside",
        });
        // At a higher zoom the same document distance is farther on screen.
        expect(hitBox(BOX, { x: 6 + ring * 0.9, y: 2.5 }, scale * 2, ratio)).toEqual({
            kind: "outside",
        });
    });
});

describe("a handle drag", () => {
    it("moves the handle's sides to the nearest pixel boundaries; the opposite sides stay", () => {
        expect(scaleBox(BOX, "se", { x: 10.4, y: 5.6 }, false)).toEqual({
            x: 2,
            y: 1,
            width: 8,
            height: 5,
            angle: 0,
        });
        expect(scaleBox(BOX, "w", { x: -1.2, y: 9 }, false)).toEqual({
            x: -1,
            y: 1,
            width: 7,
            height: 2,
            angle: 0,
        });
        expect(scaleBox(BOX, "n", { x: 0, y: -3 }, false)).toEqual({
            x: 2,
            y: -3,
            width: 4,
            height: 6,
            angle: 0,
        });
        // Past the opposite side: never less than 1 px.
        expect(scaleBox(BOX, "e", { x: -5, y: 2 }, false)).toEqual({
            x: 2,
            y: 1,
            width: 1,
            height: 2,
            angle: 0,
        });
    });

    it("with Shift keeps the aspect ratio: a corner by its larger change, a side centred", () => {
        expect(scaleBox(BOX, "se", { x: 14, y: 3.2 }, true)).toEqual({
            x: 2,
            y: 1,
            width: 12,
            height: 6,
            angle: 0,
        });
        expect(scaleBox(BOX, "nw", { x: 2, y: -1 }, true)).toEqual({
            x: -2,
            y: -1,
            width: 8,
            height: 4,
            angle: 0,
        });
        expect(scaleBox(BOX, "e", { x: 10, y: 2 }, true)).toEqual({
            x: 2,
            y: 0,
            width: 8,
            height: 4,
            angle: 0,
        });
    });

    it("on a turned box follows the box's own axes and keeps its angle", () => {
        const turned: FreeTransform = { x: 0, y: 0, width: 4, height: 4, angle: 90 };
        // Turned a quarter, the box's east side faces down: dragging "e" down widens it.
        const scaled = scaleBox(turned, "e", { x: 2, y: 6 }, false);
        expect(scaled.width).toBe(6);
        expect(scaled.height).toBe(4);
        expect(scaled.angle).toBe(90);
        // Its west side (at the top) stays at y = 0.
        expect(scaled.y + scaled.height / 2 - scaled.width / 2).toBeCloseTo(0);
    });
});

describe("a turn drag", () => {
    it("adds the angle the pointer swept about the centre, in whole degrees; Shift snaps to 15°", () => {
        const centre = { x: 4, y: 2 };
        const from = { x: centre.x + 5, y: centre.y };
        const to = (degrees: number) => ({
            x: centre.x + 5 * Math.cos((degrees * Math.PI) / 180),
            y: centre.y + 5 * Math.sin((degrees * Math.PI) / 180),
        });
        expect(rotateBoxTo(BOX, from, to(33.4), false)).toEqual({ ...BOX, angle: 33 });
        expect(rotateBoxTo(BOX, from, to(-100.6), false)).toEqual({ ...BOX, angle: -101 });
        expect(rotateBoxTo(BOX, from, to(36), true)).toEqual({ ...BOX, angle: 2 * ANGLE_SNAP });
        expect(rotateBoxTo(BOX, from, to(97), true)).toEqual({ ...BOX, angle: 90 });
        // From a turned box, the snap is to absolute multiples of 15°.
        expect(rotateBoxTo({ ...BOX, angle: 10 }, from, to(37), true)).toEqual({
            ...BOX,
            angle: 45,
        });
        // Past 180° it wraps.
        expect(rotateBoxTo({ ...BOX, angle: 170 }, from, to(20), false)).toEqual({
            ...BOX,
            angle: -170,
        });
    });
});
