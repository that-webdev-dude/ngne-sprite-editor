import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, loadConfigFromFile } from "vite";
import type { Plugin, Rollup, UserConfig } from "vite";
import { describe, expect, it } from "vitest";
import { EXCLUDED_CODE, excludedCodeIn } from "../../scripts/licences";

// Code the build must leave out (`EXCLUDED_CODE` of scripts/licences.ts): gifenc's colour
// quantizer. The markers find it in gifenc's files and not in its encoder, and a bundle of the
// encoder with the project's `resolve` settings (vite.config.ts) holds none of it.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const GIFENC = join(ROOT, "node_modules", "gifenc");
const read = (...path: string[]) => readFileSync(join(GIFENC, ...path), "utf8");
const [QUANTIZER] = EXCLUDED_CODE;

/** The JavaScript of a minified build of `source`, an entry with the given `resolve`. */
async function bundle(source: string, resolve: UserConfig["resolve"]): Promise<string> {
    const entry: Plugin = {
        name: "entry",
        resolveId: (id) => (id === "virtual:entry" ? "\0entry" : null),
        load: (id) => (id === "\0entry" ? source : null),
    };
    const result = (await build({
        configFile: false,
        root: ROOT,
        logLevel: "silent",
        resolve,
        plugins: [entry],
        build: { write: false, minify: true, rollupOptions: { input: "virtual:entry" } },
    })) as Rollup.RollupOutput | Rollup.RollupOutput[];
    return (Array.isArray(result) ? result : [result])
        .flatMap(({ output }) => output)
        .map((file) => (file.type === "chunk" ? file.code : ""))
        .join("\n");
}

// The GIF export's use of gifenc: the encoder alone (src/core/gif/gifExport.ts).
const ENCODER_ONLY = 'import { GIFEncoder } from "gifenc";\nglobalThis.encoder = GIFEncoder;\n';

describe("code the build leaves out", () => {
    it("finds gifenc's quantizer and palette functions in its sources and its CommonJS build", () => {
        expect(excludedCodeIn(read("src", "pnnquant2.js"))).toEqual([QUANTIZER!.what]);
        expect(excludedCodeIn(read("src", "palettize.js"))).toEqual([QUANTIZER!.what]);
        expect(excludedCodeIn(read("dist", "gifenc.js"))).toEqual([QUANTIZER!.what]);
    });

    it("finds nothing in the modules of gifenc's encoder", () => {
        for (const file of ["index.js", "lzwEncode.js", "stream.js", "constants.js"]) {
            expect(excludedCodeIn(read("src", file)), file).toEqual([]);
        }
    });

    it("is not in a bundle of the encoder built with the project's resolve settings", async () => {
        const loaded = await loadConfigFromFile(
            { command: "build", mode: "production" },
            join(ROOT, "vite.config.ts"),
            ROOT,
            "silent",
        );
        const code = await bundle(ENCODER_ONLY, loaded!.config.resolve);
        expect(code).toContain("GIF89a");
        expect(excludedCodeIn(code)).toEqual([]);
    }, 60_000);

    it("is in a bundle of the encoder built without them, from gifenc's CommonJS build", async () => {
        const code = await bundle(ENCODER_ONLY, {});
        expect(code).toContain("GIF89a");
        expect(excludedCodeIn(code)).toEqual([QUANTIZER!.what]);
    }, 60_000);
});
