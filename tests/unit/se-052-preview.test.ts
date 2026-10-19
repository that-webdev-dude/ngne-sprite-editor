import { describe, expect, it } from "vitest";
import { ATLAS_WARNING_SHARE, exportPreview, previewOf } from "../../src/app/export/exportPreview";
import { createSessionsStore } from "../../src/app/state/sessions";
import { MAX_ATLAS_ENTRIES, MAX_ATLAS_SIDE, bundle } from "../../src/core/export";
import { createDocument } from "../../src/core/model";
import type { SpriteDoc, Tag } from "../../src/core/model";
import { FIXTURES } from "../e2e/se-053-documents";

// SE-052: what the Export dialog shows before an export is made (DESIGN §7): the files and
// their sizes, the final IDs, the warnings, or the message of the error that refuses it.

function tag(doc: SpriteDoc, name: string, from: number, to: number, repeat = 0): Tag {
    return {
        id: `t-${doc.tags.length}`,
        name,
        color: 0xff0000ff,
        fromFrameId: doc.frames[from].id,
        toFrameId: doc.frames[to].id,
        direction: "forward",
        repeat,
    };
}

describe("the preview of an export", () => {
    it("is the bundle: the files with their sizes, the frame and animation IDs", () => {
        const doc = FIXTURES.a.build();
        doc.exportSettings.files.asepriteJson = "hash";
        const preview = exportPreview(doc);
        const made = bundle(doc);
        expect(preview.error).toBeNull();
        expect(preview.name).toBe("walker");
        expect(preview.files).toEqual(
            made.files.map((file) => ({ name: file.name, size: file.bytes.length })),
        );
        expect(preview.files.map((file) => file.name)).toEqual([
            "walker.png",
            "walker.atlas.json",
            "walker.sprites.ts",
            "walker.preview.config.mjs",
            "walker.aseprite.json",
        ]);
        expect(preview.frameIds).toEqual(["walker-0", "walker-1", "walker-2", "walker-3"]);
        expect(preview.animationIds).toEqual(["walk", "blink", "turn"]);
        expect(preview.warnings).toEqual([]);
        expect(preview.bundle?.meta).toEqual(made.meta);
    });

    it("of one tag lists that tag's frames, under their document indices, and its animation", () => {
        const doc = FIXTURES.a.build();
        doc.exportSettings.frames = { tagId: doc.tags[1].id };
        const preview = exportPreview(doc);
        expect(preview.frameIds).toEqual(["walker-2", "walker-3"]);
        expect(preview.animationIds).toEqual(["blink"]);
    });

    it("warns of renamed IDs: a later tag of the same slug, a name without a slug", () => {
        const doc = createDocument({ name: "Hero", width: 4, height: 4 }).doc;
        doc.frames.push({ id: "f2", durationMs: 100 }, { id: "f3", durationMs: 100 });
        doc.tags.push(tag(doc, "Walk", 0, 1));
        doc.tags.push(tag(doc, "walk!", 1, 2));
        doc.tags.push(tag(doc, "★★", 2, 2));
        doc.tags.push(tag(doc, "Run", 0, 2));
        const preview = exportPreview(doc);
        expect(preview.animationIds).toEqual(["walk", "walk-2", "tag", "run"]);
        expect(preview.warnings).toEqual([
            "Tag “walk!” is exported as “walk-2”: an earlier tag has the ID “walk”.",
            "Tag “★★” is exported as “tag”: its name has no letter or digit an ID can keep.",
        ]);
        // Exported alone, the renamed tag keeps its ID and its warning; the others go.
        doc.exportSettings.frames = { tagId: doc.tags[1].id };
        expect(exportPreview(doc).warnings).toEqual([
            "Tag “walk!” is exported as “walk-2”: an earlier tag has the ID “walk”.",
        ]);
        doc.exportSettings.frames = { tagId: doc.tags[3].id };
        expect(exportPreview(doc).warnings).toEqual([]);
    });

    it("warns when the atlas is within 10% of the side limit, and only then", () => {
        expect(ATLAS_WARNING_SHARE * MAX_ATLAS_SIDE).toBeCloseTo(7372.8);
        // A row of frames 1 px high: padding 1, so the row is n × (w + 1) + 1 wide.
        const row = (width: number, frames: number) => {
            const doc = createDocument({ name: "Strip", width, height: 1 }).doc;
            for (let index = 1; index < frames; index++) {
                doc.frames.push({ id: `f${index}`, durationMs: 100 });
            }
            doc.exportSettings.layout = "row";
            // The frames are equal (transparent): unmerged, each has its rectangle.
            doc.exportSettings.mergeDuplicates = false;
            return exportPreview(doc);
        };
        // 8 × (922 + 1) + 1 = 7385: past 7372.8.
        const near = row(922, 8);
        expect(near.bundle?.meta.width).toBe(7385);
        expect(near.warnings).toEqual([
            "The atlas is 7385 × 4 px, within 10% of the limit of 8192 px a side.",
        ]);
        // 8 × (920 + 1) + 1 = 7369: not.
        const below = row(920, 8);
        expect(below.bundle?.meta.width).toBe(7369);
        expect(below.warnings).toEqual([]);
    });

    it("shows the message of the error that refuses the export, and no file", () => {
        const doc = createDocument({ name: "Loop", width: 2, height: 2 }).doc;
        // 258 tags of one frame, each written out 255 times: 65 790 entries.
        for (let index = 0; index < 258; index++) doc.tags.push(tag(doc, `t${index}`, 0, 0, 255));
        const preview = exportPreview(doc);
        expect(258 * 255).toBeGreaterThan(MAX_ATLAS_ENTRIES);
        expect(preview.bundle).toBeNull();
        expect(preview.files).toEqual([]);
        expect(preview.error).toBe(
            "The animations of the export have 65790 entries when every repeat is written " +
                "out; an atlas holds at most 65536. Lower a repeat count, shorten a tag, or " +
                "export one tag at a time.",
        );
        // An atlas too large to pack: PackError's message.
        const wide = createDocument({ name: "Wide", width: 1024, height: 1 }).doc;
        for (let index = 1; index < 8; index++)
            wide.frames.push({ id: `f${index}`, durationMs: 1 });
        wide.exportSettings.layout = "row";
        wide.exportSettings.padding = 2;
        wide.exportSettings.mergeDuplicates = false;
        expect(exportPreview(wide).error).toMatch(/8192/);
    });

    it("is made once per record of an open document, and again when the record changes", () => {
        const sessions = createSessionsStore();
        const opened = sessions.getState().open(createDocument({ name: "A", width: 2, height: 2 }));
        const first = previewOf(opened);
        expect(previewOf(opened)).toBe(first);
        sessions.getState().updateExportSettings(opened.id, (settings) => {
            settings.files.spritesTs = false;
        });
        const changed = sessions.getState().documents[0];
        expect(changed).not.toBe(opened);
        expect(previewOf(changed).files.map((file) => file.name)).toEqual([
            "a.png",
            "a.atlas.json",
            "a.preview.config.mjs",
        ]);
    });
});
