import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SE-006: tokens of DESIGN §3 as CSS custom properties, and the rule that no other stylesheet
// contains a raw colour value. This file is the "lint/grep check" of the acceptance list; it
// runs inside `npm run check` through `npm run test`.

const ROOT = new URL("../../", import.meta.url);
const TOKENS_FILE = "src/ui/styles/tokens.css";

function read(path: string): string {
    return readFileSync(new URL(path, ROOT), "utf8");
}

function stripComments(css: string): string {
    return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every `property: value;` of a stylesheet, with its line number. */
function declarations(css: string): { property: string; value: string; line: number }[] {
    const text = stripComments(css).replace(/\r/g, "");
    const found = [];
    for (const match of text.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
        found.push({
            property: match[1] ?? "",
            value: (match[2] ?? "").trim(),
            line: text.slice(0, match.index).split("\n").length,
        });
    }
    return found;
}

/** Custom properties declared in the block that follows `selector`. */
function customProperties(css: string, selector: string): Map<string, string> {
    const text = stripComments(css);
    const start = text.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`No block for ${selector}`);
    const block = text.slice(start, text.indexOf("}", start));
    return new Map(
        declarations(`${block};`)
            .filter((declaration) => declaration.property.startsWith("--"))
            .map((declaration) => [declaration.property, declaration.value]),
    );
}

const tokensCss = read(TOKENS_FILE);
const dark = customProperties(tokensCss, ":root");
const light = customProperties(tokensCss, '[data-theme="light"]');

/** The colour table of DESIGN §3.1: token, dark value, light value. */
function designColours(): { token: string; dark: string; light: string }[] {
    const rows = [];
    const row = /^\|\s*`(--[a-z-]+)`\s*\|\s*`(#[0-9a-f]{6})`\s*\|\s*`(#[0-9a-f]{6})`\s*\|/gm;
    for (const match of read("docs/DESIGN.md").matchAll(row)) {
        rows.push({ token: match[1] ?? "", dark: match[2] ?? "", light: match[3] ?? "" });
    }
    return rows;
}

describe("design tokens", () => {
    it("defines every colour of DESIGN §3.1 with its dark and light value", () => {
        const rows = designColours();
        expect(rows.map((row) => row.token)).toEqual([
            "--bg-workspace",
            "--bg-panel",
            "--bg-raised",
            "--bg-active",
            "--border",
            "--border-strong",
            "--border-input",
            "--text",
            "--text-muted",
            "--text-faint",
            "--accent",
            "--accent-contrast",
            "--danger",
            "--warn",
        ]);
        for (const row of rows) {
            expect(dark.get(row.token), `${row.token} dark`).toBe(row.dark);
            expect(light.get(row.token), `${row.token} light`).toBe(row.light);
        }
    });

    it("defines the transparency checkerboard of DESIGN §3.1 in both themes", () => {
        expect([dark.get("--check-a"), dark.get("--check-b")]).toEqual(["#3a3a3a", "#4a4a4a"]);
        expect([light.get("--check-a"), light.get("--check-b")]).toEqual(["#c8c8c8", "#ffffff"]);
    });

    it("gives the light theme a value for every colour the dark theme defines", () => {
        const isColour = (value: string) => /^#[0-9a-f]{6}$/.test(value);
        const darkColours = [...dark].filter(([, value]) => isColour(value)).map(([name]) => name);
        expect(darkColours.length).toBeGreaterThanOrEqual(16);
        for (const name of darkColours) expect(light.has(name), name).toBe(true);
    });

    it("defines the type tokens of DESIGN §3.2", () => {
        expect(dark.get("--font-ui")).toBe('Inter, "Segoe UI", system-ui, sans-serif');
        expect(dark.get("--font-size")).toBe("12px");
        expect(dark.get("--font-size-label")).toBe("11px");
        expect(dark.get("--font-size-title")).toBe("13px");
        expect(dark.get("--line-height")).toBe("16px");
        expect(dark.get("--font-weight")).toBe("400");
        expect(dark.get("--font-weight-strong")).toBe("500");
    });

    it("defines the space, shape and motion tokens of DESIGN §3.3", () => {
        for (const step of [2, 4, 8, 12, 16, 24]) {
            expect(dark.get(`--space-${step}`)).toBe(`${step}px`);
        }
        expect(Object.fromEntries(dark)).toMatchObject({
            "--control-height": "24px",
            "--row-height": "28px",
            "--radius-control": "4px",
            "--radius-surface": "6px",
            "--radius-region": "0",
            "--border-width": "1px",
            "--focus-ring-width": "2px",
            "--focus-ring-offset": "1px",
            "--elevation": "0 8px 24px rgb(0 0 0 / 0.4)",
            "--motion-fast": "100ms",
            "--motion-surface": "120ms",
            "--motion-ease": "ease-out",
            "--surface-fade": "ui-fade-in var(--motion-surface) var(--motion-ease)",
            "--icon-size": "16px",
            "--icon-stroke": "1.5px",
        });
    });

    it("turns transitions and the surface fade off under prefers-reduced-motion", () => {
        const reduced = stripComments(tokensCss).split("prefers-reduced-motion: reduce")[1] ?? "";
        expect(reduced).toMatch(/--motion-fast:\s*0ms/);
        expect(reduced).toMatch(/--motion-surface:\s*0ms/);
        // `none`, not a 0 ms animation: Chrome fires no animation events for the latter, and
        // Radix then keeps a closed popover mounted while it waits for the animation to end.
        expect(reduced).toMatch(/--surface-fade:\s*none/);
    });
});

function luminance(hex: string): number {
    const channel = (offset: number) => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
    const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
    return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

describe("token contrast (DESIGN §3.1, WCAG 2.1 AA)", () => {
    for (const [theme, tokens] of [
        ["dark", dark],
        ["light", light],
    ] as const) {
        const colour = (name: string) => tokens.get(name) ?? "";
        const backgrounds = ["--bg-workspace", "--bg-panel", "--bg-raised", "--bg-active"];

        it(`${theme}: --text and --text-muted reach 4.5:1 on every background`, () => {
            for (const text of ["--text", "--text-muted"]) {
                for (const background of backgrounds) {
                    expect(
                        contrast(colour(text), colour(background)),
                        `${text} on ${background}`,
                    ).toBeGreaterThanOrEqual(4.5);
                }
            }
        });

        it(`${theme}: accent, warn, danger and input border meet their ratios`, () => {
            expect(
                contrast(colour("--accent-contrast"), colour("--accent")),
            ).toBeGreaterThanOrEqual(4.5);
            expect(contrast(colour("--warn"), colour("--bg-panel"))).toBeGreaterThanOrEqual(4.5);
            expect(contrast(colour("--danger"), colour("--bg-panel"))).toBeGreaterThanOrEqual(4.5);
            expect(
                contrast(colour("--border-input"), colour("--bg-raised")),
            ).toBeGreaterThanOrEqual(3);
        });
    }
});

// --- Token lint -------------------------------------------------------------------------

const NAMED_COLOURS =
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen";
const SYSTEM_COLOURS =
    "accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext";

const RAW_COLOUR_PATTERNS: readonly RegExp[] = [
    /#[0-9a-f]{3,8}(?![\w-])/i,
    /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\s*\(/i,
    new RegExp(
        `(?<![\\w-])(?:${`${NAMED_COLOURS} ${SYSTEM_COLOURS}`.split(" ").join("|")})(?![\\w-])`,
        "i",
    ),
];

/** The raw colour inside a declaration value, or null. Tokens and keywords are not raw. */
function rawColour(value: string): string | null {
    const withoutTokens = value.replace(/var\(\s*--[\w-]+\s*\)/g, "");
    for (const pattern of RAW_COLOUR_PATTERNS) {
        const match = pattern.exec(withoutTokens);
        if (match) return match[0];
    }
    return null;
}

function stylesheets(): string[] {
    return readdirSync(new URL("src/", ROOT), { recursive: true, encoding: "utf8" })
        .map((path) => `src/${path.replaceAll("\\", "/")}`)
        .filter((path) => path.endsWith(".css"))
        .sort();
}

describe("token lint", () => {
    it("recognises raw colour values", () => {
        for (const value of [
            "#fff",
            "#0f0f10",
            "1px solid #2a2a2e80",
            "rgb(0 0 0 / 0.4)",
            "rgba(255, 255, 255, 0.12)",
            "hsl(200 50% 50%)",
            "oklch(0.7 0.1 200)",
            "color-mix(in srgb, var(--accent) 20%, transparent)",
            "1px solid red",
            "White",
            "linear-gradient(to right, black, transparent)",
            "CanvasText",
        ]) {
            expect(rawColour(value), value).not.toBeNull();
        }
    });

    it("accepts tokens and colour keywords that carry no colour", () => {
        for (const value of [
            "var(--text)",
            "var(--border-width) solid var(--border-strong)",
            "transparent",
            "currentColor",
            "inherit",
            "none",
            "background-color var(--motion-fast) var(--motion-ease)",
            "ui-fade-in var(--motion-surface) var(--motion-ease)",
            "var(--border-strong) transparent",
            "brightness(1.1)",
        ]) {
            expect(rawColour(value), value).toBeNull();
        }
    });

    it("finds the component stylesheets", () => {
        const files = stylesheets();
        expect(files).toContain(TOKENS_FILE);
        expect(files).toContain("src/ui/shell/shell.css");
        expect(files).toContain("src/ui/primitives/button.css");
        expect(files.length).toBeGreaterThan(10);
    });

    it("finds no raw colour value in any stylesheet other than the token file", () => {
        const offences = [];
        for (const file of stylesheets()) {
            if (file === TOKENS_FILE) continue;
            for (const { property, value, line } of declarations(read(file))) {
                const raw = rawColour(value);
                if (raw) offences.push(`${file}:${line} ${property}: ${value} (${raw})`);
            }
        }
        expect(offences).toEqual([]);
    });

    it("uses only custom properties that the token file or the component itself defines", () => {
        // Set at run time: shell sizes by AppShell, popper geometry by Radix.
        const runtime = /^--(shell|radix)-/;
        const unknown = [];
        for (const file of stylesheets()) {
            for (const { value, line } of declarations(read(file))) {
                for (const match of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
                    const name = match[1] ?? "";
                    if (!dark.has(name) && !runtime.test(name)) {
                        unknown.push(`${file}:${line} ${name}`);
                    }
                }
            }
        }
        expect(unknown).toEqual([]);
    });
});
