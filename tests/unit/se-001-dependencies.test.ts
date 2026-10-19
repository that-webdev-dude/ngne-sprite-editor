import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Manifest {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
}
const manifest = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as Manifest;

describe("package.json", () => {
    // SPEC §4; `gifenc` joined with SE-063.
    it("has exactly the runtime dependencies of the specification", () => {
        expect(Object.keys(manifest.dependencies).sort()).toEqual([
            "@ngne/core",
            "fast-png",
            "fflate",
            "gifenc",
            "lucide-react",
            "radix-ui",
            "react",
            "react-dom",
            "zustand",
        ]);
        expect(manifest.dependencies["@ngne/core"]).toBe("0.2.1");
    });

    it("pins every dependency to an exact version", () => {
        const all = { ...manifest.dependencies, ...manifest.devDependencies };
        for (const [name, version] of Object.entries(all)) {
            expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
        }
    });
});
