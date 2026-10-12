/**
 * What was wrong:
 * - `not-a-zip`: the bytes are not a zip archive, or its directory is damaged or cut short.
 * - `unsupported-zip`: a zip archive that uses what a project file must not: zip64, several
 *   disks, encryption, a compression method other than stored and deflate, or one name for
 *   two entries.
 * - `too-large`: an entry, the pixel data or the project as a whole exceeds a limit of the
 *   format (docs/FORMAT.md, Limits). Reported before the data is inflated or allocated.
 * - `memory`: memory for the project could not be allocated.
 * - `corrupt-entry`: an entry cannot be read: its checksum, deflate stream or stated size is
 *   wrong, a JSON entry is not JSON, a PNG entry is not a PNG file or does not decode.
 * - `missing-manifest`: the archive has no `manifest.json`.
 * - `invalid-manifest`: `manifest.json` does not describe a project file.
 * - `newer-version`: the file has a schema version above `PROJECT_VERSION`.
 * - `missing-document`: the archive has no `doc.json`.
 * - `invalid-document`: `doc.json`, or the document being written, breaks the schema: a
 *   missing or unknown field, a wrong type, a value outside its range, a reference to
 *   nothing. The message names the field.
 * - `missing-image`: a cel names an image that has no entry (reading) or no buffer (writing).
 * - `image-size`: an image does not have the document's size.
 * - `image-format`: an image entry is not an 8-bit RGBA PNG.
 * - `missing-reference`: a reference layer names a source that has no entry (reading) or no
 *   bytes (writing).
 * - `invariant`: the document breaks an invariant of SPEC §5.1; `cause` is the
 *   `InvariantError`.
 */
export type ProjectErrorCode =
    | "not-a-zip"
    | "unsupported-zip"
    | "too-large"
    | "memory"
    | "corrupt-entry"
    | "missing-manifest"
    | "invalid-manifest"
    | "newer-version"
    | "missing-document"
    | "invalid-document"
    | "missing-image"
    | "image-size"
    | "image-format"
    | "missing-reference"
    | "invariant";

export interface ProjectErrorOptions extends ErrorOptions {
    /** The archive entry at fault, when the problem lies in one. */
    entry?: string;
}

/** The one error type thrown by the functions of `core/project`. */
export class ProjectError extends Error {
    override readonly name = "ProjectError";
    readonly code: ProjectErrorCode;
    /** Name of the archive entry at fault ("doc.json", "images/a.png"), when there is one. */
    readonly entry: string | undefined;

    constructor(code: ProjectErrorCode, message: string, options: ProjectErrorOptions = {}) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.code = code;
        this.entry = options.entry;
    }
}

/** A name or an ID as it appears in a message: quoted, and cut when it is very long. */
export function quoted(text: string): string {
    return JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}…` : text);
}
