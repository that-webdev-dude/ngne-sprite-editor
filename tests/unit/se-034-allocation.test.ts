import { describe, expect, it, vi } from "vitest";
import { AllocationError } from "../../src/core/history";
import type { Command, PixelAllocator } from "../../src/core/history";
import type * as ImportModule from "../../src/core/import";
import type { DocSession } from "../../src/core/model";
import type * as PixelsModule from "../../src/core/pixels";
import { flipCanvasCommand, rotateCanvasCommand, spriteSizeCommand } from "../../src/core/sprite";
import type { SpriteOperationOptions } from "../../src/core/sprite";
import { fixture, historyOf, made, snapshot } from "./se-034-support";

// SE-034: every new image of a sprite operation comes from the command's allocator, or a
// failure to allocate is an `AllocationError` all the same, with the session unchanged.
//
// The pixel helpers that make buffers of their own (`rotatePixels`, `flipPixels`,
// `resizeNearest`) throw here as an exhausted allocation would: the operations must not use
// them. `resample` (area average) allocates its result itself; it fails on demand.

const failing = vi.hoisted(() => ({ resample: false }));

vi.mock("../../src/core/pixels", async (importOriginal) => {
    const original = await importOriginal<typeof PixelsModule>();
    const outOfMemory = () => {
        throw new RangeError("Array buffer allocation failed");
    };
    return {
        ...original,
        flipPixels: outOfMemory,
        rotatePixels: outOfMemory,
        resizeNearest: outOfMemory,
    };
});

vi.mock("../../src/core/import", async (importOriginal) => {
    const original = await importOriginal<typeof ImportModule>();
    return {
        ...original,
        resample: (...args: Parameters<typeof original.resample>) => {
            if (failing.resample) throw new RangeError("Array buffer allocation failed");
            return original.resample(...args);
        },
    };
});

type Make = (session: DocSession, options?: SpriteOperationOptions) => Command | null;

const OPERATIONS: [string, Make][] = [
    [
        "sprite size, nearest",
        (s, o) => spriteSizeCommand(s, { width: 48, height: 40, method: "nearest" }, o),
    ],
    [
        "sprite size, area",
        (s, o) => spriteSizeCommand(s, { width: 48, height: 40, method: "area" }, o),
    ],
    ["rotate 90°", (s, o) => rotateCanvasCommand(s, 90, o)],
    ["rotate 180°", (s, o) => rotateCanvasCommand(s, 180, o)],
    ["rotate 270°", (s, o) => rotateCanvasCommand(s, 270, o)],
    ["flip horizontal", (s, o) => flipCanvasCommand(s, "horizontal", o)],
    ["flip vertical", (s, o) => flipCanvasCommand(s, "vertical", o)],
];

describe("sprite operations allocate through the command's allocator", () => {
    it.each(OPERATIONS)("%s: one allocation per image, and no buffer of its own", (_, make) => {
        const session = fixture();
        const sizes: number[] = [];
        const allocate: PixelAllocator = (bytes) => {
            sizes.push(bytes);
            return new Uint8ClampedArray(bytes);
        };
        historyOf(session).execute(made(make(session, { allocate })));
        expect(sizes).toHaveLength(session.doc.images.size);
        for (const bytes of sizes) expect(bytes).toBe(session.doc.width * session.doc.height * 4);
    });

    it.each(OPERATIONS)(
        "%s: an allocator that fails gives AllocationError, session unchanged",
        (_, make) => {
            const session = fixture();
            const before = snapshot(session);
            const allocate: PixelAllocator = () => {
                throw new RangeError("Array buffer allocation failed");
            };
            const history = historyOf(session);
            expect(() => history.execute(made(make(session, { allocate })))).toThrow(
                AllocationError,
            );
            expect(snapshot(session)).toEqual(before);
            expect(history.undoCount).toBe(0);
        },
    );

    it("area average: memory running out inside the resampler is an AllocationError, session unchanged", () => {
        const session = fixture();
        const before = snapshot(session);
        const history = historyOf(session);
        const command = made(spriteSizeCommand(session, { width: 48, height: 40, method: "area" }));
        failing.resample = true;
        try {
            expect(() => history.execute(command)).toThrow(AllocationError);
        } finally {
            failing.resample = false;
        }
        expect(snapshot(session)).toEqual(before);
        expect(history.undoCount).toBe(0);
    });
});
