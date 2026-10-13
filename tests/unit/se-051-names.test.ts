import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    MAX_ATLAS_ID_LENGTH,
    MAX_SLUG_LENGTH,
    animationIds,
    bundle,
    bundleFileNames,
    exportIdentifiers,
    exportName,
    isAtlasId,
} from "../../src/core/export";
import { frameId } from "../../src/core/export/names";
import { exportSettings, grid, sprite, textOf } from "./se-051-support";

// The names of an export (SPEC §9.1, §9.3, §9.5). The rule of a slug, stated once in
// names.ts: A–Z become a–z and nothing else is mapped; every run of other characters than
// a–z and 0–9 becomes one "-"; a "-" at either end goes; the result is cut to 64 characters
// and a "-" the cut leaves goes too.

/** A document whose tags have these names, in this order. */
function tagged(...names: string[]) {
    return sprite({
        name: "Sprite",
        frames: [grid("A"), grid("B")],
        tags: names.map((name) => ({ name, from: 0, to: 1 })),
    });
}

function ids(...names: string[]): string[] {
    return animationIds(tagged(...names)).map((animation) => animation.id);
}

describe("exportName", { timeout: 60_000 }, () => {
    it("gives the names of the ticket", () => {
        expect(exportName("Hero Walk")).toBe("hero-walk");
        expect(exportName("2d-hero")).toBe("2d-hero");
        expect(exportName("★★")).toBe("sprite");
    });

    it.each([
        // Runs collapse and the edges are trimmed.
        ["  --Hero__Walk!!  ", "hero-walk"],
        ["hero.walk.png", "hero-walk-png"],
        ["Hero   Walk", "hero-walk"],
        ["HERO", "hero"],
        ["hero-", "hero"],
        ["-hero", "hero"],
        ["a", "a"],
        ["7", "7"],
        ["Level 01 (final) v2", "level-01-final-v2"],
        // Nothing is left.
        ["", "sprite"],
        ["   ", "sprite"],
        ["---", "sprite"],
        ["日本語", "sprite"],
        ["🙂", "sprite"],
    ])("%j gives %j", (name, slug) => {
        expect(exportName(name)).toBe(slug);
    });

    it("maps the letters A–Z and no other character", () => {
        // An accented letter is not its base letter: Ü n ï c ö d é ␠ N à m e.
        expect(exportName("Ünïcödé Nàme")).toBe("n-c-d-n-me");
        // The Kelvin sign and the dotted capital I have lower-case forms in Unicode ("k",
        // "i" with a dot above); a slug does not use them.
        expect("\u212A".toLowerCase()).toBe("k");
        expect(exportName("\u212Aelvin")).toBe("elvin");
        expect(exportName("\u0130stanbul")).toBe("stanbul");
        // Full-width letters and digits are not ASCII.
        expect(exportName("ＨＥＲＯ１")).toBe("sprite");
        // A character outside the Basic Multilingual Plane is one run.
        expect(exportName("hero🙂🙂walk")).toBe("hero-walk");
        expect(exportName("a\u0301b")).toBe("a-b");
    });

    it("lets nothing of a hostile name through", () => {
        expect(exportName("../../etc/passwd")).toBe("etc-passwd");
        expect(exportName("C:\\Windows\\System32")).toBe("c-windows-system32");
        expect(exportName("*/ alert(1) //")).toBe("alert-1");
        expect(exportName('"; DROP TABLE sprites; --')).toBe("drop-table-sprites");
        expect(exportName("a\nb\r\nc\td\0e")).toBe("a-b-c-d-e");
        expect(exportName("${name}`<script>")).toBe("name-script");
        expect(exportName("__proto__")).toBe("proto");
        expect(exportName("hero.sprites.ts")).toBe("hero-sprites-ts");
    });

    it("cuts a long name to 64 characters and leaves no hyphen at the cut", () => {
        expect(MAX_SLUG_LENGTH).toBe(64);
        expect(exportName("a".repeat(300))).toBe("a".repeat(64));
        // "abc-" 16 times is 64 characters, the last a hyphen: it goes, 63 are left.
        const cut = exportName("abc ".repeat(40));
        expect(cut).toBe(`${"abc-".repeat(15)}abc`);
        expect(cut).toHaveLength(63);
        // A name of exactly 64 and of 65 characters.
        expect(exportName("b".repeat(64))).toHaveLength(64);
        expect(exportName("b".repeat(65))).toHaveLength(64);
        // What lies behind the cut does not matter.
        expect(exportName(`${"c".repeat(64)}★ tail`)).toBe("c".repeat(64));
    });

    it("keeps clear of the device names of Windows", () => {
        for (const name of ["con", "PRN", "Aux", "nul", "COM1", "com0", "lpt9", " NUL "]) {
            expect(exportName(name), name).toBe(`${name.trim().toLowerCase()}-sprite`);
        }
        // Only the whole name counts.
        for (const name of ["console", "com10", "lpt", "com", "nul-2", "a-con", "con1"]) {
            expect(exportName(name), name).toBe(name);
        }
        expect(exportName("nul.txt")).toBe("nul-txt");
    });

    it("always gives a slug: [a-z0-9][a-z0-9-]*, at most 64 characters, no hyphen twice or last", () => {
        const names = fc.oneof(
            fc.string({ maxLength: 120 }),
            fc.string({ unit: "binary", maxLength: 120 }),
            fc.string({
                unit: fc.constantFrom("a", "Z", "9", "-", "_", " ", ".", "é"),
                maxLength: 120,
            }),
        );
        fc.assert(
            fc.property(names, (name) => {
                const slug = exportName(name);
                expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
                expect(slug.length).toBeLessThanOrEqual(64);
                expect(slug).not.toContain("--");
                expect(slug.endsWith("-")).toBe(false);
                // A slug is its own slug.
                expect(exportName(slug)).toBe(slug);
            }),
            { numRuns: 1000 },
        );
    });

    it("gives one slug to names that differ only by the case of A–Z", () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 60 }), (name) => {
                const upper = name.replace(/[a-z]/g, (letter) => letter.toUpperCase());
                expect(exportName(upper)).toBe(exportName(name));
            }),
            { numRuns: 500 },
        );
    });
});

describe("exportIdentifiers", { timeout: 60_000 }, () => {
    it("gives the identifiers of the ticket", () => {
        expect(exportIdentifiers("Hero Walk")).toEqual({ camel: "heroWalk", pascal: "HeroWalk" });
        expect(exportIdentifiers("2d-hero")).toEqual({
            camel: "sprite2dHero",
            pascal: "Sprite2dHero",
        });
        expect(exportIdentifiers("★★")).toEqual({ camel: "sprite", pascal: "Sprite" });
    });

    it.each([
        ["hero", "hero", "Hero"],
        ["hero-walk", "heroWalk", "HeroWalk"],
        ["Hero Walk Cycle", "heroWalkCycle", "HeroWalkCycle"],
        // A part that starts with a digit has no letter to raise.
        ["hero 2d", "hero2d", "Hero2d"],
        ["a-1-b", "a1B", "A1B"],
        ["x", "x", "X"],
        // A leading digit gets `sprite` in front.
        ["123", "sprite123", "Sprite123"],
        ["7 up", "sprite7Up", "Sprite7Up"],
        // Reserved words are parts like any other: no identifier is one of them alone.
        ["class", "class", "Class"],
        ["new", "new", "New"],
        // The device-name suffix is part of the name.
        ["con", "conSprite", "ConSprite"],
    ])("%j gives %s and %s", (name, camel, pascal) => {
        expect(exportIdentifiers(name)).toEqual({ camel, pascal });
    });

    it("always gives identifiers of ASCII letters and digits", () => {
        fc.assert(
            fc.property(fc.string({ unit: "binary", maxLength: 120 }), (name) => {
                const { camel, pascal } = exportIdentifiers(name);
                expect(camel).toMatch(/^[a-z][A-Za-z0-9]*$/);
                expect(pascal).toBe(camel.charAt(0).toUpperCase() + camel.slice(1));
                // At most the 64 characters of the slug and the 6 of `sprite`.
                expect(camel.length).toBeLessThanOrEqual(70);
            }),
            { numRuns: 500 },
        );
    });

    it("of a slug are those of the name it came from", () => {
        for (const name of ["Hero Walk", "2d-hero", "★★", "con", "a".repeat(200)]) {
            expect(exportIdentifiers(exportName(name)), name).toEqual(exportIdentifiers(name));
        }
    });
});

describe("animationIds", { timeout: 60_000 }, () => {
    it("gives each tag the slug of its name", () => {
        expect(animationIds(tagged("Walk", "Turn Around", "idle_2"))).toEqual([
            { tagId: "tag-0", slug: "walk", id: "walk" },
            { tagId: "tag-1", slug: "turn-around", id: "turn-around" },
            { tagId: "tag-2", slug: "idle-2", id: "idle-2" },
        ]);
    });

    it("numbers the tags of one slug from -2, in the order of the tags", () => {
        expect(ids("walk", "walk", "walk")).toEqual(["walk", "walk-2", "walk-3"]);
        expect(ids("run", "walk", "run", "walk", "run")).toEqual([
            "run",
            "walk",
            "run-2",
            "walk-2",
            "run-3",
        ]);
    });

    it("treats names that differ only by case, or by what a slug drops, as one", () => {
        expect(ids("Walk", "walk", "WALK!")).toEqual(["walk", "walk-2", "walk-3"]);
        expect(ids("Turn Around", "turn_around", "turn--around")).toEqual([
            "turn-around",
            "turn-around-2",
            "turn-around-3",
        ]);
        const renamed = animationIds(tagged("Walk", "walk")).filter(({ slug, id }) => slug !== id);
        expect(renamed).toEqual([{ tagId: "tag-1", slug: "walk", id: "walk-2" }]);
    });

    it("skips a suffix another tag has taken by its own name", () => {
        // The third tag cannot be `walk-2`: the second is called that.
        expect(ids("walk", "walk-2", "walk")).toEqual(["walk", "walk-2", "walk-3"]);
        // A tag called `walk-2` after two `walk` tags finds its slug taken.
        expect(ids("walk", "walk", "walk-2")).toEqual(["walk", "walk-2", "walk-2-2"]);
        expect(ids("walk-2", "walk", "walk")).toEqual(["walk-2", "walk", "walk-3"]);
    });

    it("calls a tag whose name leaves nothing `tag`", () => {
        expect(ids("", "★", "   ", "tag")).toEqual(["tag", "tag-2", "tag-3", "tag-4"]);
    });

    it("cuts a long name like any slug, before the suffix", () => {
        const [first, second] = ids("w".repeat(200), "w".repeat(300));
        expect(first).toBe("w".repeat(64));
        expect(second).toBe(`${"w".repeat(64)}-2`);
        expect(isAtlasId(second)).toBe(true);
    });

    it("does not treat a tag as a file: device names stay", () => {
        expect(ids("con", "nul")).toEqual(["con", "nul"]);
    });

    it("is empty for a document without tags, and leaves the document as it is", () => {
        expect(animationIds(tagged())).toEqual([]);
        const doc = tagged("Walk", "walk");
        const before = structuredClone(doc.tags);
        animationIds(doc);
        expect(doc.tags).toEqual(before);
    });

    it("gives every tag an ID of its own that is an atlas ID, whatever the names", () => {
        const names = fc.array(
            fc.oneof(
                fc.constantFrom(
                    "walk",
                    "Walk",
                    "WALK",
                    "walk-2",
                    "walk 2",
                    "walk-3",
                    "",
                    "★",
                    "tag",
                    "tag-2",
                ),
                fc.string({ unit: "binary", maxLength: 80 }),
            ),
            { maxLength: 40 },
        );
        fc.assert(
            fc.property(names, (list) => {
                const result = animationIds(tagged(...list));
                expect(result.map((animation) => animation.tagId)).toEqual(
                    list.map((_, i) => `tag-${i}`),
                );
                expect(new Set(result.map((animation) => animation.id)).size).toBe(list.length);
                const seen = new Set<string>();
                for (const { slug, id } of result) {
                    expect(isAtlasId(id)).toBe(true);
                    expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
                    // The first tag of a slug keeps it, unless an earlier ID is that slug.
                    if (id !== slug) expect(seen.has(slug)).toBe(true);
                    else expect(seen.has(slug)).toBe(false);
                    expect(id === slug || /^-[1-9][0-9]*$/.test(id.slice(slug.length))).toBe(true);
                    seen.add(id);
                }
            }),
            { numRuns: 300 },
        );
    });

    it("numbers a thousand tags of one name without delay", () => {
        const result = ids(...new Array<string>(1024).fill("walk"));
        expect(result[0]).toBe("walk");
        expect(result[1023]).toBe("walk-1024");
        expect(new Set(result).size).toBe(1024);
    });
});

describe("isAtlasId", () => {
    it("accepts 1 to 80 characters of a-z, 0-9, _ and -, the first a letter or a digit", () => {
        expect(MAX_ATLAS_ID_LENGTH).toBe(80);
        for (const id of [
            "a",
            "0",
            "hero-0",
            "hero_walk",
            "2d-hero-12",
            "a-",
            "a_",
            "a--b",
            "x".repeat(80),
        ]) {
            expect(isAtlasId(id), id).toBe(true);
        }
    });

    it("refuses everything else", () => {
        const refused: unknown[] = [
            "",
            "-a",
            "_a",
            "A",
            "Hero-0",
            "hero 0",
            "hero.0",
            "héro",
            "hero/0",
            "a\n",
            "\na",
            "__proto__",
            "x".repeat(81),
            0,
            null,
            undefined,
            {},
            ["a"],
            true,
        ];
        for (const value of refused) {
            expect(isAtlasId(value), JSON.stringify(value)).toBe(false);
        }
    });

    it("holds for every frame ID and animation ID the writer makes", () => {
        // The longest: a name of 64 characters with the index of the last of 65 536 frames.
        const longest = frameId(exportName("n".repeat(100)), 65_535);
        expect(longest).toHaveLength(64 + 1 + 5);
        expect(isAtlasId(longest)).toBe(true);
        expect(frameId("hero-walk", 0)).toBe("hero-walk-0");
        expect(frameId("2d", 12)).toBe("2d-12");
    });
});

describe("bundleFileNames", () => {
    const all = { spritesTs: true, previewConfig: true, asepriteJson: "array" } as const;

    it("lists the files of SPEC §9.1 in its order", () => {
        expect(bundleFileNames("Hero Walk", all)).toEqual([
            "hero-walk.png",
            "hero-walk.atlas.json",
            "hero-walk.sprites.ts",
            "hero-walk.preview.config.mjs",
            "hero-walk.aseprite.json",
        ]);
    });

    it("leaves out what is switched off", () => {
        const none = { spritesTs: false, previewConfig: false, asepriteJson: "none" } as const;
        expect(bundleFileNames("hero", none)).toEqual(["hero.png", "hero.atlas.json"]);
        expect(bundleFileNames("hero", exportSettings().files)).toEqual([
            "hero.png",
            "hero.atlas.json",
            "hero.sprites.ts",
            "hero.preview.config.mjs",
        ]);
        expect(bundleFileNames("hero", { ...none, asepriteJson: "hash" })).toEqual([
            "hero.png",
            "hero.atlas.json",
            "hero.aseprite.json",
        ]);
        expect(bundleFileNames("hero", { ...none, previewConfig: true })[2]).toBe(
            "hero.preview.config.mjs",
        );
    });

    it("names the files that bundle writes, for every choice of files", () => {
        for (const spritesTs of [true, false]) {
            for (const previewConfig of [true, false]) {
                for (const asepriteJson of ["none", "array", "hash"] as const) {
                    const files = { spritesTs, previewConfig, asepriteJson };
                    const doc = sprite({
                        name: "../Ünï ★ CON",
                        frames: [grid("A")],
                        settings: { files },
                    });
                    const written = bundle(doc).files.map((file) => file.name);

                    expect(written).toEqual(bundleFileNames(doc.name, files));
                    for (const name of written) expect(name).toMatch(/^n-con\.[a-z.]+$/);
                }
            }
        }
    });

    it("gives no file a name Windows keeps for a device", () => {
        expect(bundleFileNames("NUL", all)).toEqual([
            "nul-sprite.png",
            "nul-sprite.atlas.json",
            "nul-sprite.sprites.ts",
            "nul-sprite.preview.config.mjs",
            "nul-sprite.aseprite.json",
        ]);
    });
});

describe("a bundle of a document with any names", { timeout: 60_000 }, () => {
    const names = fc.oneof(
        fc.string({ unit: "binary", maxLength: 40 }),
        fc.constantFrom("class", "con", "__proto__", "*/", "</script>", "a\nb", "${x}", "", "0"),
    );

    it("takes nothing of the names into its files but slugs and identifiers", () => {
        fc.assert(
            fc.property(names, fc.array(names, { maxLength: 4 }), (name, tags) => {
                const doc = sprite({
                    name,
                    frames: [grid("AB", "CD"), grid("EF", "GH")],
                    tags: tags.map((tag) => ({ name: tag, from: 0, to: 1 })),
                    settings: { files: { asepriteJson: "array" } },
                });
                const made = bundle(doc);
                const slug = exportName(name);
                const { camel, pascal } = exportIdentifiers(name);

                expect(made.files.map((file) => file.name)).toEqual(
                    bundleFileNames(name, doc.exportSettings.files),
                );
                for (const file of made.files) {
                    expect(file.name.startsWith(`${slug}.`)).toBe(true);
                    expect(file.name).toMatch(/^[a-z0-9][a-z0-9-]*\.[a-z.]+$/);
                }
                const ids = [
                    ...Object.keys(made.meta.frames),
                    ...Object.keys(made.meta.animations),
                ];
                expect(ids).toHaveLength(2 + tags.length + (tags.length === 0 ? 1 : 0));
                for (const id of ids) expect(isAtlasId(id)).toBe(true);
                expect(Object.keys(made.meta.frames)).toEqual([`${slug}-0`, `${slug}-1`]);
                // Every text file is printable ASCII and line feeds: no character of a name
                // that could end a string, a comment or a line is in it.
                for (const file of made.files.slice(1)) {
                    expect(
                        file.bytes.every((byte) => byte === 10 || (byte >= 32 && byte <= 126)),
                    ).toBe(true);
                }
                // The module declares the identifiers of the name, and the image by its slug.
                const module = textOf(made, ".sprites.ts");
                expect(module).toContain(
                    `export const ${camel}Image: ImageAsset = imageAsset(\n    "${slug}",\n` +
                        `    new URL("./${slug}.png", import.meta.url).href,\n);\n`,
                );
                expect(module).toContain(`export function draw${pascal}(\n`);
                expect(module).toContain(
                    `export type ${pascal}FrameId = keyof typeof ${camel}Atlas.frames;`,
                );
            }),
            { numRuns: 200 },
        );
    });
});
