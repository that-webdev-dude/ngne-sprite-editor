import { describe, expect, it } from "vitest";
import { exportAnimations, fallbackTag } from "../../src/app/preview/previewController";
import { previewDisplay } from "../../src/app/preview/previewDisplay";
import { ALL_FRAMES, nextBackground, playedAnimation } from "../../src/app/preview/previewState";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { Tag } from "../../src/core/model";

// SE-054: the canvas size of the preview (SPEC §6.5: CSS size = k × size / DPR with a whole k),
// and what the panel's controls choose from (DESIGN §5.5).

describe("previewDisplay", () => {
    it("takes the largest whole number of device pixels per texel that fits", () => {
        expect(previewDisplay({ width: 32, height: 32 }, { width: 238, height: 130 }, 1)).toEqual({
            scale: 4,
            width: 128,
            height: 128,
        });
        expect(previewDisplay({ width: 33, height: 17 }, { width: 238, height: 130 }, 1)).toEqual({
            scale: 7,
            width: 231,
            height: 119,
        });
    });

    it("at a fractional ratio the CSS size times the ratio is a whole multiple of the size", () => {
        for (const ratio of [1.25, 1.5, 1.75]) {
            const stage = { width: Math.floor(238 * ratio), height: Math.floor(130 * ratio) };
            for (const doc of [
                { width: 32, height: 32 },
                { width: 33, height: 17 },
                { width: 1, height: 5 },
            ]) {
                const display = previewDisplay(doc, stage, ratio);
                expect(Number.isInteger(display.scale)).toBe(true);
                expect(display.width * ratio).toBeCloseTo(display.scale * doc.width, 9);
                expect(display.height * ratio).toBeCloseTo(display.scale * doc.height, 9);
                expect(display.scale * doc.width).toBeLessThanOrEqual(stage.width);
                expect(display.scale * doc.height).toBeLessThanOrEqual(stage.height);
                expect(
                    (display.scale + 1) * doc.width > stage.width ||
                        (display.scale + 1) * doc.height > stage.height,
                ).toBe(true);
            }
        }
    });

    it("shows a document larger than the stage at 1/n; 1:1 before the stage is laid out", () => {
        expect(previewDisplay({ width: 512, height: 64 }, { width: 238, height: 130 }, 1)).toEqual({
            scale: 1 / 3,
            width: 512 / 3,
            height: 64 / 3,
        });
        expect(previewDisplay({ width: 16, height: 16 }, { width: 0, height: 0 }, 2)).toEqual({
            scale: 1,
            width: 8,
            height: 8,
        });
    });
});

describe("the panel's choices", () => {
    const tags = (doc: ReturnType<typeof createDocument>["doc"], names: string[]): Tag[] =>
        names.map((name, index) => ({
            id: `t${index}`,
            name,
            color: 0xff0000ff,
            fromFrameId: doc.frames[0]!.id,
            toFrameId: doc.frames[0]!.id,
            direction: "forward",
            repeat: 0,
        }));

    it("lists the export's animations: one per tag, or the document's loop without tags", () => {
        const { doc } = createDocument(
            { name: "Hero Walk", width: 4, height: 4 },
            sequentialIds("h-"),
        );
        expect(exportAnimations(doc)).toEqual([]);
        doc.frames.push({ id: "second", durationMs: 100 });
        expect(exportAnimations(doc)).toEqual(["hero-walk"]);
        doc.tags = tags(doc, ["Walk", "Walk", "★"]);
        expect(exportAnimations(doc)).toEqual(["walk", "walk-2", "tag"]);
        expect(fallbackTag(doc, "walk-2")).toBe("t1");
        expect(fallbackTag(doc, ALL_FRAMES)).toBeNull();
        expect(fallbackTag(doc, "missing")).toBeNull();
    });

    it("plays the chosen animation while it exists, else the first, else all frames", () => {
        expect(playedAnimation({ chosen: null, animations: ["a", "b"] })).toBe("a");
        expect(playedAnimation({ chosen: "b", animations: ["a", "b"] })).toBe("b");
        expect(playedAnimation({ chosen: "gone", animations: ["a"] })).toBe("a");
        expect(playedAnimation({ chosen: ALL_FRAMES, animations: ["a"] })).toBe(ALL_FRAMES);
        expect(playedAnimation({ chosen: null, animations: [] })).toBe(ALL_FRAMES);
    });

    it("the background chip cycles dark, light, mid grey", () => {
        expect(nextBackground("dark")).toBe("light");
        expect(nextBackground("light")).toBe("mid");
        expect(nextBackground("mid")).toBe("dark");
    });
});
