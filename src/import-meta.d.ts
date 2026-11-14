// `types: []` leaves out Vite's client declarations; the parts of `import.meta` the app uses are
// declared here. The app program includes this file through `src`, the tests' program
// (tsconfig.node.json) by name, so a module the unit tests import needs no import of it.
declare global {
    interface ImportMetaEnv {
        readonly DEV: boolean;
        readonly PROD: boolean;
        /** Vite's `base`: where the app, its manifest and its service worker are served. */
        readonly BASE_URL: string;
        /** True in a build, which has the service worker beside it (vite.config.ts, SE-072). */
        readonly SERVICE_WORKER: boolean;
        // The app's facts from package.json at build time (scripts/appInfo.ts); the About
        // dialog shows them (app/about/appInfo.ts).
        /** package.json `name`: "ngne-sprite-editor". */
        readonly APP_PACKAGE: string;
        /** package.json `version`. */
        readonly APP_VERSION: string;
        /** package.json `license`, an SPDX identifier. */
        readonly APP_LICENSE: string;
        /** The engine's package: "@ngne/core". */
        readonly ENGINE_PACKAGE: string;
        /** The version of the engine package.json depends on. */
        readonly ENGINE_VERSION: string;
    }

    interface ImportMeta {
        readonly env: ImportMetaEnv;
        glob<Module>(pattern: string, options: { eager: true }): Record<string, Module>;
    }
}

/** The app's `import.meta.env`, for a module that names its type (app/about/appInfo.ts). */
export type AppEnv = ImportMetaEnv;
