// Declares the app's build-time constants wherever this module is compiled.
import type { AppEnv } from "../../import-meta";

// What the About dialog shows (Help → About NGNE Sprite Editor…). The versions and the licence
// are package.json's, put in at build time (scripts/appInfo.ts, vite.config.ts), so a release
// that bumps package.json changes the dialog without a change here.

/** The repository of the app, which the About dialog links. */
export const REPOSITORY_URL = "https://github.com/that-webdev-dude/ngne-sprite-editor";

export interface AppInfo {
    /** The app's name as the interface shows it. */
    readonly title: string;
    /** package.json `name`. */
    readonly packageName: string;
    /** package.json `version`. */
    readonly version: string;
    /** package.json `license`. */
    readonly licence: string;
    /** The engine package and the version package.json pins. */
    readonly engine: { readonly packageName: string; readonly version: string };
    readonly repositoryUrl: string;
    readonly changelogUrl: string;
}

const env: AppEnv = import.meta.env;

/** The facts of this build. */
export const appInfo: AppInfo = {
    title: "NGNE Sprite Editor",
    packageName: env.APP_PACKAGE,
    version: env.APP_VERSION,
    licence: env.APP_LICENSE,
    engine: {
        packageName: env.ENGINE_PACKAGE,
        version: env.ENGINE_VERSION,
    },
    repositoryUrl: REPOSITORY_URL,
    changelogUrl: `${REPOSITORY_URL}/blob/main/CHANGELOG.md`,
};

/**
 * The one line Copy version info puts on the clipboard, for a bug report:
 * "ngne-sprite-editor <version> · @ngne/core <version> · <user agent>".
 */
export function versionLine(info: AppInfo, userAgent: string): string {
    return [
        `${info.packageName} ${info.version}`,
        `${info.engine.packageName} ${info.engine.version}`,
        userAgent,
    ].join(" · ");
}
