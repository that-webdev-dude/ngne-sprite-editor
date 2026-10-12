import { MANIFEST_ENTRY, PROJECT_FORMAT, PROJECT_GENERATOR, PROJECT_VERSION } from "./format";
import { JsonReader } from "./json";
import { assertReadableVersion } from "./migrations";
import type { ProjectManifest } from "./schema";

// The annotation lets the compiler see that `reader.fail` never returns.
const reader: JsonReader = new JsonReader("invalid-manifest", MANIFEST_ENTRY);

/** The `manifest.json` this version of the editor writes. */
export function projectManifest(): ProjectManifest {
    return { format: PROJECT_FORMAT, version: PROJECT_VERSION, generator: PROJECT_GENERATOR };
}

/**
 * Checks a parsed `manifest.json`. `format` and `version` are read first and alone, as every
 * version of the format keeps them, so a project of a newer version is told apart from a
 * file that is not a project; the other fields are then those of the version found.
 *
 * Throws `ProjectError`: "invalid-manifest", or "newer-version" for a schema version above
 * `PROJECT_VERSION`.
 */
export function readManifest(value: unknown): ProjectManifest {
    const { format, version } = reader.record(value, "");
    if (format !== PROJECT_FORMAT) {
        reader.fail("format", `must be "${PROJECT_FORMAT}": the file is not a sprite project`);
    }
    assertReadableVersion(version);
    const fields = reader.object(value, "", ["format", "version", "generator"]);
    return { format, version, generator: reader.string(fields.generator, "generator") };
}
