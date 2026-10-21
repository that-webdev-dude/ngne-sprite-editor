import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SE-071: no ad-hoc spacing. The margins, paddings and gaps of every stylesheet are made of
// tokens (DESIGN §3.3: the spacing scale, border and focus ring widths, control heights):
// once the tokens are taken out of a value, no length is left in it. Sizes and offsets that
// place a mark (a dot centred in a swatch, a thumb on its strip) are geometry, not spacing,
// and are not checked here. The token file defines the tokens and is left out.

const ROOT = new URL("../../", import.meta.url);
const TOKENS_FILE = "src/ui/styles/tokens.css";
const SPACING = /^(margin|padding|gap|row-gap|column-gap)(-|$)/;
const LENGTH = /(?<![\w-])-?(\d+\.?\d*|\.\d+)(px|r?em|ch|ex|vh|vw|vmin|vmax|%)/;

function stylesheets(): string[] {
    return readdirSync(new URL("src/", ROOT), { recursive: true, encoding: "utf8" })
        .map((path) => `src/${path.replaceAll("\\", "/")}`)
        .filter((path) => path.endsWith(".css"))
        .sort();
}

/** Every `property: value;` of a stylesheet, with its line number. */
function declarations(css: string): { property: string; value: string; line: number }[] {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
    return [...text.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)].map((match) => ({
        property: match[1] ?? "",
        value: (match[2] ?? "").trim(),
        line: text.slice(0, match.index).split("\n").length,
    }));
}

/** The length left in a spacing value once its tokens are taken out, or null. */
function rawLength(value: string): string | null {
    return LENGTH.exec(value.replace(/var\(\s*--[\w-]+\s*\)/g, ""))?.[0] ?? null;
}

describe("spacing lint", () => {
    it("recognises lengths that are not tokens", () => {
        for (const value of ["6px", "0 7px", "var(--space-4) 3px", "-1px", "1.5em", "50%"]) {
            expect(rawLength(value), value).not.toBeNull();
        }
        for (const value of [
            "0",
            "auto",
            "var(--space-8)",
            "0 var(--space-12)",
            "calc(-1 * var(--border-width))",
            "calc(var(--focus-ring-width) + var(--focus-ring-offset))",
            "calc((var(--control-height) - var(--slider-thumb-size)) / 2)",
        ]) {
            expect(rawLength(value), value).toBeNull();
        }
    });

    it("finds no margin, padding or gap outside the tokens in any stylesheet", () => {
        const files = stylesheets().filter((file) => file !== TOKENS_FILE);
        expect(files.length).toBeGreaterThan(10);
        const offences = [];
        for (const file of files) {
            const css = readFileSync(new URL(file, ROOT), "utf8");
            for (const { property, value, line } of declarations(css)) {
                if (!SPACING.test(property)) continue;
                const raw = rawLength(value);
                if (raw) offences.push(`${file}:${line} ${property}: ${value} (${raw})`);
            }
        }
        expect(offences).toEqual([]);
    });
});
