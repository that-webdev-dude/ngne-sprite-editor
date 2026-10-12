import { celKey } from "../model";
import type { DocSettings, ExportSettings, Layer, SpriteDoc, Tag } from "../model";
import { DOC_ENTRY } from "./format";
import { JsonReader } from "./json";
import type {
    CelJson,
    DocJson,
    DocSettingsJson,
    ExportSettingsJson,
    LayerJson,
    TagJson,
} from "./schema";

// Document to `doc.json`. Every object is built field by field, in the order of
// docs/FORMAT.md, so the text of the entry depends on the document's values alone: not on the
// order in which its maps were filled, and not on a field the format does not know.

/** `#rrggbbaa` of the colour 0xRRGGBBAA. */
function colorJson(color: number, path: string): string {
    if (!Number.isInteger(color) || color < 0 || color > 0xffffffff) {
        new JsonReader("invalid-document", DOC_ENTRY).fail(
            path,
            `must be a colour 0xRRGGBBAA, got ${color}`,
        );
    }
    return `#${color.toString(16).padStart(8, "0")}`;
}

function layerJson(layer: Layer): LayerJson {
    const { id, name, visible, locked, opacity } = layer;
    if (layer.kind === "pixel") {
        return { id, kind: layer.kind, name, visible, locked, opacity, blend: layer.blend };
    }
    const { sourceId, x, y, scale, placement } = layer;
    return {
        id,
        kind: layer.kind,
        name,
        visible,
        locked,
        opacity,
        sourceId,
        x,
        y,
        scale,
        placement,
    };
}

/**
 * The cels of the pixel layers at the document's frames: by layer, bottom to top, then by
 * frame. An entry of `doc.cels` whose key names no such layer and frame is unreachable (no
 * composite and no command finds it) and is left out.
 *
 * The work grows with the number of cels, not with layers × frames: a document may have
 * 1024 layers and 65 535 frames and hardly a cel.
 */
function celsJson(doc: SpriteDoc): CelJson[] {
    const layerIndex = new Map<string, number>();
    doc.layers.forEach((layer, index) => {
        if (layer.kind === "pixel") layerIndex.set(layer.id, index);
    });
    const frameIndex = new Map(doc.frames.map((frame, index) => [frame.id, index] as const));
    const found: { layer: number; frame: number; cel: CelJson }[] = [];
    for (const [key, { imageId, opacity }] of doc.cels) {
        // A key is `celKey(layerId, frameId)`: the two IDs around a colon, which no ID has.
        const colon = key.indexOf(":");
        const layerId = key.slice(0, Math.max(colon, 0));
        const frameId = key.slice(colon + 1);
        const layer = layerIndex.get(layerId);
        const frame = frameIndex.get(frameId);
        if (layer === undefined || frame === undefined || celKey(layerId, frameId) !== key) {
            continue;
        }
        found.push({ layer, frame, cel: { layerId, frameId, imageId, opacity } });
    }
    found.sort((a, b) => a.layer - b.layer || a.frame - b.frame);
    return found.map(({ cel }) => cel);
}

function tagJson(tag: Tag, index: number): TagJson {
    const { id, name, fromFrameId, toFrameId, direction, repeat } = tag;
    const color = colorJson(tag.color, `tags[${index}].color`);
    return { id, name, color, fromFrameId, toFrameId, direction, repeat };
}

function settingsJson(settings: DocSettings): DocSettingsJson {
    const { grid, onion, symmetry } = settings;
    return {
        grid: {
            width: grid.width,
            height: grid.height,
            offsetX: grid.offsetX,
            offsetY: grid.offsetY,
            visible: grid.visible,
        },
        pixelGrid: settings.pixelGrid,
        onion: {
            enabled: onion.enabled,
            before: onion.before,
            after: onion.after,
            opacity: onion.opacity,
            falloff: onion.falloff,
            tint: onion.tint,
            placement: onion.placement,
            withinTag: onion.withinTag,
        },
        symmetry: { mode: symmetry.mode, axisX: symmetry.axisX, axisY: symmetry.axisY },
        tiled: settings.tiled,
    };
}

function exportSettingsJson(settings: ExportSettings): ExportSettingsJson {
    const { frames, files } = settings;
    return {
        layout: settings.layout,
        padding: settings.padding,
        extrude: settings.extrude,
        trim: settings.trim,
        mergeDuplicates: settings.mergeDuplicates,
        frames: typeof frames === "object" && frames !== null ? { tagId: frames.tagId } : frames,
        files: {
            spritesTs: files.spritesTs,
            previewConfig: files.previewConfig,
            asepriteJson: files.asepriteJson,
        },
        exportOnSave: settings.exportOnSave,
    };
}

/**
 * The content of `doc.json` for a document (docs/FORMAT.md): everything of SPEC §5.1 but the
 * pixels, as plain JSON values that share nothing with the document. Session state is not
 * part of it. Equal documents give equal JSON, whatever the order of their maps.
 *
 * The values are copied, not checked; `docFromJson` and `serialize` check them. Throws
 * `ProjectError` "invalid-document" only for a colour that is not a number 0xRRGGBBAA,
 * which has no JSON form.
 */
export function docToJson(doc: SpriteDoc): DocJson {
    return {
        id: doc.id,
        name: doc.name,
        width: doc.width,
        height: doc.height,
        colorMode: doc.colorMode,
        layers: doc.layers.map(layerJson),
        frames: doc.frames.map(({ id, durationMs }) => ({ id, durationMs })),
        cels: celsJson(doc),
        tags: doc.tags.map(tagJson),
        palette: {
            name: doc.palette.name,
            colors: doc.palette.colors.map((color, index) =>
                colorJson(color, `palette.colors[${index}]`),
            ),
        },
        pivot: { x: doc.pivot.x, y: doc.pivot.y },
        settings: settingsJson(doc.settings),
        exportSettings: exportSettingsJson(doc.exportSettings),
    };
}
