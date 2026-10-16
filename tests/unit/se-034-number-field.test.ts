import { describe, expect, it } from "vitest";
import {
    formatNumber,
    normalizeNumber,
    parseNumber,
    stepNumber,
} from "../../src/ui/primitives/numberMath";

// SE-034 (REVIEW.md B12): the pivot fields keep four decimals on entry, and arrow keys still
// step by 0.01. The number field takes a `precision` beside its `step`.

const PIVOT = { min: 0, max: 1, step: 0.01, precision: 4 };

describe("a number field with more decimals than its step", () => {
    it("keeps four decimals of a typed value: 0.9688 stays 0.9688", () => {
        expect(parseNumber("0.9688", PIVOT)).toBe(0.9688);
        expect(parseNumber("0,96875", PIVOT)).toBe(0.9688);
        expect(parseNumber("0.123449", PIVOT)).toBe(0.1234);
        expect(normalizeNumber(2, PIVOT)).toBe(1);
    });

    it("steps by 0.01 with the arrow keys and by 0.1 with Shift, from a value of four decimals", () => {
        expect(stepNumber(0.9688, -1, PIVOT)).toBe(0.9588);
        expect(stepNumber(0.5, 1, PIVOT)).toBe(0.51);
        expect(stepNumber(0.9688, 1, PIVOT, true)).toBe(1);
    });

    it("shows the step's decimals at least and as many more as the value has", () => {
        expect(formatNumber(0.5, PIVOT)).toBe("0.50");
        expect(formatNumber(1, PIVOT)).toBe("1.00");
        expect(formatNumber(0.25, PIVOT)).toBe("0.25");
        expect(formatNumber(0.9688, PIVOT)).toBe("0.9688");
        expect(formatNumber(0.125, PIVOT)).toBe("0.125");
        expect(formatNumber(3.5, { step: 1, precision: 2 })).toBe("3.5");
        expect(formatNumber(3, { step: 1, precision: 2 })).toBe("3");
    });

    it("without a precision, nothing changes: the step's decimals", () => {
        const hundredths = { min: 0, max: 1, step: 0.01 };
        expect(parseNumber("0.9688", hundredths)).toBe(0.97);
        expect(formatNumber(0.5, hundredths)).toBe("0.50");
        expect(formatNumber(12, {})).toBe("12");
    });
});
