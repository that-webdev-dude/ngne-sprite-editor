import { readFileSync } from "node:fs";
import { join } from "node:path";

// The facts of the app that the About dialog shows (src/app/about/appInfo.ts), read from
// package.json when Vite starts and handed to the app as `define` constants, so a release that
// bumps package.json updates the dialog with no change to the code. vite.config.ts and
// vitest.config.ts both pass them.

/** The engine whose pinned version the About dialog names. */
export const ENGINE_PACKAGE = "@ngne/core";

interface PackageJson {
    name?: unknown;
    version?: unknown;
    license?: unknown;
    dependencies?: Record<string, unknown>;
}

function field(value: unknown, name: string): string {
    if (typeof value !== "string" || value === "") {
        throw new Error(`package.json: ${name} is not a non-empty string.`);
    }
    return value;
}

/**
 * The `define` entries of the app's facts, from the package.json in `root`: its name, version
 * and licence, and the name and version of the engine it depends on (`ENGINE_PACKAGE`).
 */
export function appInfoDefines(root: string): Record<string, string> {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageJson;
    const values = {
        APP_PACKAGE: field(pkg.name, "name"),
        APP_VERSION: field(pkg.version, "version"),
        APP_LICENSE: field(pkg.license, "license"),
        ENGINE_PACKAGE,
        ENGINE_VERSION: field(
            pkg.dependencies?.[ENGINE_PACKAGE],
            `dependencies["${ENGINE_PACKAGE}"]`,
        ),
    };
    return Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
            `import.meta.env.${key}`,
            JSON.stringify(value),
        ]),
    );
}
