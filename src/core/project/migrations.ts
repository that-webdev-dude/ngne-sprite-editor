import { ProjectError } from "./errors";
import { MANIFEST_ENTRY, PROJECT_VERSION } from "./format";

/**
 * Rewrites the parsed `doc.json` of one schema version into that of the next. It is given a
 * value that nothing has checked yet, so it reads defensively and throws `ProjectError`
 * "invalid-document" for what it cannot rewrite; the result is checked as the next version.
 */
export type Migration = (docJson: unknown) => unknown;

/**
 * The migrations in order: the one at index n − 1 takes schema version n to n + 1, so there
 * is one for every version below `PROJECT_VERSION`. Version 1 is the first: none yet.
 */
export const MIGRATIONS: readonly Migration[] = [];

/**
 * Throws `ProjectError` unless `version` is a schema version from 1 to `newest`: "newer-version"
 * for a later one, "invalid-manifest" for anything that is not a version number.
 */
export function assertReadableVersion(
    version: unknown,
    newest: number = PROJECT_VERSION,
): asserts version is number {
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
        const got = typeof version === "number" ? String(version) : typeof version;
        throw new ProjectError(
            "invalid-manifest",
            `${MANIFEST_ENTRY}: \`version\` must be an integer of at least 1, got ${got}.`,
            { entry: MANIFEST_ENTRY },
        );
    }
    if (version > newest) {
        throw new ProjectError(
            "newer-version",
            `The project has schema version ${version}, and this version of the editor reads ` +
                `up to version ${newest}. Open it with a newer version of the editor.`,
            { entry: MANIFEST_ENTRY },
        );
    }
}

/**
 * The parsed `doc.json` of schema version `version` as the newest version writes it: every
 * migration from that version on, applied in order. `migrations` is `MIGRATIONS` outside tests.
 */
export function migrateDocJson(
    docJson: unknown,
    version: number,
    migrations: readonly Migration[] = MIGRATIONS,
): unknown {
    const newest = migrations.length + 1;
    assertReadableVersion(version, newest);
    let migrated = docJson;
    for (let from = version; from < newest; from++) {
        migrated = migrations[from - 1](migrated);
    }
    return migrated;
}
