import { MAX_ATLAS_SIDE, animationIds, bundle, exportName } from "../../core/export";
import type { Bundle } from "../../core/export";
import type { SpriteDoc } from "../../core/model";

// What the Export dialog shows of an export before it is made (DESIGN §7; SE-052): the files
// with their sizes, the frame and animation IDs, the atlas, the warnings, or the message of
// the error that keeps the document from being exported. It is the bundle itself, so the
// sizes are those of the files written.

/** An atlas within this share of the side limit is warned about. */
export const ATLAS_WARNING_SHARE = 0.9;

export interface ExportPreview {
    /** `<name>` of SPEC §9.1. */
    name: string;
    /** The bundle, or null when the document cannot be exported with its settings. */
    bundle: Bundle | null;
    /** The message of `ExportError` or `PackError` (or another failure) when `bundle` is null. */
    error: string | null;
    /** Each file of the bundle and its size in bytes, in the order of SPEC §9.1. */
    files: { name: string; size: number }[];
    /** The frame IDs of the atlas, in frame order. */
    frameIds: string[];
    /** The animation IDs of the atlas, in order. */
    animationIds: string[];
    /** One line for each thing the user should know: renamed IDs, an atlas near the limit. */
    warnings: string[];
}

/** Whether the text has a character a slug keeps (SPEC §9.1: a–z, 0–9 after lowering A–Z). */
function hasSlugCharacter(text: string): boolean {
    return /[A-Za-z0-9]/.test(text);
}

/**
 * The warnings of an export: each exported tag whose animation ID is not the slug of its
 * name (a later tag of the same slug, SPEC §9.3 "duplicate tag slugs get -2, -3 suffixes"),
 * or whose name leaves no slug (`tag`); an atlas whose width or height is within 10% of the
 * side limit of SPEC §9.4.
 */
export function exportWarnings(doc: SpriteDoc, result: Bundle): string[] {
    const warnings: string[] = [];
    const exported = new Set(Object.keys(result.meta.animations));
    const ids = animationIds(doc);
    doc.tags.forEach((tag, index) => {
        const named = ids[index];
        if (!named || !exported.has(named.id)) return;
        if (!hasSlugCharacter(tag.name)) {
            warnings.push(
                `Tag “${tag.name}” is exported as “${named.id}”: its name has no letter or ` +
                    `digit an ID can keep.`,
            );
        } else if (named.id !== named.slug) {
            warnings.push(
                `Tag “${tag.name}” is exported as “${named.id}”: an earlier tag has the ID ` +
                    `“${named.slug}”.`,
            );
        }
    });
    const { width, height } = result.meta;
    if (Math.max(width, height) > ATLAS_WARNING_SHARE * MAX_ATLAS_SIDE) {
        warnings.push(
            `The atlas is ${width} × ${height} px, within 10% of the limit of ` +
                `${MAX_ATLAS_SIDE} px a side.`,
        );
    }
    return warnings;
}

/** The message an export failure shows. */
export function exportFailure(error: unknown): string {
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

/** Previews by the record of an open document, which the store replaces on every change. */
const previews = new WeakMap<object, ExportPreview>();

/**
 * `exportPreview` of an open document's record, made once per record. The store replaces the
 * record, with a higher `revision`, on every change of the document, of its export settings
 * and of its session state (pixels an open transaction writes included, `touch`), so a record
 * stands for one version of the document and its settings. The Export dialog renders the
 * preview of the record it is given; an export (`deliver`) takes the preview of the record the
 * store holds when it bundles, so it reuses the dialog's bundle when nothing changed since the
 * dialog showed it, and makes a new one otherwise.
 */
export function previewOf(document: {
    readonly session: { readonly doc: SpriteDoc };
}): ExportPreview {
    let preview = previews.get(document);
    if (!preview) {
        preview = exportPreview(document.session.doc);
        previews.set(document, preview);
    }
    return preview;
}

/** The preview of the document's export with its own settings. */
export function exportPreview(doc: SpriteDoc): ExportPreview {
    const name = exportName(doc.name);
    let result: Bundle;
    try {
        result = bundle(doc);
    } catch (error) {
        // `ExportError` ("too-many-entries", "settings", "document") or `PackError`
        // ("atlas-size", "memory"). "too-many-frames" cannot happen in this app: a document has
        // at most 65 535 frames (FORMAT.md §1.8) and an atlas holds 65 536; it is shown like
        // the others should the limits ever change.
        return {
            name,
            bundle: null,
            error: exportFailure(error),
            files: [],
            frameIds: [],
            animationIds: [],
            warnings: [],
        };
    }
    return {
        name,
        bundle: result,
        error: null,
        files: result.files.map((file) => ({ name: file.name, size: file.bytes.length })),
        frameIds: Object.keys(result.meta.frames),
        animationIds: Object.keys(result.meta.animations),
        warnings: exportWarnings(doc, result),
    };
}
