import { compositeFrame } from "../composite";
import type { ExportSettings, SpriteDoc } from "../model";
import type { PixelBuffer } from "../pixels";
import { encodePng } from "../png";
import { atlasOfPlan } from "./atlasFor";
import type { AtlasMeta } from "./atlasFormat";
import { ExportError } from "./errors";
import { planExport } from "./exportPlan";
import { spritesModuleText } from "./spritesModule";
import { asepriteJsonText, atlasJsonText, previewConfigText } from "./writers";

/** One file of a bundle. */
export interface BundleFile {
    /** File name without a folder: `<name>` and the file's ending (SPEC §9.1). */
    name: string;
    /** The whole file. */
    bytes: Uint8Array<ArrayBuffer>;
}

export interface Bundle {
    /** The files in the order of SPEC §9.1; the optional ones only when switched on. */
    files: BundleFile[];
    /** The pixels of `<name>.png`. */
    atlas: PixelBuffer;
    /** The content of `<name>.atlas.json`. */
    meta: AtlasMeta;
}

const ASEPRITE_FORMS: readonly string[] = ["none", "array", "hash"];

/**
 * The NGNE bundle of a document (SPEC §9.1): the files a game needs to draw the sprite,
 * as bytes, under the names of `bundleFileNames`.
 *
 * - `<name>.png`: the atlas of the composites of the exported frames (`compositeFrame`:
 *   the visible pixel layers), packed by `pack` with the settings. RGBA8 with straight
 *   alpha and no chunk besides IHDR, IDAT and IEND.
 * - `<name>.atlas.json`: `ngne-sprite-atlas` version 1 (docs/FORMAT.md §2), as `atlasFor`
 *   describes it.
 * - `<name>.sprites.ts` (`files.spritesTs`): a module for an NGNE game, with the atlas data
 *   and the sprite runtime in it.
 * - `<name>.preview.config.mjs` (`files.previewConfig`): the adapter for `ngne-preview`.
 * - `<name>.aseprite.json` (`files.asepriteJson`: "array" or "hash"): the same atlas as
 *   Aseprite's sprite-sheet data.
 *
 * The text files are ASCII with "\n" line ends. Deterministic: the same document and
 * settings give the same bytes in every file, at any time and on any platform.
 *
 * The document is only read. `settings` are the document's own unless given.
 *
 * Throws `ExportError` and `PackError` as `atlasFor` does; a document that cannot be
 * exported is refused before a frame is composited whenever the plan shows it.
 */
export function bundle(doc: SpriteDoc, settings: ExportSettings = doc.exportSettings): Bundle {
    const plan = planExport(doc, settings);
    const { spritesTs, previewConfig, asepriteJson } = settings.files;
    if (!ASEPRITE_FORMS.includes(asepriteJson)) {
        throw new ExportError(
            "settings",
            `The Aseprite JSON form must be one of ${ASEPRITE_FORMS.join(", ")}, got ` +
                `${String(asepriteJson)}.`,
        );
    }
    const frames = plan.frameIndices.map((index) => compositeFrame(doc, doc.frames[index].id));
    const { atlas, meta } = atlasOfPlan(frames, doc, settings, plan);

    const { name } = plan;
    const text = (ending: string, content: string): BundleFile => ({
        name: `${name}.${ending}`,
        bytes: new TextEncoder().encode(content),
    });
    const files: BundleFile[] = [
        { name: `${name}.png`, bytes: encodePng(atlas) },
        text("atlas.json", atlasJsonText(meta)),
    ];
    if (spritesTs) files.push(text("sprites.ts", spritesModuleText(meta, name)));
    if (previewConfig) files.push(text("preview.config.mjs", previewConfigText(meta, name)));
    if (asepriteJson !== "none") {
        files.push(text("aseprite.json", asepriteJsonText(meta, plan, doc, asepriteJson)));
    }
    return { files, atlas, meta };
}
