import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    LICENCES_FILE,
    PACKAGE_STAND_IN_TEXTS,
    buildLicencesFile,
    runtimePackageDirs,
} from "@ngne/editor-ui/licences/build";
import { LICENCES_PATH } from "@ngne/editor-ui/licences";

// The open-source licences file of the build (`generateLicences` of
// @ngne/editor-ui/licences/build, vite.config.ts) for this repository: which packages it lists
// and what it holds, from the repository's own runtime dependencies.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
describe("the repository's licences file", () => {
    const lock = readFileSync(join(ROOT, "package-lock.json"), "utf8");
    const runtime = runtimePackageDirs(lock, ROOT);
    const text = buildLicencesFile(runtime, { root: ROOT, title: "NGNE Sprite Editor" });

    it("is the file the app opens", () => {
        expect(LICENCES_FILE).toBe(LICENCES_PATH);
    });

    it("lists every runtime dependency with an allowed licence and its text", () => {
        const names = runtime.map((dir) => dir.slice(dir.lastIndexOf("node_modules/") + 13));
        for (const name of ["react", "react-dom", "fflate", "fast-png", "gifenc", "lucide-react"]) {
            expect(names).toContain(name);
        }
        // Type declarations reach no build.
        expect(names.filter((name) => name.startsWith("@types/"))).toEqual([]);
        expect(names).not.toContain("csstype");
        for (const name of names) expect(text, name).toMatch(new RegExp(`\\n${name} \\S+ \\(`));
    });

    it("holds this project's licence, its notices (Zingl's among them) and lucide's Feather notice", () => {
        expect(text).toContain(readFileSync(join(ROOT, "LICENSE"), "utf8").split("\n")[2]);
        expect(text).toContain("## Bresenham curve rasterizing algorithms (MIT)");
        expect(text).toContain("Copyright (c) 2020 zingl");
        expect(text).toContain("The following Lucide icons are derived from the Feather project");
        expect(text).toContain("Copyright (c) 2013-present Cole Bemis");
    });

    it("takes the licence of react-remove-scroll-bar, which ships none, from the package's stand-in texts", () => {
        expect(text).toContain(`[${PACKAGE_STAND_IN_TEXTS.label}/react-remove-scroll-bar.txt]`);
        expect(text).toContain("Copyright (c) 2025 Anton Korzunov");
    });
});
