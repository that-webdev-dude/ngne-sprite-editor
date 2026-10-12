import { describe, expect, it } from "vitest";
import { KeyIndex } from "../../src/core/import/keyIndex";

describe("KeyIndex", () => {
    it("numbers keys in the order they are added and finds them again", () => {
        const index = new KeyIndex();
        expect(index.add(0xffffff)).toBe(0);
        expect(index.add(0)).toBe(1);
        expect(index.add(0xffffffff)).toBe(2);
        expect(index.add(0)).toBe(1);
        expect(index.add(0xffffff)).toBe(0);
        expect(index.size).toBe(3);
        expect(Array.from(index.keys.subarray(0, index.size))).toEqual([0xffffff, 0, 0xffffffff]);
    });

    it("keeps the numbers while it grows", () => {
        const index = new KeyIndex();
        // Multiples of 2^20 and of 3 collide in the low or the high bits.
        const keys = Array.from({ length: 5000 }, (_, i) => (i % 2 ? i * 0x100000 : i * 3) >>> 0);
        const distinct = [...new Set(keys)];
        for (const key of keys) {
            index.add(key);
        }
        expect(index.size).toBe(distinct.length);
        expect(distinct.map((key) => index.add(key))).toEqual(distinct.map((_, i) => i));
        expect(Array.from(index.keys.subarray(0, index.size))).toEqual(distinct);
    });

    it("starts again from 0 after clear", () => {
        const index = new KeyIndex();
        for (let key = 0; key < 100; key++) {
            index.add(key);
        }
        index.clear();
        expect(index.size).toBe(0);
        expect(index.add(99)).toBe(0);
        expect(index.add(7)).toBe(1);
        expect(index.add(99)).toBe(0);
    });
});
