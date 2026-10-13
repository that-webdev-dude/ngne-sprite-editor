import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { InvariantError, assertInvariants } from "../../src/core/model";
import type { SpriteDoc } from "../../src/core/model";
import { ProjectError } from "../../src/core/project";
import type { DocJson } from "../../src/core/project";
import { assertSkeleton, readDocJson } from "../../src/core/project/docFromJson";
import {
    SOURCE_ID,
    expectFailure,
    failure,
    fixtureDocJson,
    fixtureFile,
    jsonBytes,
    noiseImage,
    rebuilt,
} from "./se-040-support";

// What a file can be refused for without its pixels is refused before an image is decoded:
// the invariants of SPEC §5.1 are checked on the document as doc.json describes it. Two of
// them, about the range of a tag, are checked by `core/project` itself in place of the
// model, which looks every endpoint up by walking the frame list. The first part of this
// file holds that check to the model's; the second shows the order of the reader.

/** What the model's own check says of a document: the invariant it breaks and how, or "valid". */
function modelVerdict(doc: SpriteDoc): string {
    try {
        assertInvariants({
            doc,
            selection: null,
            activeLayerId: doc.layers[0]?.id ?? "",
            activeFrameId: doc.frames[0]?.id ?? "",
        });
    } catch (error) {
        if (!(error instanceof InvariantError)) throw error;
        return error.message;
    }
    return "valid";
}

/** What `assertSkeleton` says of the same document, read from its doc.json. */
function skeletonVerdict(json: DocJson): string {
    const skeleton = readDocJson(json);
    try {
        assertSkeleton(skeleton);
    } catch (error) {
        if (!(error instanceof ProjectError)) throw error;
        expect(error.code).toBe("invariant");
        expect(error.cause).toBeInstanceOf(InvariantError);
        expect(error.message).toBe(`The document is not valid. ${(error.cause as Error).message}.`);
        // No stand-in image is left behind, whatever the outcome.
        expect(skeleton.doc.images.size).toBe(0);
        return (error.cause as InvariantError).message;
    }
    expect(skeleton.doc.images.size).toBe(0);
    return "valid";
}

/** The document of a doc.json as the model is to judge it: with an image under every ID. */
function withImages(json: DocJson): SpriteDoc {
    const { doc, imageIds } = readDocJson(json);
    for (const imageId of imageIds) doc.images.set(imageId, noiseImage(1, doc.width, doc.height));
    return doc;
}

type Change = (json: DocJson) => void;

/** Changes that keep doc.json inside the schema and may break an invariant. */
const changes: Record<string, Change> = {
    "tag from a frame that does not exist": (json) => void (json.tags[0].fromFrameId = "frame-9"),
    "tag to a frame that does not exist": (json) => void (json.tags[1].toFrameId = "frame-0"),
    "tag endpoints that are layers": (json) => void (json.tags[1].fromFrameId = "layer-bg"),
    "tag from after to": (json) =>
        void Object.assign(json.tags[0], { fromFrameId: "frame-3", toFrameId: "frame-1" }),
    "second tag from after to": (json) =>
        void Object.assign(json.tags[1], { fromFrameId: "frame-5", toFrameId: "frame-4" }),
    "tag on one frame": (json) => void (json.tags[0].toFrameId = "frame-1"),
    "tag over all frames": (json) =>
        void Object.assign(json.tags[1], { fromFrameId: "frame-1", toFrameId: "frame-5" }),
    "no tags": (json) => void ((json.tags = []), (json.exportSettings.frames = "all")),
    "tags with one ID": (json) => void (json.tags[1].id = "tag-idle"),
    "tag with the ID of a frame": (json) => void (json.tags[1].id = "frame-2"),
    "export of a tag that does not exist": (json) =>
        void (json.exportSettings.frames = { tagId: "tag-gone" }),
    "five reference layers": (json) =>
        void json.layers.push(
            ...["r2", "r3", "r4", "r5"].map((id) => ({ ...json.layers[0], id, sourceId: id })),
        ),
    "frames reversed": (json) => void json.frames.reverse(),
    "a frame twice": (json) => void json.frames.push({ ...json.frames[0] }),
    "a layer twice": (json) => void json.layers.push({ ...json.layers[1] }),
    "no pixel layer": (json) => void ((json.layers = [json.layers[0]]), (json.cels = [])),
    "no frames": (json) => void ((json.frames = []), (json.cels = [])),
};

const TAG_RANGE = /^Invariant "(tag-endpoints-exist|tag-order)"/;

describe("assertSkeleton against the model's assertInvariants", () => {
    it.each(Object.entries(changes))("agrees on a document with %s", (_name, change) => {
        const json = fixtureDocJson();
        change(json);
        expect(skeletonVerdict(json)).toBe(modelVerdict(withImages(json)));
    });

    it("the changes cover a valid document and each invariant a file can break", () => {
        const verdicts = Object.values(changes).map((change) => {
            const json = fixtureDocJson();
            change(json);
            return modelVerdict(withImages(json));
        });
        const invariants = new Set(
            verdicts.map((verdict) => /^Invariant "([a-z-]+)"/.exec(verdict)?.[1]),
        );
        expect([...invariants].map(String).sort()).toEqual([
            "export-frames-tag-exists",
            "frame-required",
            "pixel-layer-required",
            "reference-layer-limit",
            "tag-endpoints-exist",
            "tag-order",
            "undefined",
            "unique-ids",
        ]);
        expect(verdicts.filter((verdict) => verdict === "valid").length).toBeGreaterThan(2);
    });

    it("agrees on any combination of those changes", () => {
        const names = Object.keys(changes);
        fc.assert(
            fc.property(fc.shuffledSubarray(names, { maxLength: 5 }), (chosen) => {
                const json = fixtureDocJson();
                try {
                    for (const name of chosen) changes[name](json);
                    readDocJson(json);
                } catch {
                    // The changes do not combine into a doc.json of the schema: nothing to compare.
                    return;
                }
                const model = modelVerdict(withImages(json));
                const skeleton = skeletonVerdict(json);
                // One difference in order: the model looks at the tag ranges before it looks
                // at the tag the export settings name; here the ranges come last. A document
                // that breaks both is refused either way.
                if (
                    TAG_RANGE.test(model) &&
                    /^Invariant "export-frames-tag-exists"/.test(skeleton)
                ) {
                    return;
                }
                expect(skeleton).toBe(model);
            }),
            { numRuns: 500 },
        );
    });

    it("words the two tag invariants as the model does", () => {
        const missing = fixtureDocJson();
        missing.tags[1].toFrameId = "frame-9";
        expect(skeletonVerdict(missing)).toBe(
            'Invariant "tag-endpoints-exist" violated (tag endpoints reference existing frames): ' +
                'tag "tag-blink" names frame "frame-9"',
        );
        const reversed = fixtureDocJson();
        Object.assign(reversed.tags[0], { fromFrameId: "frame-3", toFrameId: "frame-1" });
        expect(skeletonVerdict(reversed)).toBe(
            'Invariant "tag-order" violated (a tag\'s `from` frame is not after its `to` frame): ' +
                'tag "tag-idle" runs from frame index 2 to 0',
        );
    });
});

describe("deserialize refuses what needs no pixels before it decodes an image", () => {
    /** The fixture's file with another doc.json and every image entry left out. */
    function withoutImages(json: unknown): Buffer {
        return rebuilt(fixtureFile(), {
            "doc.json": jsonBytes(json),
            "images/image-bg.png": null,
            "images/image-body-a.png": null,
            "images/image-body-b.png": null,
            "images/image-body-c.png": null,
            "images/image-fx.png": null,
            [`refs/${SOURCE_ID}.png`]: null,
        });
    }

    it("reads the images when nothing is wrong: without them the file is refused for them", async () => {
        await expectFailure(
            withoutImages(fixtureDocJson()),
            "missing-image",
            /"images\/image-bg.png"/,
        );
    });

    it.each(
        Object.entries(changes).filter(([, change]) => {
            const json = fixtureDocJson();
            change(json);
            return modelVerdict(withImages(json)) !== "valid";
        }),
    )("refuses a document with %s although no image can be read", async (_name, change) => {
        const json = fixtureDocJson();
        change(json);
        const error = await failure(withoutImages(json));

        expect(error.code).toBe("invariant");
        expect((error.cause as InvariantError).message).toBe(modelVerdict(withImages(json)));
    });

    it("refuses too much pixel data and a schema violation before the images too", async () => {
        const large = { ...fixtureDocJson(), width: 1024, height: 1024 };
        large.frames = Array.from({ length: 300 }, (_, index) => ({
            id: `f${index}`,
            durationMs: 1,
        }));
        large.cels = large.frames.map((frame, index) => ({
            layerId: "layer-bg",
            frameId: frame.id,
            imageId: `i${index}`,
            opacity: 255,
        }));
        large.tags = [];
        large.exportSettings.frames = "all";
        await expectFailure(withoutImages(large), "too-large", /300 images of 1024×1024 pixels/);

        const invalid = { ...fixtureDocJson(), width: 0 };
        await expectFailure(withoutImages(invalid), "invalid-document", /`width`/);
    });
});
