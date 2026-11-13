import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
    ALLOWED_LICENCES,
    LICENCES_FILE,
    LicenceError,
    buildLicencesFile,
    fallbackFileOf,
    licenceAllowed,
    licencesText,
    packageDirOf,
    packageDirsOf,
    readPackageLicence,
    runtimePackageDirs,
    strayPackages,
} from "../../scripts/licences";
import { LICENCES_PATH } from "../../src/app/licences/openLicences";

// The open-source licences file of the build (scripts/licences.ts): which packages it lists,
// which licences it accepts, and what it holds. The packages of the fixtures are written to
// a temporary directory; the last tests read the repository's own runtime dependencies.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIT = "MIT License\n\nCopyright (c) 2026 Somebody\n\nPermission is hereby granted…\n";

const temp = mkdtempSync(join(tmpdir(), "licences-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

/** Writes a package under `<temp>/<project>/node_modules/<name>` with the given files. */
function writePackage(
    project: string,
    name: string,
    manifest: Record<string, unknown>,
    files: Record<string, string> = {},
): string {
    const dir = join(temp, project, "node_modules", ...name.split("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name, version: "1.0.0", ...manifest }),
    );
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
    return dir;
}

describe("packageDirOf", () => {
    it("is the package directory of a bundled module, scoped or nested", () => {
        expect(packageDirOf("/app/node_modules/react/cjs/react.production.js")).toBe(
            "/app/node_modules/react",
        );
        expect(packageDirOf("C:\\app\\node_modules\\@radix-ui\\react-menu\\dist\\index.mjs")).toBe(
            "C:/app/node_modules/@radix-ui/react-menu",
        );
        // A nested copy is that copy.
        expect(packageDirOf("/app/node_modules/a/node_modules/b/index.js?commonjs-es")).toBe(
            "/app/node_modules/a/node_modules/b",
        );
        expect(packageDirOf("\0/app/node_modules/gifenc/dist/gifenc.esm.js")).toBe(
            "/app/node_modules/gifenc",
        );
    });

    it("is null for the program's own modules and virtual ones", () => {
        expect(packageDirOf("/app/src/main.tsx")).toBeNull();
        expect(packageDirOf("\0vite/preload-helper.js")).toBeNull();
        expect(packageDirOf("/app/node_modules/")).toBeNull();
        expect(packageDirOf("/app/node_modules/@scope/")).toBeNull();
    });

    it("lists each package once, in order of name", () => {
        expect(
            packageDirsOf([
                "/app/node_modules/zustand/esm/vanilla.mjs",
                "/app/src/main.tsx",
                "/app/node_modules/@floating-ui/dom/dist/a.mjs",
                "/app/node_modules/zustand/esm/react.mjs",
                "/app/node_modules/react/index.js",
            ]),
        ).toEqual([
            "/app/node_modules/@floating-ui/dom",
            "/app/node_modules/react",
            "/app/node_modules/zustand",
        ]);
    });
});

describe("licenceAllowed", () => {
    it("allows the permissive licences of the allowlist and nothing else", () => {
        expect(ALLOWED_LICENCES).toEqual([
            "MIT",
            "ISC",
            "0BSD",
            "BSD-2-Clause",
            "BSD-3-Clause",
            "Apache-2.0",
        ]);
        for (const licence of ALLOWED_LICENCES) expect(licenceAllowed(licence), licence).toBe(true);
        for (const licence of ["GPL-3.0", "LGPL-2.1", "MPL-2.0", "CC-BY-4.0", "UNLICENSED", ""]) {
            expect(licenceAllowed(licence), licence).toBe(false);
        }
    });

    it("reads OR as a choice and AND as both", () => {
        expect(licenceAllowed("(MIT OR GPL-3.0)")).toBe(true);
        expect(licenceAllowed("GPL-3.0 OR MPL-2.0")).toBe(false);
        expect(licenceAllowed("MIT AND ISC")).toBe(true);
        expect(licenceAllowed("MIT AND GPL-3.0")).toBe(false);
    });
});

describe("readPackageLicence", () => {
    const fallbacks = join(temp, "fallbacks");
    mkdirSync(fallbacks, { recursive: true });

    it("reads the licence and every licence and NOTICE file at the package's top", () => {
        const dir = writePackage(
            "read",
            "@scope/thing",
            { license: "Apache-2.0" },
            { "LICENSE.txt": `${MIT}\r\n`, NOTICE: "Notice text  \n", "README.md": "no" },
        );
        expect(readPackageLicence(dir, fallbacks)).toEqual({
            name: "@scope/thing",
            version: "1.0.0",
            licence: "Apache-2.0",
            texts: [
                { file: "LICENSE.txt", text: MIT },
                { file: "NOTICE", text: "Notice text\n" },
            ],
        });
    });

    it("reads the older `licenses` list and a `license` object", () => {
        const list = writePackage(
            "read",
            "old-list",
            { licenses: [{ type: "MIT" }, { type: "GPL-2.0" }] },
            { LICENCE: MIT },
        );
        expect(readPackageLicence(list, fallbacks).licence).toBe("MIT OR GPL-2.0");
        const object = writePackage(
            "read",
            "old-object",
            { license: { type: "ISC" } },
            {
                COPYING: MIT,
            },
        );
        expect(readPackageLicence(object, fallbacks).licence).toBe("ISC");
    });

    it("refuses a package with a licence outside the allowlist", () => {
        const dir = writePackage("read", "copyleft", { license: "GPL-3.0" }, { LICENSE: "GPL" });
        expect(() => readPackageLicence(dir, fallbacks)).toThrow(LicenceError);
        expect(() => readPackageLicence(dir, fallbacks)).toThrow(/copyleft@1\.0\.0 .*GPL-3\.0/);
    });

    it("refuses a package that states no licence", () => {
        const dir = writePackage("read", "silent", {}, { LICENSE: MIT });
        expect(() => readPackageLicence(dir, fallbacks)).toThrow(/states no licence/);
    });

    it("refuses a package without a licence file, unless scripts/licence-texts has one", () => {
        const dir = writePackage("read", "@scope/bare", { license: "MIT" });
        expect(() => readPackageLicence(dir, fallbacks)).toThrow(
            /@scope\/bare@1\.0\.0 \(MIT\) has no licence file.*@scope__bare\.txt/,
        );
        expect(fallbackFileOf("@scope/bare")).toBe("@scope__bare.txt");
        writeFileSync(join(fallbacks, "@scope__bare.txt"), MIT);
        expect(readPackageLicence(dir, fallbacks).texts).toEqual([
            { file: "scripts/licence-texts/@scope__bare.txt", text: MIT },
        ]);
    });
});

describe("runtimePackageDirs", () => {
    it("lists the packages the lockfile does not mark dev, without type-only packages", () => {
        const project = "lock";
        writePackage(project, "runtime", { license: "MIT", main: "index.js" });
        writePackage(project, "@types/thing", { license: "MIT", types: "index.d.ts" });
        writePackage(project, "types-only", { license: "MIT", types: "index.d.ts", main: "" });
        writePackage(project, "nested", { license: "MIT", module: "index.mjs" });
        const lock = JSON.stringify({
            lockfileVersion: 3,
            packages: {
                "": { name: "app", dependencies: { runtime: "1" } },
                "node_modules/runtime": { version: "1.0.0" },
                "node_modules/@types/thing": { version: "1.0.0" },
                "node_modules/types-only": { version: "1.0.0" },
                "node_modules/tool": { version: "1.0.0", dev: true },
                "node_modules/runtime/node_modules/nested": { version: "1.0.0" },
            },
        });
        const root = join(temp, project);
        const prefix = root.replace(/\\/g, "/");
        expect(runtimePackageDirs(lock, root)).toEqual([
            `${prefix}/node_modules/runtime/node_modules/nested`,
            `${prefix}/node_modules/runtime`,
        ]);
    });

    it("needs a lockfile of version 2 or later", () => {
        expect(() => runtimePackageDirs(JSON.stringify({ dependencies: {} }), temp)).toThrow(
            LicenceError,
        );
    });
});

describe("strayPackages", () => {
    it("names the bundled packages that are not runtime dependencies", () => {
        const runtime = ["C:/app/node_modules/react", "C:/app/node_modules/a/node_modules/b"];
        expect(
            strayPackages(
                [
                    "C:\\app\\node_modules\\react",
                    "C:/app/node_modules/a/node_modules/b",
                    "C:/app/node_modules/vite",
                ],
                runtime,
            ),
        ).toEqual(["node_modules/vite"]);
    });
});

describe("licencesText", () => {
    const input = {
        title: "Example",
        licence: "MIT License\r\n\r\nCopyright (c) 2026 Owner\r\n",
        notices: "# Third-party notices\n\nPorted code.\n",
        packages: [
            {
                name: "zeta",
                version: "2.0.0",
                licence: "ISC",
                texts: [{ file: "LICENSE", text: "Z\n" }],
            },
            {
                name: "@alpha/one",
                version: "1.0.0",
                licence: "MIT",
                texts: [
                    { file: "LICENSE", text: "A\n" },
                    { file: "NOTICE", text: "N\n" },
                ],
            },
        ],
    };

    it("holds the program's licence, the notices and each package's licence, sorted by name", () => {
        const text = licencesText(input);
        expect(text.startsWith("Example: open source licences\n")).toBe(true);
        expect(text).toContain("MIT License\n\nCopyright (c) 2026 Owner\n");
        expect(text).toContain("Third-party notices (THIRD_PARTY_NOTICES.md)");
        expect(text).toContain("# Third-party notices\n\nPorted code.\n");
        expect(text).toContain("npm packages in this build (2)\n");
        const alpha = text.indexOf("@alpha/one 1.0.0 (MIT)");
        const zeta = text.indexOf("zeta 2.0.0 (ISC)");
        expect(alpha).toBeGreaterThan(0);
        expect(zeta).toBeGreaterThan(alpha);
        expect(text).toContain("[LICENSE]\n\nA\n\n[NOTICE]\n\nN\n");
        expect(text).not.toContain("\r");
        expect(text).not.toMatch(/\n{3}/);
        expect(text.endsWith("Z\n")).toBe(true);
    });

    it("gives the same text for the same input, whatever the order of the packages", () => {
        const reversed = { ...input, packages: [...input.packages].reverse() };
        expect(licencesText(reversed)).toBe(licencesText(input));
    });
});

describe("the repository's licences file", () => {
    const lock = readFileSync(join(ROOT, "package-lock.json"), "utf8");
    const runtime = runtimePackageDirs(lock, ROOT);
    const text = buildLicencesFile(ROOT, runtime, "NGNE Sprite Editor");

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

    it("takes the licence of react-remove-scroll-bar, which ships none, from scripts/licence-texts", () => {
        expect(text).toContain("[scripts/licence-texts/react-remove-scroll-bar.txt]");
        expect(text).toContain("Copyright (c) 2025 Anton Korzunov");
    });
});
