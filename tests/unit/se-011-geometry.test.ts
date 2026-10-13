import { describe, expect, it } from "vitest";
import { checkerPixels, checkerSpec } from "../../src/engine/viewport/checker";
import { errorMessage, oncePerMessage } from "../../src/engine/viewport/diagnostics";
import {
    backingSize,
    documentRect,
    imageQuad,
    MAX_BACKING_SIDE,
    QUAD_LAYER,
} from "../../src/engine/viewport/geometry";
import { frameKey, parseFrameKey } from "../../src/engine/viewport/types";

// SE-011: the pure parts of the viewport — where the document rectangle falls in device
// pixels, the checkerboard image, frame keys, and the once-per-message error report.

/** SPEC §6.4: the zoom steps at which texels are square and aligned to device pixels. */
const ZOOM_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64];

describe("documentRect", () => {
    it("is [originX, originY, width × scale, height × scale]", () => {
        expect(documentRect({ scale: 8, originX: 40, originY: 24 }, 5, 3)).toEqual({
            x: 40,
            y: 24,
            width: 40,
            height: 24,
        });
        expect(documentRect({ scale: 1, originX: -7, originY: 0 }, 1024, 1)).toEqual({
            x: -7,
            y: 0,
            width: 1024,
            height: 1,
        });
    });

    it("gives every texel exactly scale × scale device pixels at each zoom step", () => {
        for (const scale of ZOOM_STEPS) {
            for (const [width, height] of [
                [1, 1],
                [5, 3],
                [33, 32],
                [255, 256],
            ] as const) {
                const rect = documentRect({ scale, originX: 3, originY: -11 }, width, height);
                expect(rect).toEqual({
                    x: 3,
                    y: -11,
                    width: width * scale,
                    height: height * scale,
                });
                for (const value of Object.values(rect)) expect(Number.isInteger(value)).toBe(true);
            }
        }
    });

    it("rounds to whole device pixels at the overview steps and never collapses", () => {
        expect(documentRect({ scale: 0.5, originX: 10, originY: 10 }, 5, 3)).toEqual({
            x: 10,
            y: 10,
            width: 3,
            height: 2,
        });
        expect(documentRect({ scale: 0.125, originX: 0, originY: 0 }, 3, 1024)).toEqual({
            x: 0,
            y: 0,
            width: 1,
            height: 128,
        });
        // A fractional origin cannot put texel edges between device pixels.
        expect(documentRect({ scale: 2, originX: 10.4, originY: -3.5 }, 4, 4)).toMatchObject({
            x: 10,
            y: -3,
        });
    });
});

describe("imageQuad", () => {
    it("places the quad by its centre over the document rectangle", () => {
        expect(
            imageQuad(
                "ed:f:3",
                QUAD_LAYER.frame,
                { scale: 8, originX: 40, originY: 24 },
                {
                    width: 5,
                    height: 3,
                },
            ),
        ).toEqual({ texture: "ed:f:3", layer: 4, x: 60, y: 36, width: 40, height: 24 });
    });

    it("keeps the edges on device pixels for odd sizes: the centre is then a half pixel", () => {
        const quad = imageQuad(
            "ed:checker",
            QUAD_LAYER.checker,
            { scale: 3, originX: 7, originY: 5 },
            {
                width: 33,
                height: 1,
            },
        );
        expect(quad).toMatchObject({ x: 56.5, y: 6.5, width: 99, height: 3, layer: 1 });
        expect(quad.x - quad.width / 2).toBe(7);
        expect(quad.y - quad.height / 2).toBe(5);
    });

    it("uses the size of the image the slot holds, not of the document", () => {
        const view = { scale: 4, originX: 0, originY: 0 };
        expect(imageQuad("ed:f:0", QUAD_LAYER.frame, view, { width: 6, height: 4 })).toMatchObject({
            width: 24,
            height: 16,
        });
        expect(imageQuad("ed:f:0", QUAD_LAYER.frame, view, { width: 9, height: 7 })).toMatchObject({
            width: 36,
            height: 28,
        });
    });

    it("orders the layers as SPEC §6.4 lists them", () => {
        expect(QUAD_LAYER).toEqual({
            workspace: 0,
            checker: 1,
            referenceBehind: 2,
            onionBehind: 3,
            frame: 4,
            onionFront: 5,
            referenceFront: 6,
        });
    });
});

describe("backingSize", () => {
    it("is the observed size in whole device pixels", () => {
        expect(backingSize(1698, 906)).toEqual({ width: 1698, height: 906 });
        expect(backingSize(1132.4, 603.6)).toEqual({ width: 1132, height: 604 });
    });

    it("is 0 for an element that is not laid out and never exceeds the largest texture", () => {
        expect(backingSize(0, 0)).toEqual({ width: 0, height: 0 });
        expect(backingSize(-5, Number.NaN)).toEqual({ width: 0, height: 0 });
        expect(backingSize(20000, 9000)).toEqual({
            width: MAX_BACKING_SIDE,
            height: MAX_BACKING_SIDE,
        });
        expect(MAX_BACKING_SIDE).toBe(8192);
    });
});

describe("checkerPixels", () => {
    const pixel = (image: { width: number; data: Uint8ClampedArray }, x: number, y: number) => [
        ...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4),
    ];

    it("draws opaque squares of `size` document pixels, colour `a` first", () => {
        const image = checkerPixels(5, 3, { a: 0x3a3a3a, b: 0x4a4a4a, size: 2 });
        expect(image.width).toBe(5);
        expect(image.height).toBe(3);
        expect(image.data.length).toBe(5 * 3 * 4);
        const a = [0x3a, 0x3a, 0x3a, 255];
        const b = [0x4a, 0x4a, 0x4a, 255];
        const rows = [0, 1, 2].map((y) => [0, 1, 2, 3, 4].map((x) => pixel(image, x, y)));
        expect(rows).toEqual([
            [a, a, b, b, a],
            [a, a, b, b, a],
            [b, b, a, a, b],
        ]);
    });

    it("keeps the three channels of each colour apart", () => {
        const image = checkerPixels(2, 1, { a: 0x102030, b: 0xa0b0c0, size: 1 });
        expect(pixel(image, 0, 0)).toEqual([0x10, 0x20, 0x30, 255]);
        expect(pixel(image, 1, 0)).toEqual([0xa0, 0xb0, 0xc0, 255]);
    });

    it("is one colour while the squares are larger than the document", () => {
        const image = checkerPixels(5, 3, { a: 0xff0000, b: 0x00ff00, size: 8 });
        for (let at = 0; at < image.data.length; at += 4) {
            expect([...image.data.slice(at, at + 4)]).toEqual([255, 0, 0, 255]);
        }
    });

    it("refuses sizes that are not positive integers", () => {
        const checker = { a: 0, b: 0xffffff, size: 8 };
        expect(() => checkerPixels(0, 4, checker)).toThrow(RangeError);
        expect(() => checkerPixels(4, 1.5, checker)).toThrow(RangeError);
        expect(() => checkerPixels(4, 4, { ...checker, size: 0 })).toThrow(RangeError);
    });

    it("has a spec that changes with everything the image depends on", () => {
        const checker = { a: 0x3a3a3a, b: 0x4a4a4a, size: 8 };
        const spec = checkerSpec(16, 16, checker);
        expect(checkerSpec(16, 16, { ...checker })).toBe(spec);
        const others = [
            checkerSpec(17, 16, checker),
            checkerSpec(16, 17, checker),
            checkerSpec(16, 16, { ...checker, size: 4 }),
            checkerSpec(16, 16, { ...checker, a: 0x3a3a3b }),
            checkerSpec(16, 16, { ...checker, b: 0x4a4a4b }),
        ];
        expect(new Set([spec, ...others]).size).toBe(6);
    });
});

describe("frame keys", () => {
    it("are `frameId:variant`, plain unless a variant is named", () => {
        expect(frameKey("f1")).toBe("f1:plain");
        expect(frameKey("f1", "before")).toBe("f1:before");
        expect(parseFrameKey("f1:after")).toEqual({ frameId: "f1", variant: "after" });
    });

    it("survive a round trip for ids that contain the separator", () => {
        const id = "3f2c:77:aa";
        expect(parseFrameKey(frameKey(id))).toEqual({ frameId: id, variant: "plain" });
    });
});

describe("error reports", () => {
    it("reads the message of whatever NGNE reported", () => {
        expect(errorMessage(new Error("Texture is not ready: ed:f:0"))).toBe(
            "Texture is not ready: ed:f:0",
        );
        // A GPUError is not an Error: it only has a message.
        expect(errorMessage({ message: "Validation failed" })).toBe("Validation failed");
        expect(errorMessage("plain text")).toBe("plain text");
        expect(errorMessage({ message: "" })).toBe("[object Object]");
        expect(errorMessage(undefined)).toBe("undefined");
    });

    it("passes each distinct message on once", () => {
        const reported: string[] = [];
        const report = oncePerMessage((message) => reported.push(message));
        report(new Error("first"));
        report(new Error("first"));
        report({ message: "first" });
        report(new Error("second"));
        report("second");
        report(new Error("first"));
        expect(reported).toEqual(["first", "second"]);
    });

    it("hands the original error over with the message", () => {
        const seen: unknown[] = [];
        const error = new Error("boom");
        oncePerMessage((_message, original) => seen.push(original))(error);
        expect(seen).toEqual([error]);
    });

    it("does not let a failing report reach the caller", () => {
        const report = oncePerMessage(() => {
            throw new Error("the toast failed");
        });
        expect(() => report(new Error("boom"))).not.toThrow();
    });
});
