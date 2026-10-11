import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// The import boundary of SPEC §5, checked by linting probe sources at virtual paths.
const eslint = new ESLint();

async function ruleIds(filePath: string, source: string): Promise<string[]> {
    const [result] = await eslint.lintText(source, { filePath });
    return (result?.messages ?? [])
        .filter((message) => message.severity === 2)
        .map((message) => message.ruleId ?? "fatal");
}

describe("import boundaries", () => {
    it("rejects @ngne/core in src/core", async () => {
        expect(await ruleIds("src/core/probe.ts", 'import "@ngne/core";\n')).toEqual([
            "no-restricted-imports",
        ]);
    });

    it("rejects React in src/core", async () => {
        expect(await ruleIds("src/core/probe.ts", 'import "react";\n')).toEqual([
            "no-restricted-imports",
        ]);
    });

    it("rejects imports from app, engine and ui in src/core", async () => {
        for (const layer of ["app", "engine", "ui"]) {
            const source = `import "../../${layer}/x";\n`;
            expect(await ruleIds("src/core/model/probe.ts", source)).toEqual([
                "no-restricted-imports",
            ]);
        }
    });

    it("rejects DOM globals in src/core", async () => {
        for (const source of [
            "export const a = document.body;\n",
            "export const a = window.innerWidth;\n",
            "export const a = new ImageData(1, 1);\n",
            "export const a = navigator.gpu;\n",
        ]) {
            expect(await ruleIds("src/core/probe.ts", source)).toEqual(["no-restricted-globals"]);
        }
    });

    it("allows platform-neutral globals in src/core", async () => {
        const source = "export const a = new Uint8ClampedArray(4);\nexport const b = Math.max;\n";
        expect(await ruleIds("src/core/probe.ts", source)).toEqual([]);
    });

    it("rejects @ngne/core in src/app and src/ui", async () => {
        for (const filePath of ["src/app/probe.ts", "src/ui/probe.tsx"]) {
            expect(await ruleIds(filePath, 'import "@ngne/core";\n')).toEqual([
                "no-restricted-imports",
            ]);
        }
    });

    it("allows @ngne/core in src/engine", async () => {
        expect(await ruleIds("src/engine/probe.ts", 'import "@ngne/core";\n')).toEqual([]);
    });
});
