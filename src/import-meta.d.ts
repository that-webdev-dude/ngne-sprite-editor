// `types: []` leaves out Vite's client declarations; the parts of `import.meta` the app uses are
// declared here. The app program includes this file through `src`. A module that is also
// compiled outside it (imported by a unit test) adds `import type {} from ".../import-meta"`.
declare global {
    interface ImportMetaEnv {
        readonly DEV: boolean;
        readonly PROD: boolean;
    }

    interface ImportMeta {
        readonly env: ImportMetaEnv;
        glob<Module>(pattern: string, options: { eager: true }): Record<string, Module>;
    }
}

export {};
