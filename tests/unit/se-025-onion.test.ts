import { describe, expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import { celKey, createDocument, sequentialIds } from "../../src/core/model";
import type { OnionSettings, PixelBuffer, SpriteDoc, Tag } from "../../src/core/model";
import { contentBounds, onionAlpha, onionGhosts, tintOnion } from "../../src/core/onion";

// SE-025 in `core`: which frames are onion skins around a frame (SPEC §7.5), their opacity, the
// CPU tint of their pixels, and that none of it reaches a composite (SPEC §5.3).

/** A document of the frames `a`, `b`, … with `tags`, onion skin on with `onion`. */
function sprite(count: number, onion: Partial<OnionSettings> = {}, tags: Partial<Tag>[] = []) {
    const { doc } = createDocument({ name: "onion", width: 2, height: 1 }, sequentialIds());
    doc.frames = Array.from({ length: count }, (_, index) => ({
        id: String.fromCharCode(97 + index),
        durationMs: 100,
    }));
    doc.tags = tags.map((tag, index) => ({
        id: `tag-${index}`,
        name: `tag ${index}`,
        color: 0xff0000ff,
        fromFrameId: "a",
        toFrameId: "a",
        direction: "forward",
        repeat: 0,
        ...tag,
    }));
    doc.settings.onion = {
        ...doc.settings.onion,
        enabled: true,
        before: 3,
        after: 3,
        opacity: 255,
        falloff: 1,
        ...onion,
    };
    return doc;
}

/** The ghosts of `frameId` as "frame:side", in draw order. */
function ghosts(doc: SpriteDoc, frameId: string): string[] {
    return onionGhosts(doc, frameId).map((ghost) => `${ghost.frameId}:${ghost.side}`);
}

describe("onionGhosts: the frames around the active one", () => {
    it("lists up to three frames on each side, the farthest first, nearer ones over them", () => {
        const doc = sprite(9);
        expect(ghosts(doc, "e")).toEqual([
            "b:before",
            "c:before",
            "d:before",
            "h:after",
            "g:after",
            "f:after",
        ]);
        doc.settings.onion.before = 1;
        doc.settings.onion.after = 0;
        expect(ghosts(doc, "e")).toEqual(["d:before"]);
    });

    it("never goes outside the document, and does not wrap", () => {
        const doc = sprite(4);
        expect(ghosts(doc, "a")).toEqual(["d:after", "c:after", "b:after"]);
        expect(ghosts(doc, "d")).toEqual(["a:before", "b:before", "c:before"]);
        expect(ghosts(sprite(1), "a")).toEqual([]);
        // A frame the document does not have has no ghosts.
        expect(ghosts(doc, "z")).toEqual([]);
    });

    it("with 'within tag' stays inside the active tag's range; without a tag, the document", () => {
        const tags = [
            { fromFrameId: "c", toFrameId: "f" },
            // The active tag at d and e is the shorter one (SPEC §7.4).
            { fromFrameId: "d", toFrameId: "e" },
        ];
        const doc = sprite(8, { withinTag: true }, tags);
        expect(ghosts(doc, "d")).toEqual(["e:after"]);
        expect(ghosts(doc, "c")).toEqual(["f:after", "e:after", "d:after"]);
        expect(ghosts(doc, "f")).toEqual(["c:before", "d:before", "e:before"]);
        // No tag contains h: the whole document.
        expect(ghosts(doc, "h")).toEqual(["e:before", "f:before", "g:before"]);
        // Off: the tags do not matter.
        doc.settings.onion.withinTag = false;
        expect(ghosts(doc, "d")).toEqual([
            "a:before",
            "b:before",
            "c:before",
            "g:after",
            "f:after",
            "e:after",
        ]);
    });

    it("is empty while onion skin is off", () => {
        expect(ghosts(sprite(5, { enabled: false }), "c")).toEqual([]);
    });

    it("gives each ghost the base opacity times the falloff for each step after the first", () => {
        const doc = sprite(7, { opacity: 200, falloff: 0.5 });
        const alphas = Object.fromEntries(
            onionGhosts(doc, "d").map((ghost) => [`${ghost.frameId}${ghost.step}`, ghost.alpha]),
        );
        expect(alphas).toEqual({
            c1: 200 / 255,
            b2: 100 / 255,
            a3: 50 / 255,
            e1: 200 / 255,
            f2: 100 / 255,
            g3: 50 / 255,
        });
        expect(onionAlpha({ opacity: 128, falloff: 0.25 }, 1)).toBe(128 / 255);
        expect(onionAlpha({ opacity: 128, falloff: 0.25 }, 3)).toBe(128 / 255 / 16);
    });

    it("leaves out a ghost whose opacity is 0", () => {
        expect(ghosts(sprite(5, { opacity: 0 }), "c")).toEqual([]);
        // Falloff 0: only the neighbours show.
        expect(ghosts(sprite(5, { falloff: 0 }), "c")).toEqual(["b:before", "d:after"]);
    });
});

/** One row of RGBA pixels. */
function row(...pixels: (readonly [number, number, number, number])[]): PixelBuffer {
    return { width: pixels.length, height: 1, data: Uint8ClampedArray.from(pixels.flat()) };
}

describe("tintOnion: 50% toward red or blue, alpha kept", () => {
    it("makes black reddish before and bluish after, which a multiply could not", () => {
        const black = row([0, 0, 0, 255]);
        const red = tintOnion(black, "before").data;
        expect([...red]).toEqual([128, 0, 0, 255]);
        expect(red[0]!).toBeGreaterThan(red[1]!);
        expect(red[0]!).toBeGreaterThan(red[2]!);
        expect([...tintOnion(black, "after").data]).toEqual([0, 0, 128, 255]);
    });

    it("moves every channel halfway toward the tint, rounding half up, and keeps alpha", () => {
        const source = row([255, 255, 255, 255], [10, 101, 200, 77], [1, 2, 3, 1]);
        expect([...tintOnion(source, "before").data]).toEqual([
            255, 128, 128, 255, 133, 51, 100, 77, 128, 1, 2, 1,
        ]);
        expect([...tintOnion(source, "after").data]).toEqual([
            128, 128, 255, 255, 5, 51, 228, 77, 1, 1, 129, 1,
        ]);
    });

    it("keeps a transparent pixel 0,0,0,0 and leaves the source as it was", () => {
        const source = row([0, 0, 0, 0], [9, 9, 9, 0]);
        const before = [...source.data];
        const tinted = tintOnion(source, "before");
        expect([...tinted.data]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect([...source.data]).toEqual(before);
        expect(tinted.data).not.toBe(source.data);
        expect(tinted).toMatchObject({ width: 2, height: 1 });
    });

    it("writes into a buffer of the same size it is given, every pixel, and never into the source", () => {
        const into = row([1, 2, 3, 4], [5, 6, 7, 8]);
        const result = tintOnion(row([0, 0, 0, 255], [9, 9, 9, 0]), "after", into);
        expect(result).toBe(into);
        expect([...into.data]).toEqual([0, 0, 128, 255, 0, 0, 0, 0]);
        // Another size, or the source itself: a new buffer.
        const source = row([0, 0, 0, 255]);
        expect(tintOnion(source, "before", into)).not.toBe(into);
        const own = tintOnion(source, "before", source);
        expect(own).not.toBe(source);
        expect([...source.data]).toEqual([0, 0, 0, 255]);
    });
});

describe("contentBounds: where a ghost shows anything", () => {
    function image(width: number, height: number, set: readonly [number, number, number][]) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (const [x, y, alpha] of set) data[(y * width + x) * 4 + 3] = alpha;
        return { width, height, data };
    }

    it("bounds the pixels whose alpha is not 0, colour under alpha 0 aside", () => {
        expect(contentBounds(image(6, 5, [[2, 1, 1]]))).toEqual({
            x: 2,
            y: 1,
            width: 1,
            height: 1,
        });
        expect(
            contentBounds(
                image(6, 5, [
                    [4, 1, 255],
                    [1, 3, 7],
                    [5, 4, 128],
                ]),
            ),
        ).toEqual({ x: 1, y: 1, width: 5, height: 4 });
        const colourOnly = image(3, 3, []);
        colourOnly.data.fill(200);
        for (let at = 3; at < colourOnly.data.length; at += 4) colourOnly.data[at] = 0;
        expect(contentBounds(colourOnly)).toBeNull();
        expect(contentBounds(image(4, 4, []))).toBeNull();
        expect(contentBounds(image(1, 1, [[0, 0, 1]]))).toEqual({
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        });
    });
});

describe("compositeFrame with onion skin on", () => {
    it("composites a frame's own cels only: no onion skin is part of the composite", () => {
        const doc = sprite(3, { tint: true, opacity: 255, falloff: 1 });
        const layerId = doc.layers[0]!.id;
        // a and c opaque red and blue, b transparent: a ghost would show in b's composite.
        for (const [frameId, colour] of [
            ["a", [255, 0, 0, 255]],
            ["c", [0, 0, 255, 255]],
        ] as const) {
            const imageId = `image-${frameId}`;
            doc.images.set(imageId, row(colour, colour));
            doc.cels.set(celKey(layerId, frameId), { imageId, opacity: 255 });
        }
        expect(onionGhosts(doc, "b").length).toBe(2);
        expect([...compositeFrame(doc, "b").data]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect([...compositeFrame(doc, "a").data]).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
        doc.settings.onion.enabled = false;
        expect([...compositeFrame(doc, "b").data]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    });
});
