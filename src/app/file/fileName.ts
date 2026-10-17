import { PROJECT_FILE_EXTENSION } from "../../core/project";

/** Characters no file name may hold on Windows, the strictest system the editor runs on. */
const FORBIDDEN: ReadonlySet<string> = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);
/** Names Windows keeps for devices, also before an extension ("con.ngsprite"). */
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
/** Longest stem, in characters: with the extension well inside the 255 of common systems. */
const MAX_STEM_LENGTH = 200;
/** Stem of a document whose name leaves nothing usable. */
const FALLBACK_STEM = "Sprite";

/** A character a file name cannot hold: one of `FORBIDDEN`, or a control character. */
function isForbidden(character: string): boolean {
    const code = character.codePointAt(0) ?? 0;
    return FORBIDDEN.has(character) || code < 0x20 || code === 0x7f;
}

/**
 * The file name a document is saved under when it has no file yet (SPEC §10): its name with
 * the characters a file name cannot hold replaced by "_", at most 200 characters, without
 * trailing dots and spaces, "_" before a device name of Windows, and with the extension
 * `.ngsprite`, which a name ending in it does not get twice. "Sprite" when nothing is left.
 */
export function projectFileName(documentName: string): string {
    let stem = documentName.trim();
    if (stem.toLowerCase().endsWith(PROJECT_FILE_EXTENSION)) {
        stem = stem.slice(0, -PROJECT_FILE_EXTENSION.length);
    }
    stem = Array.from(stem, (character) => (isForbidden(character) ? "_" : character))
        .slice(0, MAX_STEM_LENGTH)
        .join("")
        .replace(/[. ]+$/, "")
        .trimStart();
    if (stem === "") stem = FALLBACK_STEM;
    if (DEVICE.test(stem.split(".")[0] ?? "")) stem = `_${stem}`;
    return stem + PROJECT_FILE_EXTENSION;
}

/** Whether a file's name says it is a project file. */
export function isProjectFileName(name: string): boolean {
    return name.toLowerCase().endsWith(PROJECT_FILE_EXTENSION);
}
