import type { ExcludedCode } from "@ngne/editor-ui/licences/build";

// The app's rules for its licences file (`generateLicences` of @ngne/editor-ui/licences/build,
// vite.config.ts): the code of a bundled package the build must leave out, and the build tools
// whose own code every build holds.

/** The code the build must not ship (the build fails when it finds it). */
export const EXCLUDED_CODE: readonly ExcludedCode[] = [
    {
        // vite.config.ts aliases `gifenc` to its ES module build so that only the encoder is
        // bundled. The colour formats are string literals of `src/pnnquant2.js` and
        // `src/palettize.js` only, not of the encoder's modules.
        what:
            "gifenc's colour quantizer (src/pnnquant2.js, credited as based on a port of PnnQuant.js) " +
            "or its palette functions (src/palettize.js)",
        markers: [/["'`](?:rgb565|rgb444|rgba4444)["'`]/],
    },
];

/**
 * Build tools whose own code the bundle holds although no module imports it: Rolldown writes
 * its runtime helpers into every build, so its licence is listed with the bundled packages.
 * The module-preload polyfill is turned off (`build.modulePreload`), so Vite writes none.
 */
export const BUILD_PACKAGES: readonly string[] = ["node_modules/rolldown"];
