import type { SpriteDoc } from "../model";
import { PngError, encodePng } from "../png";
import { assertPixelBytes, checkedDocument, referenceSourceIds } from "./docFromJson";
import { docToJson } from "./docToJson";
import { ProjectError, quoted } from "./errors";
import {
    DOC_ENTRY,
    MANIFEST_ENTRY,
    MAX_DOC_JSON_BYTES,
    MAX_PROJECT_CONTENT_BYTES,
    MAX_PROJECT_ENTRIES,
    MAX_REFERENCE_SOURCE_BYTES,
    THUMBNAIL_ENTRY,
    imageEntry,
    maxImageEntryBytes,
    referenceEntry,
} from "./format";
import { encodeJson } from "./json";
import { projectManifest } from "./manifest";
import { isPng } from "./png";
import { projectThumbnail } from "./thumbnail";
import { writeZip } from "./zip";
import type { ZipInput } from "./zip";

function tooLarge(message: string, entry?: string): ProjectError {
    return new ProjectError("too-large", message, { entry });
}

/** The entry, once its content is known to fit the limit of its kind. */
function entryOf(name: string, data: Uint8Array, stored: boolean, maxBytes: number): ZipInput {
    if (data.length > maxBytes) {
        throw tooLarge(
            `Entry ${quoted(name)} would hold ${data.length} bytes; the limit is ` +
                `${maxBytes} bytes.`,
            name,
        );
    }
    return { name, data, stored };
}

function writeProject(
    doc: SpriteDoc,
    referenceSources: ReadonlyMap<string, Uint8Array>,
): Uint8Array<ArrayBuffer> {
    const docJson = docToJson(doc);
    // The document as `deserialize` will return it: built from that JSON, with every check a
    // file gets. What passes here can be opened again.
    const written = checkedDocument(docJson, doc.images);
    assertPixelBytes(written, written.images.size);
    const sourceIds = referenceSourceIds(written);
    const count = 3 + written.images.size + sourceIds.length;
    if (count > MAX_PROJECT_ENTRIES) {
        throw tooLarge(
            `The project would have ${count} entries; the limit is ${MAX_PROJECT_ENTRIES}.`,
        );
    }

    const entries = [
        entryOf(MANIFEST_ENTRY, encodeJson(projectManifest()), false, Infinity),
        entryOf(DOC_ENTRY, encodeJson(docJson), false, MAX_DOC_JSON_BYTES),
    ];
    const maxImageBytes = maxImageEntryBytes(written.width, written.height);
    for (const [imageId, image] of written.images) {
        // As the buffer is: colour under alpha 0 is part of the document.
        entries.push(entryOf(imageEntry(imageId), encodePng(image), true, maxImageBytes));
    }
    for (const sourceId of sourceIds) {
        const name = referenceEntry(sourceId);
        const bytes = referenceSources.get(sourceId);
        if (!bytes) {
            throw new ProjectError(
                "missing-reference",
                `A reference layer names the source ${quoted(sourceId)}, and its bytes were ` +
                    `not given.`,
                { entry: name },
            );
        }
        if (!isPng(bytes)) {
            throw new ProjectError(
                "corrupt-entry",
                `The reference source ${quoted(sourceId)} is not a PNG file.`,
                { entry: name },
            );
        }
        entries.push(entryOf(name, bytes, true, MAX_REFERENCE_SOURCE_BYTES));
    }
    entries.push(entryOf(THUMBNAIL_ENTRY, encodePng(projectThumbnail(written)), true, Infinity));

    const total = entries.reduce((sum, entry) => sum + entry.data.length, 0);
    if (total > MAX_PROJECT_CONTENT_BYTES) {
        throw tooLarge(
            `The entries of the project would hold ${total} bytes; the limit is ` +
                `${MAX_PROJECT_CONTENT_BYTES} bytes.`,
        );
    }
    return writeZip(entries);
}

/**
 * The bytes of a `.ngsprite` project file for the document (docs/FORMAT.md, schema version
 * `PROJECT_VERSION`): `manifest.json`, `doc.json`, one PNG per image (linked cels share
 * theirs), the original bytes of every reference image a layer uses, and `thumb.png`.
 *
 * `referenceSources` holds the reference images by `ReferenceLayer.sourceId`; entries no
 * layer names are not written. Only the document is saved: no selection, no active layer or
 * frame, no history. Neither argument is changed or kept.
 *
 * Deterministic: equal documents and sources give identical bytes, at any time and in any
 * time zone, whatever the order in which the document's maps were filled.
 *
 * A file that is returned can be read back by `deserialize`, as an equal document; a document
 * for which that does not hold is refused. Throws `ProjectError`: "invalid-document" for a
 * value outside the schema (an ID with other characters, a number outside its range, more
 * layers, frames or tags than the format holds), "invariant" for a broken invariant of SPEC
 * §5.1, "missing-image" and "image-size" for a cel's image, "missing-reference" when
 * `referenceSources` lacks a source, "corrupt-entry" when a source is not a PNG file,
 * "too-large" beyond a limit of the format, "memory" when memory runs out. Two kinds of
 * unreachable data are left out instead: a cel whose key names no pixel layer and frame of
 * the document, and an image no written cel uses.
 */
export function serialize(
    doc: SpriteDoc,
    referenceSources: ReadonlyMap<string, Uint8Array>,
): Uint8Array<ArrayBuffer> {
    try {
        return writeProject(doc, referenceSources);
    } catch (error) {
        const memory =
            error instanceof RangeError || (error instanceof PngError && error.code === "memory");
        if (!memory) throw error;
        throw new ProjectError("memory", "There is not enough memory to write the project.", {
            cause: error,
        });
    }
}
