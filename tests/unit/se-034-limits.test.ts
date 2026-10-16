import { describe, expect, it } from "vitest";
import { copyCelsCommand, unlinkCelsCommand } from "../../src/core/cels";
import { addFrameCommand, duplicateFramesCommand } from "../../src/core/frames";
import { History } from "../../src/core/history";
import type { Command } from "../../src/core/history";
import {
    addLayerCommand,
    duplicateLayerCommand,
    flattenCommand,
    mergeDownCommand,
    renameLayerCommand,
    isLayerName,
} from "../../src/core/layers";
import {
    DOCUMENT_LIMITS,
    DocumentLimitError,
    MAX_DOCUMENT_PIXEL_BYTES,
    MAX_NAME_LENGTH,
    PIXEL_MEMORY_WARNING_BYTES,
    assertInvariants,
    celKey,
    createDocument,
    documentCounts,
    sequentialIds,
    truncateName,
} from "../../src/core/model";
import type { DocSession, DocumentLimitName, DocumentLimits } from "../../src/core/model";
import { setPaletteCommand } from "../../src/core/palettes";
import {
    MAX_NAME_LENGTH as PROJECT_NAME_LENGTH,
    MAX_PROJECT_CELS,
    MAX_PROJECT_FRAMES,
    MAX_PROJECT_IMAGES,
    MAX_PROJECT_LAYERS,
    MAX_PROJECT_PIXEL_BYTES,
    MAX_PROJECT_TAGS,
    deserialize,
    serialize,
} from "../../src/core/project";
import {
    canvasSizeCommand,
    isSpriteName,
    normalizeSpriteName,
    renameSpriteCommand,
    spriteSizeCommand,
} from "../../src/core/sprite";
import { createTagCommand, editTagCommand } from "../../src/core/tags";
import type { TagProperties } from "../../src/core/tags";
import { FRAMES, L1, L2, fixture, made, snapshot } from "./se-034-support";

// SE-034: the limits of a document (SPEC §5.1, FORMAT.md §1.8) are exported by `core/model`
// with one typed error, every command that adds a layer, frame, tag, cel or image refuses to
// pass them, and names are limited to the 255 code units of the project format.

/** What `run` throws, or null. */
function thrown(run: () => unknown): unknown {
    try {
        run();
    } catch (error) {
        return error;
    }
    return null;
}

/** The limits with `name` lowered to what `session` has now: one more is refused. */
function full(session: DocSession, name: DocumentLimitName): DocumentLimits {
    return { ...DOCUMENT_LIMITS, [name]: documentCounts(session.doc)[name] };
}

function tagOf(name = "Tag"): TagProperties {
    return {
        name,
        color: 0x00ff00ff,
        fromFrameId: FRAMES[0],
        toFrameId: FRAMES[1],
        direction: "forward",
        repeat: 0,
    };
}

/**
 * Every adding command of the scope, with the limits it is given, on the fixture: L1 has
 * images A (frames 1, 2: linked) and B (frame 3), L2 has C at frame 2.
 */
const ADDING: [
    string,
    DocumentLimitName[],
    (session: DocSession, limits: DocumentLimits) => void,
][] = [
    [
        "SE-004 cel creation (a stroke on an empty cel)",
        ["cels", "images", "pixelBytes"],
        (session, limits) => {
            new History(session, { limits }).begin({ layerId: L2, frameId: FRAMES[0] });
        },
    ],
    ["SE-020 add layer", ["layers"], (session, limits) => addLayerCommand(session, { limits })],
    [
        "SE-020 duplicate layer",
        ["layers", "cels", "images", "pixelBytes"],
        (session, limits) => duplicateLayerCommand(session, L1, { limits }),
    ],
    [
        "SE-021 add frame",
        ["frames"],
        (session, limits) => addFrameCommand(session.doc, FRAMES[0], undefined, limits),
    ],
    [
        "SE-021 duplicate frames",
        ["frames", "cels", "images", "pixelBytes"],
        (session, limits) =>
            duplicateFramesCommand(session.doc, [FRAMES[1]], undefined, undefined, limits),
    ],
    [
        "SE-021 copy cels",
        ["cels", "images", "pixelBytes"],
        (session, limits) =>
            copyCelsCommand(
                session.doc,
                { layerIds: [L1], frameIds: [FRAMES[0]] },
                { layers: 1, frames: 0 },
                undefined,
                undefined,
                limits,
            ),
    ],
    [
        "SE-021 unlink cels",
        ["images", "pixelBytes"],
        (session, limits) =>
            unlinkCelsCommand(
                session.doc,
                { layerIds: [L1], frameIds: [FRAMES[1]] },
                undefined,
                undefined,
                limits,
            ),
    ],
    [
        "SE-021 create tag",
        ["tags"],
        (session, limits) => createTagCommand(session.doc, tagOf(), undefined, limits),
    ],
    [
        "SE-034 canvas size",
        ["pixelBytes"],
        (session, limits) =>
            canvasSizeCommand(
                session,
                { width: 40, height: 32, anchor: { x: 0, y: 0 } },
                { limits },
            ),
    ],
    [
        "SE-034 sprite size",
        ["pixelBytes"],
        (session, limits) =>
            spriteSizeCommand(session, { width: 64, height: 64, method: "area" }, { limits }),
    ],
];

describe("the limits of core/model", () => {
    it("are the counts and the pixel memory of the project format, and core/project takes them from there", () => {
        expect(DOCUMENT_LIMITS).toEqual({
            pixelBytes: 1024 * 1024 * 1024,
            layers: 1024,
            frames: 65_535,
            tags: 1024,
            cels: 131_072,
            images: 65_527,
        });
        expect(MAX_DOCUMENT_PIXEL_BYTES).toBe(DOCUMENT_LIMITS.pixelBytes);
        expect(PIXEL_MEMORY_WARNING_BYTES).toBe(512 * 1024 * 1024);
        expect(MAX_NAME_LENGTH).toBe(255);
        expect({
            layers: MAX_PROJECT_LAYERS,
            frames: MAX_PROJECT_FRAMES,
            tags: MAX_PROJECT_TAGS,
            cels: MAX_PROJECT_CELS,
            images: MAX_PROJECT_IMAGES,
            pixelBytes: MAX_PROJECT_PIXEL_BYTES,
            name: PROJECT_NAME_LENGTH,
        }).toEqual({ ...DOCUMENT_LIMITS, name: MAX_NAME_LENGTH });
        expect(Object.isFrozen(DOCUMENT_LIMITS)).toBe(true);
    });

    it("one typed error names the limit, what was asked and what is allowed", () => {
        const error = new DocumentLimitError("frames", 7, 6);
        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({
            name: "DocumentLimitError",
            limit: "frames",
            requested: 7,
            max: 6,
        });
        expect(error.message).toBe("The document would have 7 frames; at most 6 are allowed.");
    });
});

/**
 * 8 × 8, three frames; layer "low" (bottom) has no cel, layer "up" has one image linked at all
 * three frames.
 */
function linkedOverEmpty(): DocSession {
    const session = createDocument({ name: "merge", width: 8, height: 8 });
    const { doc } = session;
    const base = doc.layers[0];
    doc.layers = [
        { ...base, id: "low", name: "Low" },
        { ...base, id: "up", name: "Up" },
    ];
    doc.frames = ["m1", "m2", "m3"].map((id) => ({ id, durationMs: 100 }));
    const data = new Uint8ClampedArray(8 * 8 * 4);
    data.set([10, 20, 30, 255], 0);
    doc.images.set("x", { width: 8, height: 8, data });
    for (const frame of doc.frames)
        doc.cels.set(celKey("up", frame.id), { imageId: "x", opacity: 255 });
    session.activeLayerId = "up";
    session.activeFrameId = "m1";
    assertInvariants(session);
    return session;
}

describe("with each limit lowered by a test option, every adding command refuses to pass it", () => {
    const cases = ADDING.flatMap(([name, limits, run]) =>
        limits.map((limit) => [name, limit, run] as const),
    );

    it.each(cases)("%s: %s", (_, limit, run) => {
        const session = fixture();
        const before = snapshot(session);
        const error = thrown(() => run(session, full(session, limit)));
        expect(error).toBeInstanceOf(DocumentLimitError);
        expect(error).toMatchObject({ limit, max: documentCounts(session.doc)[limit] });
        expect(snapshot(session)).toEqual(before);
    });

    // Merge down and flatten can add images: an upper layer's image linked across three frames
    // over an empty target becomes three images of the target, one per frame.
    const MERGES: [
        string,
        DocumentLimitName,
        (session: DocSession, limits: DocumentLimits) => unknown,
    ][] = [
        ["SE-020 merge down", "images", (s, limits) => mergeDownCommand(s, "up", { limits })],
        ["SE-020 merge down", "pixelBytes", (s, limits) => mergeDownCommand(s, "up", { limits })],
        ["SE-020 flatten", "images", (s, limits) => flattenCommand(s, { limits })],
        ["SE-020 flatten", "pixelBytes", (s, limits) => flattenCommand(s, { limits })],
    ];

    it.each(MERGES)(
        "%s: %s, an image linked across three frames over an empty layer",
        (_, limit, run) => {
            const session = linkedOverEmpty();
            const before = snapshot(session);
            // Room for one image more, not for the two the merge adds.
            const bytes = 8 * 8 * 4;
            const limits = {
                ...DOCUMENT_LIMITS,
                [limit]: documentCounts(session.doc)[limit] + (limit === "images" ? 1 : bytes),
            };
            const error = thrown(() => run(session, limits));
            expect(error).toBeInstanceOf(DocumentLimitError);
            expect(error).toMatchObject({ limit, max: limits[limit] });
            expect(snapshot(session)).toEqual(before);
        },
    );

    it.each(MERGES)(
        "%s: %s, with room for the two images it adds, it is made and done",
        (_, limit, run) => {
            const session = linkedOverEmpty();
            const bytes = 8 * 8 * 4;
            const limits = {
                ...DOCUMENT_LIMITS,
                [limit]: documentCounts(session.doc)[limit] + (limit === "images" ? 2 : 2 * bytes),
            };
            const command = run(session, limits) as Command | null;
            new History(session).execute(made(command));
            expect(session.doc.images.size).toBe(3);
            assertInvariants(session);
        },
    );

    it.each(ADDING)("%s: with room for what it adds, it is made", (_, __, run) => {
        const session = fixture();
        expect(thrown(() => run(session, DOCUMENT_LIMITS))).toBeNull();
    });

    it("a command that takes the document exactly to a limit is made; one past it is not", () => {
        const session = fixture();
        const history = new History(session);
        const limits = { ...DOCUMENT_LIMITS, layers: session.doc.layers.length + 1 };
        history.execute(addLayerCommand(session, { limits }));
        expect(session.doc.layers).toHaveLength(limits.layers);
        expect(() => addLayerCommand(session, { limits })).toThrow(DocumentLimitError);
        assertInvariants(session);
    });

    it("a transaction refused by a limit opens nothing: the history takes commands again", () => {
        const session = fixture();
        const limits = full(session, "cels");
        const history = new History(session, { limits });
        expect(() => history.begin({ layerId: L2, frameId: FRAMES[0] })).toThrow(
            DocumentLimitError,
        );
        expect(history.transaction).toBeNull();
        // A cel that exists needs nothing new.
        history.begin({ layerId: L1, frameId: FRAMES[0] }).abort();
    });
});

describe("a document exactly at a count limit saves and reopens", () => {
    it("1024 layers and 1024 tags, made by the commands: one more is refused, the file reads back", async () => {
        const session = createDocument({ name: "full", width: 2, height: 2 }, sequentialIds("a"));
        const history = new History(session);
        const ids = sequentialIds("b");
        while (session.doc.layers.length < DOCUMENT_LIMITS.layers) {
            history.execute(addLayerCommand(session, { newId: ids }));
        }
        const first = session.doc.frames[0].id;
        const tag: TagProperties = {
            name: "T",
            color: 0xffffffff,
            fromFrameId: first,
            toFrameId: first,
            direction: "forward",
            repeat: 0,
        };
        while (session.doc.tags.length < DOCUMENT_LIMITS.tags) {
            history.execute(createTagCommand(session.doc, tag, ids));
        }
        expect(() => addLayerCommand(session)).toThrow(DocumentLimitError);
        expect(() => createTagCommand(session.doc, tag)).toThrow(DocumentLimitError);

        const project = await deserialize(serialize(session.doc, new Map()));
        expect(project.doc.layers).toEqual(session.doc.layers);
        expect(project.doc.tags).toEqual(session.doc.tags);
    }, 120_000);

    it("65 535 frames, 131 072 cels on 65 527 images: one more of each is refused, the file reads back", async () => {
        const session = createDocument({ name: "full", width: 1, height: 1 });
        const { doc } = session;
        doc.layers = ["p1", "p2", "p3"].map((id) => ({ ...doc.layers[0], id }));
        session.activeLayerId = "p1";
        doc.frames = Array.from({ length: DOCUMENT_LIMITS.frames }, (_, index) => ({
            id: `f${index}`,
            durationMs: 100,
        }));
        session.activeFrameId = "f0";
        // Two full layers and two cels of the third; the cels beyond the image limit are
        // linked to the last image.
        for (let index = 0; index < DOCUMENT_LIMITS.cels; index++) {
            const layer = doc.layers[Math.floor(index / DOCUMENT_LIMITS.frames)];
            const frame = doc.frames[index % DOCUMENT_LIMITS.frames];
            const imageId = `i${Math.min(index, DOCUMENT_LIMITS.images - 1)}`;
            if (!doc.images.has(imageId)) {
                doc.images.set(imageId, {
                    width: 1,
                    height: 1,
                    data: Uint8ClampedArray.of(index % 256, 2, 3, 255),
                });
            }
            doc.cels.set(celKey(layer.id, frame.id), { imageId, opacity: 255 });
        }
        assertInvariants(session);
        expect(documentCounts(doc)).toMatchObject({
            frames: DOCUMENT_LIMITS.frames,
            cels: DOCUMENT_LIMITS.cels,
            images: DOCUMENT_LIMITS.images,
        });

        const limitOf = (run: () => unknown) => (thrown(run) as DocumentLimitError | null)?.limit;
        expect(limitOf(() => addFrameCommand(doc, "f0"))).toBe("frames");
        expect(limitOf(() => new History(session).begin({ layerId: "p3", frameId: "f9" }))).toBe(
            "cels",
        );
        expect(limitOf(() => unlinkCelsCommand(doc, { layerIds: ["p3"], frameIds: ["f0"] }))).toBe(
            "images",
        );

        const project = await deserialize(serialize(doc, new Map()));
        expect(project.doc.frames).toEqual(doc.frames);
        expect(project.doc.cels).toEqual(doc.cels);
        expect(project.doc.images.size).toBe(DOCUMENT_LIMITS.images);
    }, 300_000);
});

describe("names are limited to 255 UTF-16 code units by the commands that set them", () => {
    const longest = "n".repeat(MAX_NAME_LENGTH);
    const tooLong = "n".repeat(MAX_NAME_LENGTH + 1);

    it("SE-008 sprite rename and new sprite", () => {
        expect(renameSpriteCommand(longest).label).toBe("Rename Sprite");
        expect(() => renameSpriteCommand(tooLong)).toThrow(DocumentLimitError);
        expect(() => normalizeSpriteName(tooLong)).toThrow(DocumentLimitError);
        // Surrounding white space is not counted: the name is stored trimmed.
        expect(normalizeSpriteName(`  ${longest}  `)).toBe(longest);
        expect([isSpriteName(longest), isSpriteName(tooLong)]).toEqual([true, false]);
        // A character outside the Basic Multilingual Plane counts as two.
        expect(() => normalizeSpriteName("😀".repeat(128))).toThrow(DocumentLimitError);
    });

    it("SE-020 rename and new layer; duplicate cuts the copy's name to fit", () => {
        const session = fixture();
        const before = snapshot(session);
        expect(() => renameLayerCommand(session, L1, tooLong)).toThrow(DocumentLimitError);
        expect(() => addLayerCommand(session, { name: tooLong })).toThrow(DocumentLimitError);
        expect([isLayerName(longest), isLayerName(tooLong)]).toEqual([true, false]);
        expect(snapshot(session)).toEqual(before);

        const history = new History(session);
        history.execute(made(renameLayerCommand(session, L1, longest)));
        history.execute(duplicateLayerCommand(session, L1, { newId: sequentialIds("copy") }));
        const copy = session.doc.layers.find((layer) => layer.id === "copy1");
        expect(copy?.name).toBe(longest);

        // 251 code units and " Copy": cut after " Cop".
        history.execute(made(renameLayerCommand(session, L1, `${"m".repeat(249)}😀`)));
        history.execute(duplicateLayerCommand(session, L1, { newId: sequentialIds("again") }));
        expect(session.doc.layers.find((layer) => layer.id === "again1")?.name).toBe(
            `${"m".repeat(249)}😀 Cop`,
        );
        assertInvariants(session);
    });

    it("cuts a name without leaving half of a surrogate pair", () => {
        expect(truncateName(`${"x".repeat(254)}😀`)).toBe("x".repeat(254));
        expect(truncateName(longest)).toBe(longest);
    });

    it("SE-021 create and edit tag", () => {
        const session = fixture();
        const before = snapshot(session);
        expect(() => createTagCommand(session.doc, tagOf(tooLong))).toThrow(DocumentLimitError);
        expect(() => editTagCommand(session.doc, "tag-1", { name: tooLong })).toThrow(
            DocumentLimitError,
        );
        expect(snapshot(session)).toEqual(before);
        expect(createTagCommand(session.doc, tagOf(longest)).label).toBe("New Tag");
        expect(made(editTagCommand(session.doc, "tag-1", { name: longest })).label).toBe(
            "Edit Tag",
        );
    });

    it("the palette name", () => {
        const session = fixture();
        const { colors } = session.doc.palette;
        expect(() => setPaletteCommand(session, { name: tooLong, colors }, "Rename")).toThrow(
            DocumentLimitError,
        );
        expect(made(setPaletteCommand(session, { name: longest, colors }, "Rename")).label).toBe(
            "Rename",
        );
    });
});
