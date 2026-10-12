import type { PixelBuffer, SpriteDoc } from "../model";
import { PngError, decodePng } from "../png";
import {
    assertDocument,
    assertPixelBytes,
    attachImages,
    readDocJson,
    referenceSourceIds,
} from "./docFromJson";
import { ProjectError, quoted } from "./errors";
import {
    DOC_ENTRY,
    MANIFEST_ENTRY,
    MAX_DOC_JSON_BYTES,
    MAX_MANIFEST_BYTES,
    MAX_PROJECT_CONTENT_BYTES,
    MAX_REFERENCE_SOURCE_BYTES,
    imageEntry,
    maxImageEntryBytes,
    referenceEntry,
} from "./format";
import { parseJson } from "./json";
import { readManifest } from "./manifest";
import { migrateDocJson } from "./migrations";
import { isPng, pngHeader } from "./png";
import { openZip } from "./zip";
import type { ZipArchive } from "./zip";

/** What a project file holds. */
export interface ProjectContents {
    doc: SpriteDoc;
    /** Original bytes of the reference images, by `ReferenceLayer.sourceId`. */
    referenceSources: Map<string, Uint8Array>;
}

const BIT_DEPTH = 8;
const COLOR_TYPE_RGBA = 6;

/** The pixels of one image of the document, from its entry. */
async function readImage(
    archive: ZipArchive,
    doc: SpriteDoc,
    imageId: string,
): Promise<PixelBuffer> {
    const name = imageEntry(imageId);
    const bytes = archive.read(name, maxImageEntryBytes(doc.width, doc.height));
    if (!bytes) {
        throw new ProjectError(
            "missing-image",
            `A cel of the document names the image ${quoted(imageId)}, and the file has no ` +
                `entry ${quoted(name)}.`,
            { entry: name },
        );
    }
    // The header is checked here, before the decoder is asked to allocate what it states.
    const header = pngHeader(bytes);
    if (!header) {
        throw new ProjectError("corrupt-entry", `Entry ${quoted(name)} is not a PNG file.`, {
            entry: name,
        });
    }
    if (header.width !== doc.width || header.height !== doc.height) {
        throw new ProjectError(
            "image-size",
            `Entry ${quoted(name)} is an image of ${header.width}×${header.height} pixels; ` +
                `the document is ${doc.width}×${doc.height}.`,
            { entry: name },
        );
    }
    const { bitDepth, colorType, interlace } = header;
    if (bitDepth !== BIT_DEPTH || colorType !== COLOR_TYPE_RGBA || interlace !== 0) {
        throw new ProjectError(
            "image-format",
            `Entry ${quoted(name)} is a PNG of colour type ${colorType} with ${bitDepth} bits ` +
                `per sample${interlace === 0 ? "" : ", interlaced"}; an image of a project is ` +
                `8-bit RGBA (colour type 6), not interlaced.`,
            { entry: name },
        );
    }
    try {
        return await decodePng(bytes);
    } catch (cause) {
        if (!(cause instanceof PngError)) throw cause;
        if (cause.code === "memory") throw cause;
        throw new ProjectError(
            "corrupt-entry",
            `Entry ${quoted(name)} is damaged: ${cause.message}`,
            { entry: name, cause },
        );
    }
}

/** The original bytes of one reference image, copied out of the archive. */
function readReference(archive: ZipArchive, sourceId: string): Uint8Array {
    const name = referenceEntry(sourceId);
    const bytes = archive.read(name, MAX_REFERENCE_SOURCE_BYTES);
    if (!bytes) {
        throw new ProjectError(
            "missing-reference",
            `A reference layer names the source ${quoted(sourceId)}, and the file has no ` +
                `entry ${quoted(name)}.`,
            { entry: name },
        );
    }
    if (!isPng(bytes)) {
        throw new ProjectError("corrupt-entry", `Entry ${quoted(name)} is not a PNG file.`, {
            entry: name,
        });
    }
    return new Uint8Array(bytes);
}

async function readProject(bytes: Uint8Array): Promise<ProjectContents> {
    const archive = openZip(bytes, MAX_PROJECT_CONTENT_BYTES);
    const manifestBytes = archive.read(MANIFEST_ENTRY, MAX_MANIFEST_BYTES);
    if (!manifestBytes) {
        throw new ProjectError(
            "missing-manifest",
            `The file has no entry "${MANIFEST_ENTRY}": it is not a sprite project.`,
            { entry: MANIFEST_ENTRY },
        );
    }
    const manifest = readManifest(parseJson(manifestBytes, MANIFEST_ENTRY));
    const docBytes = archive.read(DOC_ENTRY, MAX_DOC_JSON_BYTES);
    if (!docBytes) {
        throw new ProjectError("missing-document", `The file has no entry "${DOC_ENTRY}".`, {
            entry: DOC_ENTRY,
        });
    }
    const docJson = migrateDocJson(parseJson(docBytes, DOC_ENTRY), manifest.version);
    const skeleton = readDocJson(docJson);
    const { doc, imageIds } = skeleton;

    assertPixelBytes(doc, imageIds.length);
    const images = new Map<string, PixelBuffer>();
    // One at a time: the decoder's working memory is then that of a single image.
    for (const imageId of imageIds) {
        images.set(imageId, await readImage(archive, doc, imageId));
    }
    attachImages(skeleton, images);
    // Before the references are read: the invariants bound how many there are.
    assertDocument(doc);

    const referenceSources = new Map<string, Uint8Array>();
    for (const sourceId of referenceSourceIds(doc)) {
        referenceSources.set(sourceId, readReference(archive, sourceId));
    }
    return { doc, referenceSources };
}

/**
 * Reads a `.ngsprite` project file (docs/FORMAT.md): the document with its images, and the
 * original bytes of its reference images. Asynchronous because the PNG decoder is. A file of
 * an older schema version is migrated; `thumb.png` and entries the format does not name are
 * not read. The result shares no memory with `bytes`, which must not change before the
 * promise settles.
 *
 * `bytes` is untrusted. Everything is checked before it is used: the zip structure; the
 * size every entry states, against the limits of the format, before it is inflated; its
 * CRC-32; the manifest; every field of `doc.json` against the schema; the header of every
 * image against the document's size before it is decoded; that every image and reference
 * source the document names is present; and at last the invariants of SPEC §5.1.
 *
 * Rejects with `ProjectError`, whose `code` says what failed and whose `entry` names the
 * entry at fault when there is one. A document is returned whole or not at all.
 */
export async function deserialize(bytes: Uint8Array): Promise<ProjectContents> {
    try {
        return await readProject(bytes);
    } catch (error) {
        const memory =
            error instanceof RangeError || (error instanceof PngError && error.code === "memory");
        if (!memory) throw error;
        throw new ProjectError("memory", "There is not enough memory to open the project.", {
            cause: error,
        });
    }
}
