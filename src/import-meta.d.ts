// `types: []` leaves out Vite's client declarations; the parts of `import.meta` the app uses are
// declared here. The app program includes this file through `src`. A module that is also
// compiled outside it (imported by a unit test) adds `import type {} from ".../import-meta"`.
declare global {
    interface ImportMetaEnv {
        readonly DEV: boolean;
        readonly PROD: boolean;
        /** Vite's `base`: where the app, its manifest and its service worker are served. */
        readonly BASE_URL: string;
        /** True in a build, which has the service worker beside it (vite.config.ts, SE-072). */
        readonly SERVICE_WORKER: boolean;
    }

    interface ImportMeta {
        readonly env: ImportMetaEnv;
        glob<Module>(pattern: string, options: { eager: true }): Record<string, Module>;
    }
}

export {};
