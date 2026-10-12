import { describe, expect, it } from "vitest";
import { nearestColor } from "../../src/core/import/nearestColor";

describe("nearestColor", () => {
    it("finds the nearest colour", () => {
        const lab = Float64Array.from([0.9, 0, 0, 0.1, 0, 0, 0.5, 0.2, 0, 0.5, -0.2, 0]);
        expect(nearestColor(lab, 1, 0, 0)).toBe(0);
        expect(nearestColor(lab, 0, 0, 0)).toBe(1);
        expect(nearestColor(lab, 0.5, 0.15, 0)).toBe(2);
        expect(nearestColor(lab, 0.5, -0.01, 0)).toBe(3);
        expect(nearestColor(lab, 0.1, 0, 0)).toBe(1);
    });

    it("measures on all three axes", () => {
        // The two colours nearest in lightness are far away on the other axes.
        const lab = Float64Array.from([0.5, 0.4, 0.4, 0.51, -0.4, 0.4, 0.8, 0, 0, 0.2, 0, 0.01]);
        expect(nearestColor(lab, 0.5, 0, 0)).toBe(2);
        expect(nearestColor(lab, 0.45, 0, 0)).toBe(3);
    });

    it("returns the lowest index among equally near colours", () => {
        // Colours 0 and 2 are the same; 1 and 3 mirror each other around the grey axis.
        const lab = Float64Array.from([0.5, 0.1, 0, 0.3, -0.1, 0, 0.5, 0.1, 0, 0.3, 0.1, 0]);
        expect(nearestColor(lab, 0.5, 0.1, 0)).toBe(0);
        expect(nearestColor(lab, 0.6, 0.3, 0.2)).toBe(0);
        expect(nearestColor(lab, 0.3, 0, 0)).toBe(1);
        // 0.25 below and 0.25 above, in either order.
        expect(nearestColor(Float64Array.from([0.75, 0, 0, 0.25, 0, 0]), 0.5, 0, 0)).toBe(0);
        expect(nearestColor(Float64Array.from([0.25, 0, 0, 0.75, 0, 0]), 0.5, 0, 0)).toBe(0);
    });

    it("works with a single colour", () => {
        const lab = Float64Array.from([0.4, 0.1, -0.1]);
        expect(nearestColor(lab, 0, 0, 0)).toBe(0);
        expect(nearestColor(lab, 1, 1, 1)).toBe(0);
    });
});
