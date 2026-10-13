import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Frame } from "@ngne/core";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import {
    animationDone,
    animationFrame,
    bundle,
    spriteAt,
    spriteAtTopLeft,
} from "../../src/core/export";
import { RUNTIME_BEGIN, RUNTIME_END, runtimeText } from "../../src/core/export/spritesModule";
import {
    CONSUMER_OPTIONS,
    compile,
    grid,
    heroWalk,
    ngneFrame,
    sprite,
    textOf,
} from "./se-051-support";

// `<name>.sprites.ts` (SPEC §9.5): the sprite runtime is in it as text, byte for byte; it
// compiles against the installed `@ngne/core` under the consumer's flags, whatever the
// document is called; and, run against NGNE's own `Frame`, it draws what the runtime draws.

/**
 * The forms of the identifiers a generated module declares, for any document name
 * (`exportIdentifiers`): `<name>Image`, `<name>Atlas`, `<name>AnimationFrame`,
 * `<name>AnimationDone`; `draw<Name>` and `draw<Name>TopLeft`; and the types `<Name>FrameId`
 * and `<Name>AnimationId`. `<name>` starts with a lower-case letter, `<Name>` with an
 * upper-case one, and both are made of ASCII letters and digits.
 */
const GENERATED_FORMS = [
    /^[a-z][A-Za-z0-9]*(?:Image|Atlas|AnimationFrame|AnimationDone)$/,
    /^draw[A-Z][A-Za-z0-9]*$/,
    /^[A-Z][A-Za-z0-9]*(?:FrameId|AnimationId)$/,
];

/** Whether some document name gives a generated module this identifier. */
function isGeneratedIdentifier(identifier: string): boolean {
    return GENERATED_FORMS.some((form) => form.test(identifier));
}

const RUNTIME_FILE = new URL("../../src/core/export/sprite-runtime.ts", import.meta.url);
const UNIT_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));

/** sprite-runtime.ts as it is on disk. */
const source = readFileSync(RUNTIME_FILE, "utf8");
const lines = source.split("\n");
const begin = lines.indexOf(RUNTIME_BEGIN);
const end = lines.indexOf(RUNTIME_END);
/** The lines between the markers, each with its line feed. */
const between = lines
    .slice(begin + 1, end)
    .map((line) => `${line}\n`)
    .join("");

/** The names a source declares at its top level, and whether a statement is not a declaration. */
function topLevel(text: string): { names: string[]; kinds: string[] } {
    const file = ts.createSourceFile("source.ts", text, ts.ScriptTarget.ES2022, true);
    const names: string[] = [];
    for (const statement of file.statements) {
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                names.push(declaration.name.getText(file));
            }
        } else if (
            ts.isFunctionDeclaration(statement) ||
            ts.isInterfaceDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement) ||
            ts.isClassDeclaration(statement) ||
            ts.isEnumDeclaration(statement)
        ) {
            names.push(statement.name?.getText(file) ?? "");
        }
    }
    return { names, kinds: file.statements.map((statement) => ts.SyntaxKind[statement.kind]) };
}

/** The text of `<name>.sprites.ts` of a one-frame document called `name`. */
function moduleOf(name: string): { file: string; text: string } {
    const made = bundle(sprite({ name, frames: [grid("AB", "CD")] }));
    return { file: made.files[2].name, text: textOf(made, ".sprites.ts") };
}

describe("the sprite runtime in a generated module", () => {
    it("sprite-runtime.ts has its two marker lines, once each and in order", () => {
        expect(RUNTIME_BEGIN).toBe("// sprite-runtime:begin");
        expect(RUNTIME_END).toBe("// sprite-runtime:end");
        expect(lines.filter((line) => line === RUNTIME_BEGIN)).toHaveLength(1);
        expect(lines.filter((line) => line === RUNTIME_END)).toHaveLength(1);
        expect(begin).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(begin + 100);
        // The file is checked out with line feeds (.gitattributes).
        expect(source).not.toContain("\r");
    });

    it("the text emitted into <name>.sprites.ts is byte-identical to the lines between them", () => {
        const text = textOf(bundle(heroWalk()), ".sprites.ts");

        expect(runtimeText()).toBe(between);
        expect(text.endsWith(between)).toBe(true);
        // Once: nothing of it is in the head of the module.
        expect(text.indexOf(between)).toBe(text.length - between.length);
        expect(
            Buffer.from(text, "utf8").subarray(-Buffer.byteLength(between)).toString("utf8"),
        ).toBe(between);
        // Every module carries the same text, whatever the document.
        expect(moduleOf("Another Sprite").text.endsWith(between)).toBe(true);
    });

    it("what the markers leave out is the head comment and the export lines", () => {
        const head = lines.slice(0, begin);
        const tail = lines.slice(end + 1).join("\n");

        expect(head.every((line) => line === "" || line.startsWith("//"))).toBe(true);
        // Below the end marker: export declarations of names declared above, and nothing else.
        expect(topLevel(tail).kinds).toEqual(["ExportDeclaration", "ExportDeclaration"]);
        expect(tail).toContain(
            "export { animationDone, animationFrame, spriteAt, spriteAtTopLeft };",
        );
        expect(source).not.toMatch(/^import /m);
    });

    it("the lines between the markers import and export nothing", () => {
        const file = ts.createSourceFile("runtime.ts", between, ts.ScriptTarget.ES2022, true);

        expect(file.statements.length).toBeGreaterThan(10);
        for (const statement of file.statements) {
            const start = statement.getText(file).slice(0, 40);
            // Declarations only: interfaces, functions and one constant.
            const declares =
                ts.isInterfaceDeclaration(statement) ||
                ts.isFunctionDeclaration(statement) ||
                ts.isVariableStatement(statement);
            expect(declares, start).toBe(true);
            const modifiers = ts.canHaveModifiers(statement)
                ? ts.getModifiers(statement)
                : undefined;
            expect(modifiers ?? [], start).toEqual([]);
        }
        expect(between).not.toMatch(/\bimport\b|\bexport\b|\brequire\b/);
    });

    it("the text is found whatever the line ends of the checkout", () => {
        const windows = source.replaceAll("\n", "\r\n");
        expect(runtimeText(windows)).toBe(between);
        expect(runtimeText(source.replaceAll("\n", "\r"))).toBe(between);
    });

    it("a source without the markers in order is refused", () => {
        expect(() => runtimeText("const a = 1;\n")).toThrow(/marker lines/);
        expect(() => runtimeText(`${RUNTIME_END}\nconst a = 1;\n${RUNTIME_BEGIN}\n`)).toThrow(
            /marker lines/,
        );
        expect(() => runtimeText(`${RUNTIME_BEGIN}\nconst a = 1;\n`)).toThrow(/marker lines/);
        expect(runtimeText(`${RUNTIME_BEGIN}\nconst a = 1;\n${RUNTIME_END}\n`)).toBe(
            "const a = 1;\n",
        );
    });

    it("is ASCII, comments included", () => {
        expect(between).toMatch(/^[\n\x20-\x7e]*$/);
    });
});

describe("the identifiers of a generated module", () => {
    /** The names a module exports, read from its text. */
    function exported(text: string): string[] {
        const file = ts.createSourceFile("module.ts", text, ts.ScriptTarget.ES2022, true);
        return file.statements
            .filter(
                (statement) =>
                    ts.canHaveModifiers(statement) &&
                    ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
            )
            .flatMap((statement) => topLevel(statement.getText(file)).names);
    }

    it("are the eight of SPEC §9.5 for the fixture", () => {
        expect(exported(textOf(bundle(heroWalk()), ".sprites.ts"))).toEqual([
            "heroWalkImage",
            "heroWalkAtlas",
            "HeroWalkFrameId",
            "HeroWalkAnimationId",
            "drawHeroWalk",
            "drawHeroWalkTopLeft",
            "heroWalkAnimationFrame",
            "heroWalkAnimationDone",
        ]);
    });

    it("all have a generated form, for any name", () => {
        for (const name of ["Hero Walk", "2d-hero", "★★", "class", "frame", "x", "A1 b2"]) {
            const names = exported(moduleOf(name).text);
            expect(names, name).toHaveLength(8);
            expect(
                names.filter((identifier) => !isGeneratedIdentifier(identifier)),
                name,
            ).toEqual([]);
        }
    });

    it("no top-level name of the runtime has a generated form", () => {
        const { names } = topLevel(between);

        expect(names).toContain("spriteAt");
        expect(names).toContain("animationFrame");
        expect(names).toContain("SpriteAtlas");
        expect(names.length).toBeGreaterThan(10);
        expect(names.filter(isGeneratedIdentifier)).toEqual([]);
        // Nor has what the module imports from the engine.
        for (const imported of ["imageAsset", "Frame", "ImageAsset"]) {
            expect(isGeneratedIdentifier(imported), imported).toBe(false);
        }
    });

    it("the check sees a name that would clash", () => {
        // What the runtime's functions must not be called: the module of a document named
        // "Frame" declares `drawFrame`, that of "Sprite" `spriteAtlas`.
        for (const taken of [
            "drawFrame",
            "drawSprite",
            "spriteAtlas",
            "frameImage",
            "SpriteFrameId",
        ]) {
            expect(isGeneratedIdentifier(taken), taken).toBe(true);
        }
        expect(exported(moduleOf("Frame").text)).toContain("drawFrame");
        expect(exported(moduleOf("★").text)).toContain("spriteAtlas");
    });
});

/** A consumer of the fixture's module: every export, with the engine's own types. */
const CONSUMER = `import { Camera, Frame } from "@ngne/core";
import type { ImageAsset } from "@ngne/core";
import {
    drawHeroWalk,
    drawHeroWalkTopLeft,
    heroWalkAnimationDone,
    heroWalkAnimationFrame,
    heroWalkAtlas,
    heroWalkImage,
} from "./hero-walk.sprites";
import type { HeroWalkAnimationId, HeroWalkFrameId } from "./hero-walk.sprites";

const frame = new Frame();
frame.scene(new Camera(), 1);
const shown: HeroWalkFrameId = heroWalkAnimationFrame("turn-around", 250);
drawHeroWalk(frame, shown, 10, 20);
drawHeroWalk(frame, "hero-walk-4", 10, 20, {
    rotation: Math.PI / 2,
    scale: 2,
    flipX: true,
    flipY: false,
    layer: 1,
    depth: 2,
    alpha: 0.5,
    color: 0xff8800,
    screen: true,
});
drawHeroWalkTopLeft(frame, "hero-walk-0", 0, 0, { scale: 3 });

export const assets: readonly ImageAsset[] = [heroWalkImage];
export const done: boolean = heroWalkAnimationDone("walk-2", 131072);
export const animation: HeroWalkAnimationId = "walk";
// The data is \`as const\`: its values are known to the compiler.
export const width: 22 = heroWalkAtlas.width;
export const offset: 2 = heroWalkAtlas.frames["hero-walk-1"].offsetX;
`;

/** Lines the compiler must refuse: each is preceded by `@ts-expect-error` in the test. */
const REFUSED = [
    'drawHeroWalk(frame, "hero-walk-6", 0, 0);',
    'drawHeroWalk(frame, "walk", 0, 0);',
    'drawHeroWalkTopLeft(frame, "hero-walk", 0, 0);',
    'heroWalkAnimationFrame("run", 0);',
    'heroWalkAnimationFrame("hero-walk-0", 0);',
    'heroWalkAnimationDone("WALK", 0);',
    'drawHeroWalk(frame, "hero-walk-0", 0, 0, { tint: 1 });',
    'drawHeroWalk(frame, "hero-walk-0", 0, 0, { flipX: 1 });',
    "drawHeroWalk({ sprite: (sprite: { x: string }) => sprite }, shown, 0, 0);",
    'const wrong: "hero-walk-9" = heroWalkAnimationFrame("walk", 0); void wrong;',
];

describe("generated modules under the compiler", { timeout: 300_000 }, () => {
    const hero = textOf(bundle(heroWalk()), ".sprites.ts");

    it("compile against @ngne/core with the flags of SPEC §9.5, for any document name", () => {
        const names = [
            "2d-hero",
            "★★",
            // Reserved words and names of the language.
            "class",
            "new",
            "default",
            "undefined",
            // Names of the runtime's and the engine's own declarations.
            "frame",
            "sprite at",
            "animation",
            "draw options",
            "image asset",
            "draw",
            "con",
            `${"long ".repeat(80)}name`,
        ];
        const sources: Record<string, string> = { "hero-walk.sprites.ts": hero };
        for (const name of names) {
            const { file, text } = moduleOf(name);
            expect(Object.keys(sources), name).not.toContain(file);
            sources[file] = text;
        }
        // A document of one frame has no animation: its animation ID is `never`.
        expect(sources["sprite.sprites.ts"]).toContain('"animations": {}');
        sources["consumer.ts"] =
            CONSUMER + REFUSED.map((line) => `// @ts-expect-error\n${line}\n`).join("");

        expect(CONSUMER_OPTIONS).toMatchObject({
            strict: true,
            verbatimModuleSyntax: true,
            exactOptionalPropertyTypes: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
            skipLibCheck: false,
            types: [],
        });
        expect(compile(UNIT_DIRECTORY, sources)).toEqual([]);
    });

    it("the compiler does refuse what the test above expects it to refuse", () => {
        // The same consumer without the `@ts-expect-error` lines: one error per line.
        const sources = {
            "hero-walk.sprites.ts": hero,
            "consumer.ts": CONSUMER + REFUSED.map((line) => `${line}\n`).join(""),
        };
        const first = CONSUMER.split("\n").length;
        const diagnostics = compile(UNIT_DIRECTORY, sources);

        expect(diagnostics.map((line) => line.replace(/: .*/, ""))).toEqual(
            REFUSED.map((_, index) => `consumer.ts(${first + index})`),
        );
        // And a module that does not use a declaration of the runtime does not compile.
        const unused = {
            "unused.sprites.ts": hero.replace(
                /^export function drawHeroWalkTopLeft[^]*?\n}\n/m,
                "",
            ),
        };
        expect(compile(UNIT_DIRECTORY, unused).join("\n")).toMatch(
            /TS6133 'spriteAtTopLeft' is declared but/,
        );
    });

    it("compile under stricter flags a consumer may add", () => {
        const stricter: ts.CompilerOptions = {
            ...CONSUMER_OPTIONS,
            noUncheckedIndexedAccess: true,
            noPropertyAccessFromIndexSignature: true,
            noImplicitReturns: true,
            noImplicitOverride: true,
            noFallthroughCasesInSwitch: true,
            isolatedModules: true,
            erasableSyntaxOnly: true,
            declaration: true,
            isolatedDeclarations: true,
        };
        const sources = {
            "hero-walk.sprites.ts": hero,
            [moduleOf("★★").file]: moduleOf("★★").text,
        };

        expect(compile(UNIT_DIRECTORY, sources, stricter)).toEqual([]);
    });

    it("checks NGNE's Frame against the sink strictly: a sprite it cannot take is refused", () => {
        // The runtime's own declarations, and three sinks a `Frame` is assigned to. The
        // second hands out a sprite without a size, which `Frame.sprite` cannot take.
        // Declared with a method, as the third is, it passes: the compiler does not compare
        // the parameters of methods strictly. So the sink of the runtime has a property.
        const wrongSprite = 'Pick<SheetSprite, "x" | "y">';
        const source = [
            'import type { Frame } from "@ngne/core";',
            between,
            "declare const frame: Frame;",
            "export const strict: SpriteSink = frame;",
            `interface WrongSink { sprite: (sprite: ${wrongSprite}) => void }`,
            "// @ts-expect-error",
            "export const wrong: WrongSink = frame;",
            `interface LooseSink { sprite(sprite: ${wrongSprite}): void }`,
            "export const loose: LooseSink = frame;",
            "export { animationDone, animationFrame, spriteAt, spriteAtTopLeft };",
            "",
        ].join("\n");

        expect(compile(UNIT_DIRECTORY, { "sink.ts": source })).toEqual([]);
        // Without the expectation, the one error is on the wrong sink.
        const plain = source.replace("// @ts-expect-error\n", "");
        const diagnostics = compile(UNIT_DIRECTORY, { "sink.ts": plain });
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/TS2322 Type 'Frame' is not assignable to type 'WrongSink'/);
    });
});

describe("a generated module, run against NGNE's Frame", { timeout: 60_000 }, () => {
    const directory = mkdtempSync(join(tmpdir(), "se-051-module-"));
    afterAll(() => rmSync(directory, { recursive: true, force: true }));

    interface HeroModule {
        heroWalkImage: { id: string; kind: string };
        heroWalkAtlas: ReturnType<typeof bundle>["meta"];
        drawHeroWalk: (frame: Frame, id: string, x: number, y: number, options?: object) => void;
        drawHeroWalkTopLeft: (
            frame: Frame,
            id: string,
            x: number,
            y: number,
            options?: object,
        ) => void;
        heroWalkAnimationFrame: (animation: string, ageMs: number) => string;
        heroWalkAnimationDone: (animation: string, ageMs: number) => boolean;
    }

    /** The fixture's module as JavaScript, importing the installed engine. */
    async function load(): Promise<HeroModule> {
        const made = bundle(heroWalk());
        const { outputText } = ts.transpileModule(textOf(made, ".sprites.ts"), {
            compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ESNext,
                verbatimModuleSyntax: true,
            },
        });
        const engine = pathToFileURL(
            fileURLToPath(
                new URL("../../node_modules/@ngne/core/dist/engine/index.js", import.meta.url),
            ),
        ).href;
        expect(outputText).toContain('from "@ngne/core"');
        const file = join(directory, "hero-walk.sprites.mjs");
        writeFileSync(file, outputText.replace('from "@ngne/core"', `from "${engine}"`));
        return (await import(pathToFileURL(file).href)) as HeroModule;
    }

    it("defines the image asset under the name of the atlas", async () => {
        const module = await load();

        expect(module.heroWalkImage).toMatchObject({ id: "hero-walk", kind: "image" });
        expect(module.heroWalkAtlas).toEqual(bundle(heroWalk()).meta);
    });

    it("packs the same quads into a Frame as the runtime does as code", async () => {
        const module = await load();
        const { meta } = bundle(heroWalk());
        const options = [
            undefined,
            { rotation: 0.4 },
            { scale: 2, flipX: true },
            { flipY: true, layer: 2, alpha: 0.5 },
        ];

        for (const id of Object.keys(meta.frames)) {
            for (const option of options) {
                const generated = ngneFrame();
                const direct = ngneFrame();
                module.drawHeroWalk(generated, id, 13, 7, option);
                module.drawHeroWalkTopLeft(generated, id, 13, 7, option);
                spriteAt(direct, meta, "hero-walk", id, 13, 7, option);
                spriteAtTopLeft(direct, meta, "hero-walk", id, 13, 7, option);

                expect(generated.count).toBe(2);
                expect(Array.from(generated.data.subarray(0, 28)), id).toEqual(
                    Array.from(direct.data.subarray(0, 28)),
                );
                expect(generated.textures.slice(0, 2)).toEqual(["hero-walk", "hero-walk"]);
            }
        }
    });

    it("resolves animations as the runtime does as code", async () => {
        const module = await load();
        const { meta } = bundle(heroWalk());

        for (const animation of Object.keys(meta.animations)) {
            for (const age of [-5, 0, 79, 80, 199, 200, 201, 65656, 65657, 131071, 131072, 1e9]) {
                expect(
                    module.heroWalkAnimationFrame(animation, age),
                    `${animation} at ${age}`,
                ).toBe(animationFrame(meta, animation, age));
                expect(module.heroWalkAnimationDone(animation, age), `${animation} at ${age}`).toBe(
                    animationDone(meta, animation, age),
                );
            }
        }
        expect(module.heroWalkAnimationFrame("walk", 80)).toBe("hero-walk-2");
        expect(module.heroWalkAnimationDone("walk-2", 131072)).toBe(true);
    });
});
