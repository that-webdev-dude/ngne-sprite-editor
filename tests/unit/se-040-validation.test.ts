import { describe, expect, it } from "vitest";
import {
    INVARIANTS,
    InvariantError,
    MAX_DOCUMENT_SIDE,
    MAX_REFERENCE_LAYERS,
    celKey,
    createDocument,
} from "../../src/core/model";
import type { InvariantName, PixelBuffer, ReferenceLayer, SpriteDoc } from "../../src/core/model";
import { PngError, encodePng } from "../../src/core/png";
import {
    MAX_ID_LENGTH,
    MAX_PROJECT_FRAMES,
    MAX_PROJECT_LAYERS,
    MAX_PROJECT_PIXEL_BYTES,
    MAX_PROJECT_TAGS,
    MAX_REFERENCE_SOURCE_BYTES,
    ProjectError,
    deserialize,
    docFromJson,
    docToJson,
    isProjectId,
    serialize,
} from "../../src/core/project";
import type { DocJson, ProjectErrorCode } from "../../src/core/project";
import { MAX_PROJECT_ENTRIES } from "../../src/core/project/format";
import { MAX_GRID_OFFSET, MAX_GRID_SIDE, MIN_GRID_SIDE } from "../../src/core/sprite";
import {
    HEIGHT,
    SOURCE_ID,
    WIDTH,
    expectFailure,
    failure,
    fixtureDocJson,
    fixtureDocument,
    fixtureFile,
    fixtureSources,
    jsonBytes,
    noiseImage,
    pngChunk,
    pngFile,
    pngHeaderChunk,
    projectEntries,
    rebuilt,
    smallDocument,
    thrown,
    withDocJson,
    zipOf,
} from "./se-040-support";

// --- changing a parsed JSON value by path -------------------------------------------------------

type Change = (json: unknown) => void;

/** The object or array that holds the value at `path` (`layers[2].opacity`), and its key. */
function holder(root: unknown, path: string): [Record<string, unknown>, string] {
    const keys = path.split(/[.[\]]+/).filter((key) => key !== "");
    let value = root as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) {
        value = value[key] as Record<string, unknown>;
    }
    return [value, keys[keys.length - 1]];
}

const set =
    (path: string, value: unknown): Change =>
    (json) => {
        const [target, key] = holder(json, path);
        target[key] = value;
    };

const drop =
    (path: string): Change =>
    (json) => {
        const [target, key] = holder(json, path);
        delete target[key];
    };

function changedDocJson(...changes: Change[]): DocJson {
    const json = fixtureDocJson();
    for (const change of changes) change(json);
    return json;
}

const manifest = (value: unknown) => rebuilt(fixtureFile(), { "manifest.json": jsonBytes(value) });
const MANIFEST = { format: "ngne-sprite-project", version: 1, generator: "a test" };

// --- manifest -----------------------------------------------------------------------------------

describe("deserialize: manifest", () => {
    it("rejects a zip archive without manifest.json", async () => {
        const error = await expectFailure(
            rebuilt(fixtureFile(), { "manifest.json": null }),
            "missing-manifest",
            /has no entry "manifest.json": it is not a sprite project/,
        );
        expect(error.entry).toBe("manifest.json");
    });

    it.each<[string, unknown, RegExp]>([
        ["an array", [MANIFEST], /the top-level value must be an object, got an array/],
        ["a string", "ngne-sprite-project", /the top-level value must be an object/],
        ["null", null, /the top-level value must be an object, got null/],
        [
            "without a format",
            { version: 1, generator: "x" },
            /`format` must be "ngne-sprite-project"/,
        ],
        [
            "of another format",
            { ...MANIFEST, format: "ngne-sprite-atlas" },
            /`format` must be "ngne-sprite-project": the file is not a sprite project/,
        ],
        [
            "without a version",
            { format: MANIFEST.format, generator: "x" },
            /`version` must be an integer/,
        ],
        [
            "with version 0",
            { ...MANIFEST, version: 0 },
            /`version` must be an integer of at least 1, got 0/,
        ],
        [
            "with version -1",
            { ...MANIFEST, version: -1 },
            /`version` must be an integer of at least 1/,
        ],
        [
            "with version 1.5",
            { ...MANIFEST, version: 1.5 },
            /`version` must be an integer of at least 1/,
        ],
        [
            'with version "1"',
            { ...MANIFEST, version: "1" },
            /`version` must be an integer of at least 1, got string/,
        ],
        ["with version null", { ...MANIFEST, version: null }, /`version` must be an integer/],
        [
            "without a generator",
            { format: MANIFEST.format, version: 1 },
            /has no field `generator`/,
        ],
        [
            "with a generator that is no string",
            { ...MANIFEST, generator: 7 },
            /`generator` must be a string, got 7/,
        ],
        [
            "with an unknown field",
            { ...MANIFEST, appVersion: "1.0.0" },
            /has an unknown field "appVersion"/,
        ],
    ])("rejects a manifest %s", async (_name, value, message) => {
        const error = await expectFailure(manifest(value), "invalid-manifest", message);
        expect(error.message).toMatch(/^manifest.json: /);
        expect(error.entry).toBe("manifest.json");
    });

    it("rejects a project of a newer schema version, naming both versions", async () => {
        for (const version of [2, 3, 999]) {
            const error = await expectFailure(
                manifest({ ...MANIFEST, version }),
                "newer-version",
                new RegExp(
                    `has schema version ${version}, and this version of the editor reads up to version 1`,
                ),
            );
            expect(error.message).toMatch(/Open it with a newer version of the editor/);
        }
    });

    it("tells a newer project from a damaged one, whatever else it holds", async () => {
        // A later version may add fields to the manifest and change every other entry.
        const newer = { ...MANIFEST, version: 2, minimumReader: 2, features: ["tilemaps"] };
        const bytes = rebuilt(fixtureFile(), {
            "manifest.json": jsonBytes(newer),
            "doc.json": jsonBytes({ schema: "something else entirely" }),
            "images/image-bg.png": null,
        });
        await expectFailure(bytes, "newer-version", /schema version 2/);
        await expectFailure(
            rebuilt(fixtureFile(), { "manifest.json": jsonBytes(newer), "doc.json": null }),
            "newer-version",
            /schema version 2/,
        );
    });

    it("accepts any generator", async () => {
        const project = await deserialize(manifest({ ...MANIFEST, generator: "" }));
        expect(project.doc).toEqual(fixtureDocument());
    });

    it("does not take an entry of a similar name for the manifest", async () => {
        const entries = projectEntries(fixtureFile());
        for (const name of [
            "Manifest.json",
            "MANIFEST.JSON",
            "./manifest.json",
            "/manifest.json",
            "manifest.json/",
            "manifest.json\0",
            "﻿manifest.json",
            "project/manifest.json",
        ]) {
            const bytes = zipOf([{ ...entries[0], name }, ...entries.slice(1)]);
            const error = await failure(bytes, name);
            expect(error.code, JSON.stringify(name)).toBe("missing-manifest");
        }
    });

    it("rejects a project without doc.json", async () => {
        const error = await expectFailure(
            rebuilt(fixtureFile(), { "doc.json": null }),
            "missing-document",
            /has no entry "doc.json"/,
        );
        expect(error.entry).toBe("doc.json");
    });
});

// --- doc.json -----------------------------------------------------------------------------------

const LONG_ID = "x".repeat(MAX_ID_LENGTH + 1);

/** One wrong value each: where, what, and the part of the message that names it. */
const invalid: [string, Change, RegExp][] = [
    // Shape
    [
        "an unknown field: selection",
        set("selection", null),
        /top-level value has an unknown field "selection"/,
    ],
    [
        "an unknown field: activeLayerId",
        set("activeLayerId", "layer-bg"),
        /unknown field "activeLayerId"/,
    ],
    ["an unknown field: images", set("images", ["image-bg"]), /unknown field "images"/],
    [
        "an unknown field: __proto__",
        (json) => Object.defineProperty(json, "__proto__", { value: 1, enumerable: true }),
        /unknown field "__proto__"/,
    ],

    // Document
    ["an empty id", set("id", ""), /`id` must be an ID of 1 to 64 characters/],
    ["an id with a space", set("id", "doc hero"), /`id` must be an ID .* got "doc hero"/],
    ["an id that is a number", set("id", 7), /`id` must be an ID .* got 7/],
    ["an id of 65 characters", set("id", LONG_ID), /`id` must be an ID/],
    ["a name that is a number", set("name", 5), /`name` must be a string, got 5/],
    ["an empty name", set("name", ""), /`name` must not be empty or only white space/],
    ["a name of white space", set("name", " \t\n"), /`name` must not be empty or only white space/],
    ["width 0", set("width", 0), /`width` must be an integer from 1 to 1024, got 0/],
    ["width 1025", set("width", 1025), /`width` must be an integer from 1 to 1024, got 1025/],
    [
        "width 100000",
        set("width", 100_000),
        /`width` must be an integer from 1 to 1024, got 100000/,
    ],
    ["a fractional width", set("width", 4.5), /`width` must be an integer from 1 to 1024, got 4.5/],
    ['width "4"', set("width", "4"), /`width` must be an integer from 1 to 1024, got "4"/],
    ["width null", set("width", null), /`width` must be an integer from 1 to 1024, got null/],
    ["height 0", set("height", 0), /`height` must be an integer from 1 to 1024, got 0/],
    ["height -3", set("height", -3), /`height` must be an integer from 1 to 1024, got -3/],
    ["height 1025", set("height", 1025), /`height` must be an integer from 1 to 1024/],
    [
        "another colour mode",
        set("colorMode", "indexed"),
        /`colorMode` must be one of "rgba", got "indexed"/,
    ],

    // Layers
    ["layers that are an object", set("layers", {}), /`layers` must be an array, got an object/],
    [
        "a layer that is a string",
        set("layers[1]", "layer-bg"),
        /`layers\[1\]` must be an object, got "layer-bg"/,
    ],
    ["a layer that is null", set("layers[1]", null), /`layers\[1\]` must be an object, got null/],
    [
        "a layer without a kind",
        drop("layers[1].kind"),
        /`layers\[1\].kind` must be one of "pixel", "reference", got nothing/,
    ],
    [
        "a layer of another kind",
        set("layers[1].kind", "group"),
        /`layers\[1\].kind` must be one of "pixel", "reference"/,
    ],
    [
        "a pixel layer without a blend mode",
        drop("layers[1].blend"),
        /`layers\[1\]` has no field `blend`/,
    ],
    [
        "a pixel layer with a source",
        set("layers[1].sourceId", "s"),
        /`layers\[1\]` has an unknown field "sourceId"/,
    ],
    [
        "a reference layer with a blend mode",
        set("layers[0].blend", "normal"),
        /`layers\[0\]` has an unknown field "blend"/,
    ],
    ["a reference layer without a position", drop("layers[0].y"), /`layers\[0\]` has no field `y`/],
    ["a layer id with a slash", set("layers[2].id", "a/b"), /`layers\[2\].id` must be an ID/],
    ["a layer id that walks up", set("layers[2].id", "../x"), /`layers\[2\].id` must be an ID/],
    [
        "a layer name that is a number",
        set("layers[1].name", 1),
        /`layers\[1\].name` must be a string/,
    ],
    [
        'visible "yes"',
        set("layers[1].visible", "yes"),
        /`layers\[1\].visible` must be true or false, got "yes"/,
    ],
    ["locked 0", set("layers[1].locked", 0), /`layers\[1\].locked` must be true or false, got 0/],
    [
        "a layer opacity of 256",
        set("layers[1].opacity", 256),
        /`layers\[1\].opacity` must be an integer from 0 to 255, got 256/,
    ],
    [
        "a layer opacity of -1",
        set("layers[1].opacity", -1),
        /`layers\[1\].opacity` must be an integer from 0 to 255/,
    ],
    [
        "a layer opacity of 0.5",
        set("layers[1].opacity", 0.5),
        /`layers\[1\].opacity` must be an integer from 0 to 255/,
    ],
    [
        "an unknown blend mode",
        set("layers[1].blend", "burn"),
        /`layers\[1\].blend` must be one of "normal", "multiply"/,
    ],
    [
        "a source id with a dot",
        set("layers[0].sourceId", "sketch.png"),
        /`layers\[0\].sourceId` must be an ID/,
    ],
    [
        "a source id that walks up",
        set("layers[0].sourceId", "../../secret"),
        /`layers\[0\].sourceId` must be an ID/,
    ],
    ['a reference x of "1"', set("layers[0].x", "1"), /`layers\[0\].x` must be a number, got "1"/],
    [
        "a reference y of null",
        set("layers[0].y", null),
        /`layers\[0\].y` must be a number, got null/,
    ],
    [
        "a reference scale of 0",
        set("layers[0].scale", 0),
        /`layers\[0\].scale` must be above 0, got 0/,
    ],
    [
        "a negative reference scale",
        set("layers[0].scale", -2),
        /`layers\[0\].scale` must be above 0, got -2/,
    ],
    [
        "a placement in the middle",
        set("layers[0].placement", "middle"),
        /`layers\[0\].placement` must be one of "behind", "front"/,
    ],

    // Frames
    ["frames that are a number", set("frames", 5), /`frames` must be an array, got 5/],
    ["a frame id with a colon", set("frames[0].id", "frame:1"), /`frames\[0\].id` must be an ID/],
    [
        "a duration of 0",
        set("frames[1].durationMs", 0),
        /`frames\[1\].durationMs` must be an integer from 1 to 65535, got 0/,
    ],
    [
        "a duration of 65536",
        set("frames[1].durationMs", 65_536),
        /`frames\[1\].durationMs` must be an integer from 1 to 65535/,
    ],
    [
        "a fractional duration",
        set("frames[1].durationMs", 16.7),
        /`frames\[1\].durationMs` must be an integer/,
    ],
    [
        "a frame with an unknown field",
        set("frames[1].label", "x"),
        /`frames\[1\]` has an unknown field "label"/,
    ],
    [
        "a frame without a duration",
        drop("frames[1].durationMs"),
        /`frames\[1\]` has no field `durationMs`/,
    ],

    // Cels
    [
        "cels that are an object",
        set("cels", { "layer-bg:frame-1": {} }),
        /`cels` must be an array, got an object/,
    ],
    [
        "a cel on a layer that does not exist",
        set("cels[0].layerId", "layer-gone"),
        /`cels\[0\].layerId` names no pixel layer: "layer-gone"/,
    ],
    [
        "a cel on the reference layer",
        set("cels[0].layerId", "layer-ref"),
        /`cels\[0\].layerId` names no pixel layer: "layer-ref"/,
    ],
    [
        "a cel at a frame that does not exist",
        set("cels[0].frameId", "frame-9"),
        /`cels\[0\].frameId` names no frame: "frame-9"/,
    ],
    [
        "two cels of one layer at one frame",
        set("cels[1].frameId", "frame-1"),
        /`cels\[1\]` is a second cel of layer "layer-bg" at frame "frame-1"/,
    ],
    [
        "an image id that walks up",
        set("cels[0].imageId", "../../etc/passwd"),
        /`cels\[0\].imageId` must be an ID/,
    ],
    [
        "an image id with a backslash",
        set("cels[0].imageId", "a\\b"),
        /`cels\[0\].imageId` must be an ID/,
    ],
    ["an image id with a NUL", set("cels[0].imageId", "a\0b"), /`cels\[0\].imageId` must be an ID/],
    ["an empty image id", set("cels[0].imageId", ""), /`cels\[0\].imageId` must be an ID/],
    [
        "an image id of 65 characters",
        set("cels[0].imageId", LONG_ID),
        /`cels\[0\].imageId` must be an ID/,
    ],
    [
        "a cel opacity of 256",
        set("cels[0].opacity", 256),
        /`cels\[0\].opacity` must be an integer from 0 to 255/,
    ],
    [
        "a cel with pixels",
        set("cels[0].data", [0, 0, 0, 0]),
        /`cels\[0\]` has an unknown field "data"/,
    ],
    [
        "a cel that is an array",
        set("cels[0]", ["layer-bg", "frame-1"]),
        /`cels\[0\]` must be an object, got an array/,
    ],
    [
        "two image IDs that differ only in case",
        set("cels[6].imageId", "Image-BG"),
        /`cels\[6\].imageId` differs from the ID "image-bg" only in the case of its letters: "Image-BG"/,
    ],
    [
        "two source IDs that differ only in case",
        // A second reference layer, on top of the stack.
        set("layers[4]", {
            ...fixtureDocJson().layers[0],
            id: "layer-ref-2",
            sourceId: "SOURCE-sketch",
        }),
        /`layers\[4\].sourceId` differs from the ID "source-sketch" only in the case of its letters/,
    ],

    // Tags
    ["tags that are null", set("tags", null), /`tags` must be an array, got null/],
    [
        "a tag colour that is a name",
        set("tags[0].color", "red"),
        /`tags\[0\].color` must be a colour written "#rrggbbaa", got "red"/,
    ],
    [
        "a tag colour of three digits",
        set("tags[0].color", "#f00"),
        /`tags\[0\].color` must be a colour written "#rrggbbaa"/,
    ],
    [
        "a tag colour without alpha",
        set("tags[0].color", "#ff0000"),
        /`tags\[0\].color` must be a colour written "#rrggbbaa"/,
    ],
    [
        "a tag colour with a bad digit",
        set("tags[0].color", "#12345g78"),
        /`tags\[0\].color` must be a colour written "#rrggbbaa"/,
    ],
    [
        "a tag colour that is a number",
        set("tags[0].color", 0xff0000ff),
        /`tags\[0\].color` must be a colour written "#rrggbbaa", got 4278190335/,
    ],
    [
        "an unknown direction",
        set("tags[0].direction", "bounce"),
        /`tags\[0\].direction` must be one of "forward", "reverse", "pingpong"/,
    ],
    [
        "a repeat of -1",
        set("tags[1].repeat", -1),
        /`tags\[1\].repeat` must be an integer from 0 to 65535, got -1/,
    ],
    [
        "a repeat of 65536",
        set("tags[1].repeat", 65_536),
        /`tags\[1\].repeat` must be an integer from 0 to 65535/,
    ],
    [
        "a tag endpoint that is no ID",
        set("tags[0].fromFrameId", "frame 1"),
        /`tags\[0\].fromFrameId` must be an ID/,
    ],
    ["a tag without a name", drop("tags[0].name"), /`tags\[0\]` has no field `name`/],

    // Palette and pivot
    [
        "a palette that is an array",
        set("palette", ["#000000ff"]),
        /`palette` must be an object, got an array/,
    ],
    [
        "a palette colour that is a number",
        set("palette.colors[2]", 0x12345678),
        /`palette.colors\[2\]` must be a colour written "#rrggbbaa"/,
    ],
    [
        "a palette of 257 colours",
        set("palette.colors", Array(257).fill("#000000ff")),
        /`palette.colors` holds 257 items; at most 256 are allowed/,
    ],
    ["a palette without a name", drop("palette.name"), /`palette` has no field `name`/],
    [
        "a pivot left of the canvas",
        set("pivot.x", -0.1),
        /`pivot.x` must be a number from 0 to 1, got -0.1/,
    ],
    [
        "a pivot below the canvas",
        set("pivot.y", 1.5),
        /`pivot.y` must be a number from 0 to 1, got 1.5/,
    ],
    [
        'a pivot x of "0.5"',
        set("pivot.x", "0.5"),
        /`pivot.x` must be a number from 0 to 1, got "0.5"/,
    ],
    ["a pivot without y", drop("pivot.y"), /`pivot` has no field `y`/],

    // Settings
    [
        "settings with an unknown field",
        set("settings.checkerboard", true),
        /`settings` has an unknown field "checkerboard"/,
    ],
    ["settings without onion", drop("settings.onion"), /`settings` has no field `onion`/],
    [
        "a grid width of 0",
        set("settings.grid.width", 0),
        /`settings.grid.width` must be an integer from 1 to 1024, got 0/,
    ],
    [
        "a grid height of 1025",
        set("settings.grid.height", 1025),
        /`settings.grid.height` must be an integer from 1 to 1024/,
    ],
    [
        "a grid offset of 1025",
        set("settings.grid.offsetX", 1025),
        /`settings.grid.offsetX` must be an integer from -1024 to 1024/,
    ],
    [
        "a grid offset of -1025",
        set("settings.grid.offsetY", -1025),
        /`settings.grid.offsetY` must be an integer from -1024 to 1024/,
    ],
    [
        "a fractional grid offset",
        set("settings.grid.offsetX", 0.5),
        /`settings.grid.offsetX` must be an integer/,
    ],
    [
        "grid visible 1",
        set("settings.grid.visible", 1),
        /`settings.grid.visible` must be true or false, got 1/,
    ],
    [
        'pixelGrid "true"',
        set("settings.pixelGrid", "true"),
        /`settings.pixelGrid` must be true or false/,
    ],
    [
        "4 onion frames before",
        set("settings.onion.before", 4),
        /`settings.onion.before` must be an integer from 0 to 3, got 4/,
    ],
    [
        "-1 onion frames after",
        set("settings.onion.after", -1),
        /`settings.onion.after` must be an integer from 0 to 3, got -1/,
    ],
    [
        "an onion opacity of 256",
        set("settings.onion.opacity", 256),
        /`settings.onion.opacity` must be an integer from 0 to 255/,
    ],
    [
        "an onion falloff of 1.5",
        set("settings.onion.falloff", 1.5),
        /`settings.onion.falloff` must be a number from 0 to 1, got 1.5/,
    ],
    [
        "an onion falloff of -0.1",
        set("settings.onion.falloff", -0.1),
        /`settings.onion.falloff` must be a number from 0 to 1/,
    ],
    [
        "an onion placement in the middle",
        set("settings.onion.placement", "middle"),
        /`settings.onion.placement` must be one of "behind", "front"/,
    ],
    [
        "an unknown symmetry mode",
        set("settings.symmetry.mode", "z"),
        /`settings.symmetry.mode` must be one of "none", "x", "y", "both"/,
    ],
    [
        "a symmetry axis of -1",
        set("settings.symmetry.axisX", -1),
        /`settings.symmetry.axisX` must be an integer from 0 to 2048, got -1/,
    ],
    [
        "a symmetry axis of 2049",
        set("settings.symmetry.axisY", 2049),
        /`settings.symmetry.axisY` must be an integer from 0 to 2048/,
    ],
    [
        "a symmetry axis of 1.5",
        set("settings.symmetry.axisX", 1.5),
        /`settings.symmetry.axisX` must be an integer/,
    ],
    [
        "an unknown tiled mode",
        set("settings.tiled", "z"),
        /`settings.tiled` must be one of "none", "x", "y", "both"/,
    ],

    // Export settings
    [
        "an unknown layout",
        set("exportSettings.layout", "pack"),
        /`exportSettings.layout` must be one of "grid", "row", "column"/,
    ],
    [
        "a padding of 9",
        set("exportSettings.padding", 9),
        /`exportSettings.padding` must be an integer from 0 to 8, got 9/,
    ],
    [
        "a padding of -1",
        set("exportSettings.padding", -1),
        /`exportSettings.padding` must be an integer from 0 to 8/,
    ],
    [
        "an extrude of 3",
        set("exportSettings.extrude", 3),
        /`exportSettings.extrude` must be an integer from 0 to 2, got 3/,
    ],
    ["trim 0", set("exportSettings.trim", 0), /`exportSettings.trim` must be true or false/],
    [
        "mergeDuplicates null",
        set("exportSettings.mergeDuplicates", null),
        /`exportSettings.mergeDuplicates` must be true or false/,
    ],
    [
        'frames "tag"',
        set("exportSettings.frames", "tag"),
        /`exportSettings.frames` must be "all" or an object with the field `tagId`/,
    ],
    [
        "frames null",
        set("exportSettings.frames", null),
        /`exportSettings.frames` must be "all" or an object/,
    ],
    [
        "frames 5",
        set("exportSettings.frames", 5),
        /`exportSettings.frames` must be "all" or an object/,
    ],
    ["frames {}", set("exportSettings.frames", {}), /`exportSettings.frames` has no field `tagId`/],
    [
        "frames with a tag id that is no ID",
        set("exportSettings.frames.tagId", "tag idle"),
        /`exportSettings.frames.tagId` must be an ID/,
    ],
    [
        "frames with a second field",
        set("exportSettings.frames.all", true),
        /`exportSettings.frames` has an unknown field "all"/,
    ],
    [
        "files without spritesTs",
        drop("exportSettings.files.spritesTs"),
        /`exportSettings.files` has no field `spritesTs`/,
    ],
    [
        'asepriteJson "yes"',
        set("exportSettings.files.asepriteJson", "yes"),
        /`exportSettings.files.asepriteJson` must be one of "none", "array", "hash"/,
    ],
    [
        'exportOnSave "no"',
        set("exportSettings.exportOnSave", "no"),
        /`exportSettings.exportOnSave` must be true or false/,
    ],
];

describe("deserialize: doc.json against the schema", () => {
    it.each(invalid)("rejects %s", async (_name, change, message) => {
        const error = await expectFailure(
            withDocJson(changedDocJson(change)),
            "invalid-document",
            message,
        );
        expect(error.message).toMatch(/^doc.json: /);
        expect(error.entry).toBe("doc.json");
    });

    it.each<[string, unknown]>([
        ["an array", [fixtureDocJson()]],
        ["a string", "doc"],
        ["a number", 42],
        ["null", null],
        ["true", true],
    ])("rejects a doc.json that is %s", async (_name, value) => {
        await expectFailure(
            withDocJson(value),
            "invalid-document",
            /the top-level value must be an object/,
        );
    });

    it("rejects a doc.json without any one of its fields", async () => {
        const fields = Object.keys(fixtureDocJson());
        expect(fields).toHaveLength(13);
        for (const field of fields) {
            await expectFailure(
                withDocJson(changedDocJson(drop(field))),
                "invalid-document",
                new RegExp(`the top-level value has no field \`${field}\``),
            );
        }
    });

    it("rejects a number JSON can spell and a double cannot hold", async () => {
        // 1e999 parses to Infinity.
        const text = JSON.stringify(fixtureDocJson()).replace('"x":-1.5', '"x":-1e999');
        expect(text).toContain('"x":-1e999');
        await expectFailure(
            rebuilt(fixtureFile(), { "doc.json": Buffer.from(text) }),
            "invalid-document",
            /`layers\[0\].x` must be a number, got -Infinity/,
        );
    });

    it("rejects more layers, frames or tags than a project holds", async () => {
        expect([MAX_PROJECT_LAYERS, MAX_PROJECT_FRAMES, MAX_PROJECT_TAGS]).toEqual([
            1024, 65_535, 1024,
        ]);
        const layer = fixtureDocJson().layers[1];
        const frame = fixtureDocJson().frames[0];
        const tag = fixtureDocJson().tags[0];
        const many = <T extends { id: string }>(item: T, count: number): T[] =>
            Array.from({ length: count }, (_, index) => ({ ...item, id: `n${index}` }));

        await expectFailure(
            withDocJson(changedDocJson(set("layers", many(layer, 1025)))),
            "invalid-document",
            /`layers` holds 1025 items; at most 1024 are allowed/,
        );
        await expectFailure(
            withDocJson(changedDocJson(set("frames", many(frame, 65_536)))),
            "invalid-document",
            /`frames` holds 65536 items; at most 65535 are allowed/,
        );
        await expectFailure(
            withDocJson(changedDocJson(set("tags", many(tag, 1025)))),
            "invalid-document",
            /`tags` holds 1025 items; at most 1024 are allowed/,
        );
    });

    it("reads the largest document the counts allow in little time", async () => {
        // 65 535 frames and 1024 tags over them: the invariants compare every tag with the
        // frame list, which is what the limits keep small.
        const json = changedDocJson(set("cels", []), set("exportSettings.frames", "all"));
        json.frames = Array.from({ length: MAX_PROJECT_FRAMES }, (_, index) => ({
            id: `f${index}`,
            durationMs: 100,
        }));
        json.tags = Array.from({ length: MAX_PROJECT_TAGS }, (_, index) => ({
            ...fixtureDocJson().tags[0],
            id: `t${index}`,
            fromFrameId: `f${MAX_PROJECT_FRAMES - 2}`,
            toFrameId: `f${MAX_PROJECT_FRAMES - 1}`,
        }));
        const bytes = withDocJson(json);

        // About a second on a development machine. Without the limits on the counts, a file
        // of a few megabytes would take minutes.
        const started = performance.now();
        const { doc } = await deserialize(bytes);
        expect(performance.now() - started).toBeLessThan(15_000);
        expect([doc.frames.length, doc.tags.length]).toEqual([65_535, 1024]);
    }, 30_000);

    it("writes a document of 1024 layers and 65 535 frames with a single cel in little time", async () => {
        // The cel is the last of the grid: a writer that walked all 67 million places of it
        // to find the cel would take many seconds.
        const { doc } = createDocument({ name: "sparse", width: 1, height: 1 });
        doc.layers = Array.from({ length: MAX_PROJECT_LAYERS }, (_, index) => ({
            ...doc.layers[0],
            id: `l${index}`,
        }));
        doc.frames = Array.from({ length: MAX_PROJECT_FRAMES }, (_, index) => ({
            id: `f${index}`,
            durationMs: 100,
        }));
        doc.images.set("image", { width: 1, height: 1, data: Uint8ClampedArray.of(1, 2, 3, 4) });
        doc.cels.set(celKey("l1023", "f65534"), { imageId: "image", opacity: 255 });

        const started = performance.now();
        expect(docToJson(doc).cels).toEqual([
            { layerId: "l1023", frameId: "f65534", imageId: "image", opacity: 255 },
        ]);
        expect(performance.now() - started).toBeLessThan(2000);
        const project = await deserialize(serialize(doc, new Map()));
        expect(project.doc).toEqual(doc);
    }, 30_000);

    it("accepts every value at the end of its range", () => {
        const json = changedDocJson(
            set("cels", []),
            set("id", "A-Za-z0-9_-"),
            set("name", "✦"),
            set("width", 1),
            set("height", 1024),
            set("layers[1].opacity", 0),
            set("layers[1].name", ""),
            set("layers[0].x", -1e308),
            set("layers[0].y", 1e308),
            set("layers[0].scale", 5e-324),
            set("layers[0].sourceId", "s".repeat(MAX_ID_LENGTH)),
            set("frames[0].durationMs", 1),
            set("frames[1].durationMs", 65_535),
            set("tags[0].repeat", 65_535),
            set("tags[0].name", ""),
            set("tags[0].color", "#00000000"),
            set("tags[1].color", "#FFFFFFFF"),
            set("palette.name", ""),
            set("palette.colors", Array(256).fill("#ffffffff")),
            set("pivot.x", 0),
            set("pivot.y", 1),
            set("settings.grid.width", 1),
            set("settings.grid.height", 1024),
            set("settings.grid.offsetX", -1024),
            set("settings.grid.offsetY", 1024),
            set("settings.onion.before", 0),
            set("settings.onion.after", 3),
            set("settings.onion.opacity", 0),
            set("settings.onion.falloff", 0),
            set("settings.symmetry.axisX", 0),
            set("settings.symmetry.axisY", 2048),
            set("exportSettings.padding", 8),
            set("exportSettings.extrude", 0),
        );

        const doc = docFromJson(JSON.parse(JSON.stringify(json)), new Map());
        expect(docToJson(doc)).toEqual({
            ...json,
            tags: [json.tags[0], { ...json.tags[1], color: "#ffffffff" }],
        });
        expect(doc.palette.colors).toHaveLength(256);
        expect([doc.width, doc.height]).toEqual([1, 1024]);

        // An empty palette and no tags are a document too.
        const bare = changedDocJson(
            set("cels", []),
            set("tags", []),
            set("palette.colors", []),
            set("exportSettings.frames", "all"),
        );
        expect(docFromJson(bare, new Map()).palette.colors).toEqual([]);
    });

    it("has the ranges of the model and of the grid setter", () => {
        // The numbers in docs/FORMAT.md are written out in core/project, not taken from these
        // constants: a format does not change because a constant does. When this fails, the
        // model moved, and the format needs a decision.
        expect(MAX_DOCUMENT_SIDE).toBe(1024);
        expect(MAX_REFERENCE_LAYERS).toBe(4);
        expect([MIN_GRID_SIDE, MAX_GRID_SIDE, MAX_GRID_OFFSET]).toEqual([1, 1024, 1024]);
        expect(MAX_PROJECT_PIXEL_BYTES).toBe(1024 ** 3);

        // A new document of the largest size, as the editor makes it, is within the schema.
        const { doc } = createDocument({ name: "largest", width: 1024, height: 1024 });
        expect(docFromJson(docToJson(doc), new Map())).toEqual(doc);
        // Its IDs are the editor's random ones.
        expect(isProjectId(doc.id)).toBe(true);
        expect(isProjectId(crypto.randomUUID())).toBe(true);
    });

    it("defines an ID as 1 to 64 characters of A-Z, a-z, 0-9, underscore and hyphen", () => {
        for (const id of ["a", "A-Za-z0-9_-", "0", "-", "_", "x".repeat(64)]) {
            expect(isProjectId(id), id).toBe(true);
        }
        const bad = [
            "",
            "x".repeat(65),
            "a b",
            "a.b",
            "a/b",
            "a\\b",
            "a:b",
            "é",
            "a\n",
            "\na",
            "a\0",
            5,
            null,
            undefined,
            ["a"],
        ];
        for (const id of bad) {
            expect(isProjectId(id), String(id)).toBe(false);
        }
    });
});

// --- images -------------------------------------------------------------------------------------

describe("deserialize: images", () => {
    const pixels = (count: number, samples: number[]) =>
        Array.from({ length: count }, () => samples);

    it("rejects a document whose image has no entry, naming it", async () => {
        const error = await expectFailure(
            rebuilt(fixtureFile(), { "images/image-body-c.png": null }),
            "missing-image",
            /names the image "image-body-c", and the file has no entry "images\/image-body-c.png"/,
        );
        expect(error.entry).toBe("images/image-body-c.png");

        // An image a cel names that the file never had.
        const json = changedDocJson(set("cels[9].imageId", "image-new"));
        await expectFailure(withDocJson(json), "missing-image", /"images\/image-new.png"/);
    });

    it.each([
        ["wider", WIDTH + 1, HEIGHT],
        ["narrower", WIDTH - 1, HEIGHT],
        ["taller", WIDTH, HEIGHT + 1],
        ["turned", HEIGHT, WIDTH],
        ["a single pixel", 1, 1],
    ])("rejects an image that is %s than the document", async (_name, width, height) => {
        const png = encodePng(noiseImage(3, width, height));
        const error = await expectFailure(
            rebuilt(fixtureFile(), { "images/image-bg.png": png }),
            "image-size",
            new RegExp(
                `"images/image-bg.png" is an image of ${width}×${height} pixels; the document is 4×3`,
            ),
        );
        expect(error.entry).toBe("images/image-bg.png");
    });

    it("rejects every image when the document states another size than its images have", async () => {
        const json = changedDocJson(set("width", 3));
        await expectFailure(
            withDocJson(json),
            "image-size",
            /is an image of 4×3 pixels; the document is 3×3/,
        );
    });

    it.each([
        [
            "RGB",
            pngFile(WIDTH, HEIGHT, pixels(12, [1, 2, 3])),
            /colour type 2 with 8 bits per sample;/,
        ],
        [
            "16-bit RGBA",
            Buffer.concat([
                Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
                pngHeaderChunk(WIDTH, HEIGHT, 16, 6),
                pngChunk("IEND"),
            ]),
            /colour type 6 with 16 bits per sample;/,
        ],
        [
            "indexed",
            Buffer.concat([
                Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
                pngHeaderChunk(WIDTH, HEIGHT, 8, 3),
                pngChunk("IEND"),
            ]),
            /colour type 3 with 8 bits per sample;/,
        ],
        [
            "interlaced RGBA",
            Buffer.concat([
                Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
                pngHeaderChunk(WIDTH, HEIGHT, 8, 6, 1),
                pngChunk("IEND"),
            ]),
            /colour type 6 with 8 bits per sample, interlaced;/,
        ],
    ])("rejects an image entry that is an %s PNG", async (_name, png, message) => {
        const error = await expectFailure(
            rebuilt(fixtureFile(), { "images/image-fx.png": png }),
            "image-format",
            message,
        );
        expect(error.message).toMatch(
            /an image of a project is 8-bit RGBA \(colour type 6\), not interlaced/,
        );
        expect(error.entry).toBe("images/image-fx.png");
    });

    it.each([
        ["text", Buffer.from("this is not a PNG file, and long enough to hold a header")],
        ["a JPEG start", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46])],
        ["empty", Buffer.alloc(0)],
        ["a PNG signature alone", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
        [
            "a PNG whose first chunk is not IHDR",
            Buffer.concat([
                Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
                pngChunk("tEXt", Buffer.alloc(13)),
                pngChunk("IEND"),
            ]),
        ],
    ])("rejects an image entry that is %s", async (_name, data) => {
        const error = await expectFailure(
            rebuilt(fixtureFile(), { "images/image-bg.png": data }),
            "corrupt-entry",
            /Entry "images\/image-bg.png" is not a PNG file/,
        );
        expect(error.entry).toBe("images/image-bg.png");
    });

    it("rejects an image entry whose PNG does not decode, with the decoder's error as the cause", async () => {
        const good = encodePng(noiseImage(3));
        // A chunk checksum that no longer holds; the zip entry is rebuilt, so its own does.
        const damaged = Buffer.from(good);
        damaged[damaged.length - 20] ^= 0x01;
        const cut = good.subarray(0, 40);
        const short = Buffer.concat([
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
            pngHeaderChunk(WIDTH, HEIGHT),
            good.subarray(33, -12 - 4),
            pngChunk("IEND"),
        ]);
        for (const [png, message] of [
            [damaged, /chunk fails its checksum/],
            [cut, /ends before its IEND chunk|longer than the rest of the file/],
            [short, /is damaged: /],
        ] as const) {
            const error = await expectFailure(
                rebuilt(fixtureFile(), { "images/image-body-a.png": png }),
                "corrupt-entry",
                message,
            );
            expect(error.message).toContain('Entry "images/image-body-a.png" is damaged: ');
            expect(error.entry).toBe("images/image-body-a.png");
            expect(error.cause).toBeInstanceOf(PngError);
        }
    });
});

// --- reference sources --------------------------------------------------------------------------

describe("deserialize: reference sources", () => {
    it("rejects a document whose reference source has no entry, naming it", async () => {
        const error = await expectFailure(
            rebuilt(fixtureFile(), { [`refs/${SOURCE_ID}.png`]: null }),
            "missing-reference",
            /names the source "source-sketch", and the file has no entry "refs\/source-sketch.png"/,
        );
        expect(error.entry).toBe("refs/source-sketch.png");
    });

    it("rejects a reference entry that is not a PNG file", async () => {
        for (const data of [
            Buffer.from("GIF89a, not a PNG"),
            Buffer.alloc(0),
            Buffer.from([137, 80, 78]),
        ]) {
            const error = await expectFailure(
                rebuilt(fixtureFile(), { [`refs/${SOURCE_ID}.png`]: data }),
                "corrupt-entry",
                /Entry "refs\/source-sketch.png" is not a PNG file/,
            );
            expect(error.entry).toBe("refs/source-sketch.png");
        }
    });

    it("keeps a reference PNG of any kind without decoding it", async () => {
        // A header that claims a size no decoder would take: the bytes are kept, not judged.
        const odd = Buffer.concat([
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
            pngHeaderChunk(100_000, 100_000, 16, 2, 1),
            Buffer.from("rest"),
        ]);
        const project = await deserialize(
            rebuilt(fixtureFile(), { [`refs/${SOURCE_ID}.png`]: odd }),
        );
        expect(
            Buffer.compare(Buffer.from(project.referenceSources.get(SOURCE_ID) ?? []), odd),
        ).toBe(0);
    });
});

// --- invariants ---------------------------------------------------------------------------------

const reference = (id: string) => ({ ...fixtureDocJson().layers[0], id, sourceId: `source-${id}` });

/**
 * One file per invariant of SPEC §5.1 that a file can break. The three about images cannot
 * be reached this way: a cel's missing image is "missing-image", a wrong size "image-size",
 * and an image without a cel is an entry that is never read. Those of the session do not
 * apply: a file holds no session.
 */
const violations: [InvariantName, Change[]][] = [
    ["pixel-layer-required", [set("layers", [reference("r1")]), set("cels", [])]],
    [
        "frame-required",
        [set("frames", []), set("cels", []), set("tags", []), set("exportSettings.frames", "all")],
    ],
    [
        "reference-layer-limit",
        [(json) => (json as DocJson).layers.push(...["r2", "r3", "r4", "r5"].map(reference))],
    ],
    // Two layers with one ID; a frame with the ID of a layer; a tag with the document's; an
    // image with a frame's.
    ["unique-ids", [(json) => (json as DocJson).layers.push(fixtureDocJson().layers[1])]],
    ["unique-ids", [(json) => (json as DocJson).frames.push({ id: "layer-bg", durationMs: 9 })]],
    ["unique-ids", [set("tags[1].id", "doc-hero")]],
    ["unique-ids", [set("cels[9].imageId", "frame-2")]],
    ["tag-endpoints-exist", [set("tags[0].fromFrameId", "frame-9")]],
    ["tag-endpoints-exist", [set("tags[1].toFrameId", "layer-bg")]],
    ["tag-order", [set("tags[0].fromFrameId", "frame-3"), set("tags[0].toFrameId", "frame-1")]],
    ["export-frames-tag-exists", [set("exportSettings.frames.tagId", "tag-gone")]],
];

describe("deserialize: invariants of the model", () => {
    it.each(violations)("rejects a document that breaks %s", async (invariant, changes) => {
        const json = changedDocJson(...changes);
        // The unique-ids case with an image needs that image to exist under its new name.
        const file = rebuilt(fixtureFile(), {
            "doc.json": jsonBytes(json),
            "images/frame-2.png": encodePng(noiseImage(13)),
        });
        const error = await failure(file);

        expect(error.code).toBe("invariant");
        expect(error.cause).toBeInstanceOf(InvariantError);
        expect((error.cause as InvariantError).invariant).toBe(invariant);
        expect(error.message).toContain(`Invariant "${invariant}" violated`);
        expect(error.message).toContain(INVARIANTS[invariant]);
        expect(error.message).toMatch(/^The document is not valid\. /);
    });

    it("covers every invariant a file can break", () => {
        const reached = new Set(violations.map(([invariant]) => invariant));
        const unreachable: InvariantName[] = [
            "cel-image-exists",
            "cel-image-size",
            "no-orphan-image",
            "active-layer-exists",
            "active-frame-exists",
            "selection-mask-size",
        ];
        expect([...reached, ...unreachable].sort()).toEqual(Object.keys(INVARIANTS).sort());
    });

    it("checks the invariants before it reads the reference sources", async () => {
        // Five reference layers and not one of their sources in the file.
        const json = changedDocJson((value) => {
            (value as DocJson).layers.push(...["r2", "r3", "r4", "r5"].map(reference));
        });
        const error = await failure(withDocJson(json));
        expect((error.cause as InvariantError).invariant).toBe("reference-layer-limit");
    });
});

describe("deserialize returns a document whole or not at all", () => {
    it("rejects when only the entry it reads last is missing", async () => {
        // Manifest, document and all five images are read and checked before the source.
        const outcome = await deserialize(
            rebuilt(fixtureFile(), { [`refs/${SOURCE_ID}.png`]: null }),
        ).then(
            (project) => project,
            (error: unknown) => error,
        );
        expect(outcome).toBeInstanceOf(ProjectError);
        expect(outcome).not.toHaveProperty("doc");
    });

    it("gives every failure a code of its own", async () => {
        const file = fixtureFile();
        const cases: [ProjectErrorCode, Uint8Array][] = [
            ["not-a-zip", Buffer.from("not a zip")],
            ["unsupported-zip", rebuilt(file, { "doc.json": { flags: 1 } })],
            ["too-large", rebuilt(file, { "doc.json": { size: 0x7fffffff, method: 8 } })],
            ["corrupt-entry", rebuilt(file, { "doc.json": { crc: 1 } })],
            ["missing-manifest", rebuilt(file, { "manifest.json": null })],
            ["invalid-manifest", manifest({ ...MANIFEST, format: "zip" })],
            ["newer-version", manifest({ ...MANIFEST, version: 2 })],
            ["missing-document", rebuilt(file, { "doc.json": null })],
            ["invalid-document", withDocJson(changedDocJson(set("width", 0)))],
            ["missing-image", rebuilt(file, { "images/image-bg.png": null })],
            [
                "image-size",
                rebuilt(file, { "images/image-bg.png": encodePng(noiseImage(1, 8, 8)) }),
            ],
            [
                "image-format",
                rebuilt(file, {
                    "images/image-bg.png": pngFile(WIDTH, HEIGHT, Array(12).fill([1, 2, 3])),
                }),
            ],
            ["missing-reference", rebuilt(file, { [`refs/${SOURCE_ID}.png`]: null })],
            ["invariant", withDocJson(changedDocJson(set("tags[0].toFrameId", "frame-9")))],
        ];
        for (const [code, bytes] of cases) {
            const error = await failure(bytes, code);
            expect(error.code, error.message).toBe(code);
            // A sentence a person can read: it ends with a full stop and is not a stack of codes.
            expect(error.message, code).toMatch(/^[A-Za-z].*\.$/s);
        }
    });
});

// --- serialize refuses what deserialize would -----------------------------------------------------

describe("serialize refuses a document it could not read back", () => {
    const refused = (
        change: (doc: SpriteDoc) => void,
        sources = fixtureSources(),
    ): ProjectError => {
        const doc = fixtureDocument();
        change(doc);
        return thrown(() => serialize(doc, sources));
    };

    it.each<[string, (doc: SpriteDoc) => void, RegExp]>([
        [
            "a layer ID with a space",
            (doc) => void (doc.layers[1].id = "layer 1"),
            /`layers\[1\].id` must be an ID/,
        ],
        [
            "an image ID with a slash",
            (doc) => void (doc.cels.get(celKey("layer-fx", "frame-2"))!.imageId = "a/b"),
            /`cels\[9\].imageId` must be an ID/,
        ],
        [
            "a source ID with a dot",
            (doc) => void ((doc.layers[0] as ReferenceLayer).sourceId = "sketch.png"),
            /`layers\[0\].sourceId` must be an ID/,
        ],
        ["an empty name", (doc) => void (doc.name = "  "), /`name` must not be empty/],
        [
            "a width of 0",
            (doc) => void (doc.width = 0),
            /`width` must be an integer from 1 to 1024/,
        ],
        [
            "a frame duration of 0",
            (doc) => void (doc.frames[0].durationMs = 0),
            /`frames\[0\].durationMs` must be an integer from 1 to 65535/,
        ],
        [
            "a layer opacity of 300",
            (doc) => void (doc.layers[2].opacity = 300),
            /`layers\[2\].opacity` must be an integer from 0 to 255/,
        ],
        [
            "a pivot that is not a number",
            (doc) => void (doc.pivot.x = Number.NaN),
            /`pivot.x` must be a number from 0 to 1, got NaN/,
        ],
        [
            "an infinite reference position",
            (doc) => void ((doc.layers[0] as ReferenceLayer).x = Infinity),
            /`layers\[0\].x` must be a number, got Infinity/,
        ],
        [
            "a reference scale of 0",
            (doc) => void ((doc.layers[0] as ReferenceLayer).scale = 0),
            /`layers\[0\].scale` must be above 0/,
        ],
        [
            "a negative colour",
            (doc) => void (doc.tags[0].color = -1),
            /`tags\[0\].color` must be a colour 0xRRGGBBAA, got -1/,
        ],
        [
            "a colour above 32 bits",
            (doc) => void (doc.palette.colors[1] = 2 ** 32),
            /`palette.colors\[1\]` must be a colour 0xRRGGBBAA, got 4294967296/,
        ],
        [
            "a fractional colour",
            (doc) => void (doc.palette.colors[0] = 0.5),
            /`palette.colors\[0\]` must be a colour 0xRRGGBBAA/,
        ],
        [
            "257 palette colours",
            (doc) => void (doc.palette.colors = Array<number>(257).fill(0xff)),
            /`palette.colors` holds 257 items/,
        ],
        [
            "an unknown blend mode",
            (doc) => void Object.assign(doc.layers[1], { blend: "burn" }),
            /`layers\[1\].blend` must be one of/,
        ],
        [
            "a layer of an unknown kind",
            (doc) => void Object.assign(doc.layers[1], { kind: "group" }),
            /`layers\[1\].kind` must be one of "pixel", "reference"/,
        ],
        [
            "export frames that are neither",
            (doc) => void Object.assign(doc.exportSettings, { frames: null }),
            /`exportSettings.frames` must be "all" or an object/,
        ],
        [
            "a missing setting",
            (doc) => void Object.assign(doc.settings, { tiled: undefined }),
            /`settings.tiled` must be one of .* got nothing/,
        ],
    ])("refuses %s", (_name, change, message) => {
        const error = refused(change);
        expect(`${error.code}: ${error.message}`).toMatch(
            new RegExp(`^invalid-document: doc.json: .*${message.source}`),
        );
    });

    it("refuses more frames or layers than a project holds", () => {
        const frames = refused((doc) => {
            doc.frames = Array.from({ length: 65_536 }, (_, index) => ({
                id: `f${index}`,
                durationMs: 100,
            }));
            doc.cels.clear();
            doc.tags = [];
            doc.exportSettings.frames = "all";
        });
        expect(`${frames.code}: ${frames.message}`).toMatch(
            /invalid-document: .*`frames` holds 65536 items/,
        );

        const layers = refused((doc) => {
            doc.layers = Array.from({ length: 1025 }, (_, index) => ({
                ...doc.layers[1],
                id: `l${index}`,
            }));
            doc.cels.clear();
        });
        expect(`${layers.code}: ${layers.message}`).toMatch(
            /invalid-document: .*`layers` holds 1025 items/,
        );
    });

    it.each<[InvariantName, (doc: SpriteDoc) => void]>([
        [
            "tag-order",
            (doc) =>
                void Object.assign(doc.tags[0], { fromFrameId: "frame-3", toFrameId: "frame-1" }),
        ],
        ["tag-endpoints-exist", (doc) => void (doc.tags[0].toFrameId = "frame-9")],
        [
            "export-frames-tag-exists",
            (doc) => void (doc.exportSettings.frames = { tagId: "tag-gone" }),
        ],
        ["unique-ids", (doc) => void (doc.tags[1].id = "tag-idle")],
        [
            "reference-layer-limit",
            (doc) =>
                void doc.layers.push(
                    ...[1, 2, 3, 4].map((n) => ({ ...doc.layers[0], id: `r${n}` })),
                ),
        ],
        ["pixel-layer-required", (doc) => void (doc.layers = [doc.layers[0]])],
        [
            "frame-required",
            (doc) => void ((doc.frames = []), (doc.tags = []), (doc.exportSettings.frames = "all")),
        ],
    ])("refuses a document that breaks %s", (invariant, change) => {
        const error = refused(change);
        expect(error.code).toBe("invariant");
        expect((error.cause as InvariantError).invariant).toBe(invariant);
    });

    it("refuses a cel whose image is missing or has another size", () => {
        const missing = refused((doc) => void doc.images.delete("image-body-b"));
        expect(missing.code).toBe("missing-image");
        expect(missing.message).toMatch(/names the image "image-body-b", which is missing/);

        const sized = refused(
            (doc) => void doc.images.set("image-bg", noiseImage(1, WIDTH, HEIGHT + 1)),
        );
        expect(sized.code).toBe("image-size");
        expect(sized.message).toMatch(
            /The image "image-bg" is 4×4 pixels with 64 bytes; the document is 4×3/,
        );

        const short = refused((doc) => {
            const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4 - 4);
            doc.images.set("image-bg", { width: WIDTH, height: HEIGHT, data });
        });
        expect(short.code).toBe("image-size");
    });

    it("refuses a reference layer without its source, or with a source that is not a PNG file", () => {
        const none = refused(() => undefined, new Map());
        expect(none.code).toBe("missing-reference");
        expect(none.message).toMatch(
            /names the source "source-sketch", and its bytes were not given/,
        );
        expect(none.entry).toBe("refs/source-sketch.png");

        const jpeg = new Map([[SOURCE_ID, Uint8Array.of(0xff, 0xd8, 0xff, 0xe0)]]);
        const wrong = refused(() => undefined, jpeg);
        expect(wrong.code).toBe("corrupt-entry");
        expect(wrong.message).toMatch(/The reference source "source-sketch" is not a PNG file/);
    });

    it("refuses a reference source above 64 MiB", () => {
        const large = new Uint8Array(MAX_REFERENCE_SOURCE_BYTES + 1);
        large.set([137, 80, 78, 71, 13, 10, 26, 10]);
        const error = refused(() => undefined, new Map([[SOURCE_ID, large]]));

        expect(error.code).toBe("too-large");
        expect(error.message).toMatch(
            /"refs\/source-sketch.png" would hold 67108865 bytes; the limit is 67108864 bytes/,
        );
    });

    it("refuses more than 1 GiB of pixel data", () => {
        // 257 images of 1024 × 1024 pixels. They are one buffer under 257 names: the count
        // is what is checked, before any of them is encoded.
        const { doc } = createDocument({ name: "large", width: 1024, height: 1024 });
        const image: PixelBuffer = {
            width: 1024,
            height: 1024,
            data: new Uint8ClampedArray(1024 * 1024 * 4),
        };
        const layer = doc.layers[0].id;
        doc.frames = Array.from({ length: 257 }, (_, index) => ({
            id: `f${index}`,
            durationMs: 100,
        }));
        doc.frames.forEach((frame, index) => {
            doc.images.set(`i${index}`, image);
            doc.cels.set(celKey(layer, frame.id), { imageId: `i${index}`, opacity: 255 });
        });

        const error = thrown(() => serialize(doc, new Map()));
        expect(error.code).toBe("too-large");
        expect(error.message).toMatch(
            /257 images of 1024×1024 pixels, 1077936128 bytes of pixel data/,
        );
    });

    it("refuses more entries than a zip archive counts", () => {
        // Two layers of 32 767 frames, every cel with an image of its own: 65 534 images.
        const { doc } = createDocument({ name: "many", width: 1, height: 1 });
        const image: PixelBuffer = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
        doc.layers.push({ ...doc.layers[0], id: "second" });
        doc.frames = Array.from({ length: 32_767 }, (_, index) => ({
            id: `f${index}`,
            durationMs: 100,
        }));
        for (const layer of doc.layers) {
            doc.frames.forEach((frame, index) => {
                const imageId = `${layer.id === "second" ? "b" : "a"}${index}`;
                doc.images.set(imageId, image);
                doc.cels.set(celKey(layer.id, frame.id), { imageId, opacity: 255 });
            });
        }
        expect(MAX_PROJECT_ENTRIES).toBe(65_535);

        const error = thrown(() => serialize(doc, new Map()));
        expect(error.code).toBe("too-large");
        expect(error.message).toMatch(/would have 65537 entries; the limit is 65535/);
    });

    it("refuses a document whose doc.json would exceed 16 MiB", () => {
        // 150 layers of 1000 frames, every cel linked to one image: 150 000 cels.
        const { doc } = createDocument({ name: "long", width: 1, height: 1 });
        doc.images.set("image", { width: 1, height: 1, data: new Uint8ClampedArray(4) });
        doc.layers = Array.from({ length: 150 }, (_, index) => ({
            ...doc.layers[0],
            id: `layer-${index}`,
        }));
        doc.frames = Array.from({ length: 1000 }, (_, index) => ({
            id: `frame-${index}`,
            durationMs: 100,
        }));
        for (const layer of doc.layers) {
            for (const frame of doc.frames) {
                doc.cels.set(celKey(layer.id, frame.id), { imageId: "image", opacity: 255 });
            }
        }

        const error = thrown(() => serialize(doc, new Map()));
        expect(error.code).toBe("too-large");
        expect(error.message).toMatch(
            /"doc.json" would hold \d+ bytes; the limit is 16777216 bytes/,
        );
        expect(error.entry).toBe("doc.json");
    });
});

// --- docFromJson ----------------------------------------------------------------------------------

describe("docFromJson", () => {
    const images = () => fixtureDocument().images;

    it("makes the checks of deserialize on the JSON, the images and the invariants", () => {
        const invalidJson = thrown(() => docFromJson(changedDocJson(set("height", 0)), images()));
        expect(invalidJson.code).toBe("invalid-document");

        const missing = thrown(() => docFromJson(fixtureDocJson(), new Map()));
        expect(missing.code).toBe("missing-image");
        expect(missing.message).toMatch(/names the image "image-bg", which is missing/);

        const sized = thrown(() =>
            docFromJson(
                fixtureDocJson(),
                new Map([...images(), ["image-fx", noiseImage(1, 2, 2)]]),
            ),
        );
        expect(sized.code).toBe("image-size");

        const broken = thrown(() =>
            docFromJson(changedDocJson(set("exportSettings.frames.tagId", "tag-gone")), images()),
        );
        expect(broken.code).toBe("invariant");
    });

    it("takes the schema version of the JSON and refuses one it cannot read", () => {
        expect(docFromJson(fixtureDocJson(), images(), 1)).toEqual(fixtureDocument());

        const newer = thrown(() => docFromJson(fixtureDocJson(), images(), 2));
        expect(newer.code).toBe("newer-version");
        for (const version of [0, -1, 1.5, Number.NaN]) {
            expect(thrown(() => docFromJson(fixtureDocJson(), images(), version)).code).toBe(
                "invalid-manifest",
            );
        }
    });

    it("the small document of these tests is a project too", async () => {
        const doc = smallDocument();
        expect((await deserialize(serialize(doc, new Map()))).doc).toEqual(doc);
    });
});
