import { MAX_CEL_OPACITY, MIN_CEL_OPACITY } from "../cels";
import { MAX_FRAME_DURATION_MS, MIN_FRAME_DURATION_MS } from "../frames";
import { InvariantError, assertInvariants, celKey } from "../model";
import type {
    BlendMode,
    Cel,
    DocSettings,
    ExportSettings,
    FrameInfo,
    Layer,
    PixelBuffer,
    ReferenceLayer,
    SpriteDoc,
    Tag,
} from "../model";
import { createPixelBuffer } from "../pixels";
import { MAX_TAG_REPEAT } from "../tags";
import { ProjectError, quoted } from "./errors";
import {
    DOC_ENTRY,
    MAX_PROJECT_CELS,
    MAX_PROJECT_FRAMES,
    MAX_PROJECT_IMAGES,
    MAX_PROJECT_LAYERS,
    MAX_PROJECT_PALETTE_COLORS,
    MAX_PROJECT_PIXEL_BYTES,
    MAX_PROJECT_TAGS,
    MAX_REFERENCE_OFFSET,
    MAX_REFERENCE_SCALE,
    MIN_REFERENCE_SCALE,
    PROJECT_VERSION,
} from "./format";
import { JsonReader, namesOf } from "./json";
import { migrateDocJson } from "./migrations";

// `doc.json` to document. A parsed `doc.json` is checked field by field against schema
// version 1 (docs/FORMAT.md) while the document is built from it: exactly the fields of the
// schema, each of its type and inside its range, every ID well-formed and every cel on a
// pixel layer and a frame that exist. The invariants of SPEC §5.1 are checked next, by the
// model's own `assertInvariants`, and only then does the document get its images: nothing
// that can be refused without pixels waits for them to be decoded.

// The annotation lets the compiler see that `reader.fail` never returns.
const reader: JsonReader = new JsonReader("invalid-document", DOC_ENTRY);

// --- value ranges of schema version 1 -----------------------------------------------------------
// The duration of a frame, the opacity of a cel and the repeat count of a tag have their
// bounds where their commands are (`core/frames`, `core/cels`, `core/tags`): one source each.

/** Longest side of a document and of a grid cell, in pixels. */
const MAX_SIDE = 1024;
/** Largest grid offset in either direction, in pixels. */
const MAX_GRID_OFFSET = 1024;
/** Most onion-skin frames on either side. */
const MAX_ONION_FRAMES = 3;
/** A symmetry axis counts half pixels from the left or top edge of the largest canvas. */
const MAX_SYMMETRY_AXIS = 2 * MAX_SIDE;
const MAX_EXPORT_PADDING = 8;
const MAX_EXPORT_EXTRUDE = 2;

const COLOR_MODES = namesOf<SpriteDoc["colorMode"]>({ rgba: true });
const LAYER_KINDS = namesOf<Layer["kind"]>({ pixel: true, reference: true });
const BLEND_MODES = namesOf<BlendMode>({
    normal: true,
    multiply: true,
    screen: true,
    overlay: true,
    darken: true,
    lighten: true,
    "color-dodge": true,
    "color-burn": true,
    "hard-light": true,
    "soft-light": true,
    difference: true,
    exclusion: true,
    hue: true,
    saturation: true,
    color: true,
    luminosity: true,
    addition: true,
    subtract: true,
    divide: true,
});
const PLACEMENTS = namesOf<ReferenceLayer["placement"]>({ behind: true, front: true });
const DIRECTIONS = namesOf<Tag["direction"]>({ forward: true, reverse: true, pingpong: true });
const AXES = namesOf<DocSettings["tiled"]>({ none: true, x: true, y: true, both: true });
const LAYOUTS = namesOf<ExportSettings["layout"]>({ grid: true, row: true, column: true });
const ASEPRITE_JSON = namesOf<ExportSettings["files"]["asepriteJson"]>({
    none: true,
    array: true,
    hash: true,
});

// --- fields -------------------------------------------------------------------------------------

function readLayer(value: unknown, path: string): Layer {
    // `kind` decides which fields the layer has, so it is read before they are checked.
    const kind = reader.oneOf(reader.record(value, path).kind, `${path}.kind`, LAYER_KINDS);
    return kind === "pixel" ? readPixelLayer(value, path) : readReferenceLayer(value, path);
}

const LAYER_KEYS = ["id", "kind", "name", "visible", "locked", "opacity"] as const;

function readPixelLayer(value: unknown, path: string): Layer {
    const fields = reader.object(value, path, [...LAYER_KEYS, "blend"]);
    return {
        id: reader.id(fields.id, `${path}.id`),
        kind: "pixel",
        name: reader.string(fields.name, `${path}.name`),
        visible: reader.boolean(fields.visible, `${path}.visible`),
        locked: reader.boolean(fields.locked, `${path}.locked`),
        opacity: reader.integer(fields.opacity, `${path}.opacity`, 0, 255),
        blend: reader.oneOf(fields.blend, `${path}.blend`, BLEND_MODES),
    };
}

function readReferenceLayer(value: unknown, path: string): Layer {
    const fields = reader.object(value, path, [
        ...LAYER_KEYS,
        "sourceId",
        "x",
        "y",
        "scale",
        "placement",
    ]);
    const offset = (field: "x" | "y") =>
        reader.number(
            fields[field],
            `${path}.${field}`,
            -MAX_REFERENCE_OFFSET,
            MAX_REFERENCE_OFFSET,
        );
    return {
        id: reader.id(fields.id, `${path}.id`),
        kind: "reference",
        name: reader.string(fields.name, `${path}.name`),
        visible: reader.boolean(fields.visible, `${path}.visible`),
        locked: reader.boolean(fields.locked, `${path}.locked`),
        opacity: reader.integer(fields.opacity, `${path}.opacity`, 0, 255),
        sourceId: reader.id(fields.sourceId, `${path}.sourceId`),
        x: offset("x"),
        y: offset("y"),
        // Bounded on both sides: nothing computed from it, or from its inverse, overflows.
        scale: reader.number(
            fields.scale,
            `${path}.scale`,
            MIN_REFERENCE_SCALE,
            MAX_REFERENCE_SCALE,
        ),
        placement: reader.oneOf(fields.placement, `${path}.placement`, PLACEMENTS),
    };
}

function readFrame(value: unknown, path: string): FrameInfo {
    const fields = reader.object(value, path, ["id", "durationMs"]);
    return {
        id: reader.id(fields.id, `${path}.id`),
        durationMs: reader.integer(
            fields.durationMs,
            `${path}.durationMs`,
            MIN_FRAME_DURATION_MS,
            MAX_FRAME_DURATION_MS,
        ),
    };
}

/**
 * The IDs that name the archive entries of one kind, each once, in the order they were
 * added. Two of them must not differ only in the case of their letters: the entries can then
 * be unpacked to a file system that ignores case.
 */
class EntryIds {
    /** The spelling of each ID, by the ID in lowercase. */
    readonly #spelled = new Map<string, string>();

    /** Adds the ID read at `path`, unless it is there already. */
    add(id: string, path: string): void {
        const other = this.#spelled.get(id.toLowerCase());
        if (other === undefined) this.#spelled.set(id.toLowerCase(), id);
        else if (other !== id) {
            reader.fail(
                path,
                `differs from the ID ${quoted(other)} only in the case of its letters: ` +
                    quoted(id),
            );
        }
    }

    get size(): number {
        return this.#spelled.size;
    }

    list(): string[] {
        return [...this.#spelled.values()];
    }
}

/**
 * The cels by their key, and the images they name, each once, in the order of their first
 * cel. A cel sits on a pixel layer and a frame of the document, and no two share both.
 */
function readCels(
    value: unknown,
    layers: readonly Layer[],
    frames: readonly FrameInfo[],
): { cels: Map<string, Cel>; imageIds: string[] } {
    const pixelLayerIds = new Set(
        layers.filter((layer) => layer.kind === "pixel").map((layer) => layer.id),
    );
    const frameIds = new Set(frames.map((frame) => frame.id));
    const cels = new Map<string, Cel>();
    const imageIds = new EntryIds();
    reader.array(value, "cels", MAX_PROJECT_CELS).forEach((item, index) => {
        const path = `cels[${index}]`;
        const fields = reader.object(item, path, ["layerId", "frameId", "imageId", "opacity"]);
        const layerId = reader.id(fields.layerId, `${path}.layerId`);
        const frameId = reader.id(fields.frameId, `${path}.frameId`);
        if (!pixelLayerIds.has(layerId)) {
            reader.fail(`${path}.layerId`, `names no pixel layer: ${quoted(layerId)}`);
        }
        if (!frameIds.has(frameId)) {
            reader.fail(`${path}.frameId`, `names no frame: ${quoted(frameId)}`);
        }
        const key = celKey(layerId, frameId);
        if (cels.has(key)) {
            reader.fail(
                path,
                `is a second cel of layer ${quoted(layerId)} at frame ${quoted(frameId)}`,
            );
        }
        const imageId = reader.id(fields.imageId, `${path}.imageId`);
        imageIds.add(imageId, `${path}.imageId`);
        if (imageIds.size > MAX_PROJECT_IMAGES) {
            reader.fail(
                "cels",
                `names more than ${MAX_PROJECT_IMAGES} images; cels beyond that share images`,
            );
        }
        cels.set(key, {
            imageId,
            opacity: reader.integer(
                fields.opacity,
                `${path}.opacity`,
                MIN_CEL_OPACITY,
                MAX_CEL_OPACITY,
            ),
        });
    });
    return { cels, imageIds: imageIds.list() };
}

function readTag(value: unknown, path: string): Tag {
    const fields = reader.object(value, path, [
        "id",
        "name",
        "color",
        "fromFrameId",
        "toFrameId",
        "direction",
        "repeat",
    ]);
    return {
        id: reader.id(fields.id, `${path}.id`),
        name: reader.string(fields.name, `${path}.name`),
        color: reader.color(fields.color, `${path}.color`),
        fromFrameId: reader.id(fields.fromFrameId, `${path}.fromFrameId`),
        toFrameId: reader.id(fields.toFrameId, `${path}.toFrameId`),
        direction: reader.oneOf(fields.direction, `${path}.direction`, DIRECTIONS),
        repeat: reader.integer(fields.repeat, `${path}.repeat`, 0, MAX_TAG_REPEAT),
    };
}

function readPalette(value: unknown): SpriteDoc["palette"] {
    const fields = reader.object(value, "palette", ["name", "colors"]);
    return {
        name: reader.string(fields.name, "palette.name"),
        colors: reader
            .array(fields.colors, "palette.colors", MAX_PROJECT_PALETTE_COLORS)
            .map((color, index) => reader.color(color, `palette.colors[${index}]`)),
    };
}

function readPivot(value: unknown): SpriteDoc["pivot"] {
    const fields = reader.object(value, "pivot", ["x", "y"]);
    return {
        x: reader.number(fields.x, "pivot.x", 0, 1),
        y: reader.number(fields.y, "pivot.y", 0, 1),
    };
}

function readSettings(value: unknown): DocSettings {
    const fields = reader.object(value, "settings", [
        "grid",
        "pixelGrid",
        "onion",
        "symmetry",
        "tiled",
    ]);
    const grid = reader.object(fields.grid, "settings.grid", [
        "width",
        "height",
        "offsetX",
        "offsetY",
        "visible",
    ]);
    const onion = reader.object(fields.onion, "settings.onion", [
        "enabled",
        "before",
        "after",
        "opacity",
        "falloff",
        "tint",
        "placement",
        "withinTag",
    ]);
    const symmetry = reader.object(fields.symmetry, "settings.symmetry", [
        "mode",
        "axisX",
        "axisY",
    ]);
    const offset = (field: "offsetX" | "offsetY") =>
        reader.integer(grid[field], `settings.grid.${field}`, -MAX_GRID_OFFSET, MAX_GRID_OFFSET);
    const axis = (field: "axisX" | "axisY") =>
        reader.integer(symmetry[field], `settings.symmetry.${field}`, 0, MAX_SYMMETRY_AXIS);
    return {
        grid: {
            width: reader.integer(grid.width, "settings.grid.width", 1, MAX_SIDE),
            height: reader.integer(grid.height, "settings.grid.height", 1, MAX_SIDE),
            offsetX: offset("offsetX"),
            offsetY: offset("offsetY"),
            visible: reader.boolean(grid.visible, "settings.grid.visible"),
        },
        pixelGrid: reader.boolean(fields.pixelGrid, "settings.pixelGrid"),
        onion: {
            enabled: reader.boolean(onion.enabled, "settings.onion.enabled"),
            before: reader.integer(onion.before, "settings.onion.before", 0, MAX_ONION_FRAMES),
            after: reader.integer(onion.after, "settings.onion.after", 0, MAX_ONION_FRAMES),
            opacity: reader.integer(onion.opacity, "settings.onion.opacity", 0, 255),
            falloff: reader.number(onion.falloff, "settings.onion.falloff", 0, 1),
            tint: reader.boolean(onion.tint, "settings.onion.tint"),
            placement: reader.oneOf(onion.placement, "settings.onion.placement", PLACEMENTS),
            withinTag: reader.boolean(onion.withinTag, "settings.onion.withinTag"),
        },
        symmetry: {
            mode: reader.oneOf(symmetry.mode, "settings.symmetry.mode", AXES),
            axisX: axis("axisX"),
            axisY: axis("axisY"),
        },
        tiled: reader.oneOf(fields.tiled, "settings.tiled", AXES),
    };
}

function readExportFrames(value: unknown): ExportSettings["frames"] {
    const path = "exportSettings.frames";
    if (value === "all") return value;
    if (typeof value !== "object" || value === null) {
        reader.fail(path, 'must be "all" or an object with the field `tagId`');
    }
    return { tagId: reader.id(reader.object(value, path, ["tagId"]).tagId, `${path}.tagId`) };
}

function readExportSettings(value: unknown): ExportSettings {
    const path = "exportSettings";
    const fields = reader.object(value, path, [
        "layout",
        "padding",
        "extrude",
        "trim",
        "mergeDuplicates",
        "frames",
        "files",
        "exportOnSave",
    ]);
    const files = reader.object(fields.files, `${path}.files`, [
        "spritesTs",
        "previewConfig",
        "asepriteJson",
    ]);
    return {
        layout: reader.oneOf(fields.layout, `${path}.layout`, LAYOUTS),
        padding: reader.integer(fields.padding, `${path}.padding`, 0, MAX_EXPORT_PADDING),
        extrude: reader.integer(fields.extrude, `${path}.extrude`, 0, MAX_EXPORT_EXTRUDE),
        trim: reader.boolean(fields.trim, `${path}.trim`),
        mergeDuplicates: reader.boolean(fields.mergeDuplicates, `${path}.mergeDuplicates`),
        frames: readExportFrames(fields.frames),
        files: {
            spritesTs: reader.boolean(files.spritesTs, `${path}.files.spritesTs`),
            previewConfig: reader.boolean(files.previewConfig, `${path}.files.previewConfig`),
            asepriteJson: reader.oneOf(
                files.asepriteJson,
                `${path}.files.asepriteJson`,
                ASEPRITE_JSON,
            ),
        },
        exportOnSave: reader.boolean(fields.exportOnSave, `${path}.exportOnSave`),
    };
}

// --- document -----------------------------------------------------------------------------------

/** A document read from `doc.json`, before it has its images. */
export interface DocSkeleton {
    /** Complete except for `images`, which is empty. */
    doc: SpriteDoc;
    /** The images the cels name, each once, in the order of their first cel. */
    imageIds: string[];
}

/**
 * Checks a parsed `doc.json` of schema version 1 and builds the document from it. Throws
 * `ProjectError` "invalid-document"; the message names the field.
 */
export function readDocJson(value: unknown): DocSkeleton {
    const fields = reader.object(value, "", [
        "id",
        "name",
        "width",
        "height",
        "colorMode",
        "layers",
        "frames",
        "cels",
        "tags",
        "palette",
        "pivot",
        "settings",
        "exportSettings",
    ]);
    const name = reader.string(fields.name, "name");
    if (name.trim() === "") reader.fail("name", "must not be empty or only white space");
    const layers = reader
        .array(fields.layers, "layers", MAX_PROJECT_LAYERS)
        .map((layer, index) => readLayer(layer, `layers[${index}]`));
    const sourceIds = new EntryIds();
    layers.forEach((layer, index) => {
        if (layer.kind === "reference") sourceIds.add(layer.sourceId, `layers[${index}].sourceId`);
    });
    const frames = reader
        .array(fields.frames, "frames", MAX_PROJECT_FRAMES)
        .map((frame, index) => readFrame(frame, `frames[${index}]`));
    const { cels, imageIds } = readCels(fields.cels, layers, frames);
    const doc: SpriteDoc = {
        id: reader.id(fields.id, "id"),
        name,
        width: reader.integer(fields.width, "width", 1, MAX_SIDE),
        height: reader.integer(fields.height, "height", 1, MAX_SIDE),
        colorMode: reader.oneOf(fields.colorMode, "colorMode", COLOR_MODES),
        layers,
        frames,
        cels,
        images: new Map(),
        tags: reader
            .array(fields.tags, "tags", MAX_PROJECT_TAGS)
            .map((tag, index) => readTag(tag, `tags[${index}]`)),
        palette: readPalette(fields.palette),
        pivot: readPivot(fields.pivot),
        settings: readSettings(fields.settings),
        exportSettings: readExportSettings(fields.exportSettings),
    };
    return { doc, imageIds };
}

/**
 * Throws `ProjectError` "too-large" when `imageCount` images of the document's size hold
 * more pixel data than a project may. Asked before the images are decoded.
 */
export function assertPixelBytes(doc: SpriteDoc, imageCount: number): void {
    const bytes = imageCount * doc.width * doc.height * 4;
    if (bytes > MAX_PROJECT_PIXEL_BYTES) {
        throw new ProjectError(
            "too-large",
            `The document has ${imageCount} images of ${doc.width}×${doc.height} pixels, ` +
                `${bytes} bytes of pixel data; the limit is ${MAX_PROJECT_PIXEL_BYTES} bytes.`,
        );
    }
}

/**
 * Gives the document the images its cels name, taken from `images` as they are (not copied).
 * Throws `ProjectError`: "missing-image" when `images` lacks one, "image-size" when one does
 * not have the document's size.
 */
export function attachImages(
    skeleton: DocSkeleton,
    images: ReadonlyMap<string, PixelBuffer>,
): void {
    const { doc, imageIds } = skeleton;
    for (const imageId of imageIds) {
        const image = images.get(imageId);
        if (!image) {
            throw new ProjectError(
                "missing-image",
                `A cel of the document names the image ${quoted(imageId)}, which is missing.`,
            );
        }
        const { width, height, data } = image;
        if (
            width !== doc.width ||
            height !== doc.height ||
            data.length !== doc.width * doc.height * 4
        ) {
            throw new ProjectError(
                "image-size",
                `The image ${quoted(imageId)} is ${width}×${height} pixels with ` +
                    `${data.length} bytes; the document is ${doc.width}×${doc.height}.`,
            );
        }
        doc.images.set(imageId, image);
    }
}

/**
 * The two invariants of SPEC §5.1 about the range of a tag, "tag-endpoints-exist" and
 * "tag-order", with the model's own error. Called once the frame IDs are known to be
 * distinct. `assertInvariants` finds each endpoint by walking the frame list, which is
 * tags × frames comparisons of IDs: many seconds for a file at the limits of both, with IDs
 * of full length. Here the frames are looked up, and the work is their sum.
 */
function assertTagRanges(doc: SpriteDoc): void {
    const indexOf = new Map(doc.frames.map((frame, index) => [frame.id, index] as const));
    for (const tag of doc.tags) {
        const from = indexOf.get(tag.fromFrameId);
        const to = indexOf.get(tag.toFrameId);
        if (from === undefined || to === undefined) {
            const missing = from === undefined ? tag.fromFrameId : tag.toFrameId;
            throw new InvariantError(
                "tag-endpoints-exist",
                `tag "${tag.id}" names frame "${missing}"`,
            );
        }
        if (from > to) {
            throw new InvariantError(
                "tag-order",
                `tag "${tag.id}" runs from frame index ${from} to ${to}`,
            );
        }
    }
}

/**
 * Checks the invariants of SPEC §5.1 with the model's `assertInvariants`, on a document that
 * has no image yet: before a pixel is decoded. One blank image of the document's size stands
 * in for every image the cels name, since the invariants ask whether a cel's image exists
 * and what size it has, never what it shows. `attachImages` then puts an image of that size
 * under each of those IDs and no other, so what holds here holds for the finished document.
 *
 * The model is shown every tag with its range set to the first frame, and the ranges are
 * checked by `assertTagRanges`: the same two invariants, in time a file cannot stretch.
 *
 * Throws `ProjectError` "invariant" whose `cause` is the `InvariantError`.
 */
export function assertSkeleton(skeleton: DocSkeleton): void {
    const { doc, imageIds } = skeleton;
    const blank = createPixelBuffer(doc.width, doc.height);
    for (const imageId of imageIds) doc.images.set(imageId, blank);
    try {
        const first = doc.frames[0]?.id ?? "";
        const tags = doc.tags.map((tag) => ({ ...tag, fromFrameId: first, toFrameId: first }));
        // The session part of the check cannot fail: without a first layer or a first frame
        // the document's own invariants fail before it.
        assertInvariants({
            doc: { ...doc, tags },
            selection: null,
            activeLayerId: doc.layers[0]?.id ?? "",
            activeFrameId: first,
        });
        assertTagRanges(doc);
    } catch (cause) {
        if (!(cause instanceof InvariantError)) throw cause;
        throw new ProjectError("invariant", `The document is not valid. ${cause.message}.`, {
            cause,
        });
    } finally {
        doc.images.clear();
    }
}

/** The sources the reference layers name, each once, in layer order. */
export function referenceSourceIds(doc: SpriteDoc): string[] {
    const sourceIds = new Set<string>();
    for (const layer of doc.layers) {
        if (layer.kind === "reference") sourceIds.add(layer.sourceId);
    }
    return [...sourceIds];
}

/**
 * The document of a parsed `doc.json` of the current schema version with its images, after
 * every check, in the order `deserialize` makes them: `readDocJson`, `assertSkeleton`,
 * `attachImages`.
 */
export function checkedDocument(
    docJson: unknown,
    images: ReadonlyMap<string, PixelBuffer>,
): SpriteDoc {
    const skeleton = readDocJson(docJson);
    assertSkeleton(skeleton);
    attachImages(skeleton, images);
    return skeleton.doc;
}

/**
 * The document of a parsed `doc.json` (the inverse of `docToJson`) with its images taken from
 * `images` by image ID. The buffers become the document's images as they are, not copies;
 * entries of `images` that no cel names are left out. `version` is the schema version the
 * JSON was written with: an older one is migrated first.
 *
 * Nothing of the result is taken on trust. Throws `ProjectError`: "invalid-document" when the
 * JSON breaks the schema, "missing-image" and "image-size" for the images, "invariant" when
 * the document breaks an invariant of SPEC §5.1, and "newer-version" or "invalid-manifest"
 * for a `version` this code does not read. No document is returned then.
 */
export function docFromJson(
    docJson: unknown,
    images: ReadonlyMap<string, PixelBuffer>,
    version: number = PROJECT_VERSION,
): SpriteDoc {
    return checkedDocument(migrateDocJson(docJson, version), images);
}
