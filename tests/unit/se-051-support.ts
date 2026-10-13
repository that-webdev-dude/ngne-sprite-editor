import { Camera, Frame } from "@ngne/core";
import ts from "typescript";
import { ATLAS_GENERATOR } from "../../src/core/export";
import type { Bundle, SheetSprite, SpriteSink } from "../../src/core/export";
import { celKey, defaultDocSettings, defaultExportSettings } from "../../src/core/model";
import type { ExportSettings, PixelBuffer, SpriteDoc, Tag } from "../../src/core/model";
import { createPixelBuffer } from "../../src/core/pixels";

// Shared by the SE-051 tests: documents drawn as rows of characters, the fixture of the
// golden files, sinks that record or rasterize what the sprite runtime draws, NGNE's own
// demo arithmetic to compare it with, and a TypeScript compiler for generated modules.

// --- pixels -------------------------------------------------------------------------------------

// As in the SE-050 tests: "." is transparent black, an upper-case letter is an opaque colour
// of its own, and a lower-case letter is the same colour with alpha 0.
function colorOf(character: string): number[] {
    if (character === ".") return [0, 0, 0, 0];
    const code = character.toUpperCase().charCodeAt(0);
    return [code, 255 - code, (code * 7) & 0xff, character === character.toUpperCase() ? 255 : 0];
}

const CHARACTERS = ".ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function grid(...rows: string[]): PixelBuffer {
    const bytes = rows.flatMap((row) => [...row].flatMap(colorOf));
    return { width: rows[0].length, height: rows.length, data: Uint8ClampedArray.from(bytes) };
}

/** The rows of a buffer made of `grid` colours; any other colour shows as "?". */
export function show(buffer: PixelBuffer): string[] {
    const names = new Map<string, string>();
    for (const character of CHARACTERS) names.set(colorOf(character).join(), character);
    const rows: string[] = [];
    for (let y = 0; y < buffer.height; y++) {
        let row = "";
        for (let x = 0; x < buffer.width; x++) {
            const start = (y * buffer.width + x) * 4;
            row += names.get(buffer.data.subarray(start, start + 4).join()) ?? "?";
        }
        rows.push(row);
    }
    return rows;
}

/** An opaque `width` × `height` frame of noise: frames of different seeds differ. */
export function noise(width: number, height: number, seed: number): PixelBuffer {
    let state = (seed + 1) >>> 0;
    const next = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state >>> 24;
    };
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = next();
        data[i + 1] = next();
        data[i + 2] = next();
        data[i + 3] = 255;
    }
    return { width, height, data };
}

// --- documents ----------------------------------------------------------------------------------

/** A tag by the indices of its first and last frame. */
export interface TagSpec {
    name: string;
    from: number;
    to: number;
    direction?: Tag["direction"];
    repeat?: number;
    color?: number;
}

export interface SpriteSpec {
    name: string;
    /** What each frame shows on the document's one visible layer; null is an empty cel. */
    frames: (PixelBuffer | null)[];
    /** Size of the canvas; that of the first drawn frame when left out. */
    size?: [number, number];
    /** Duration of each frame in milliseconds; 100 where left out. */
    durations?: number[];
    tags?: TagSpec[];
    pivot?: [number, number];
    settings?: Partial<Omit<ExportSettings, "files">> & {
        files?: Partial<ExportSettings["files"]>;
    };
}

/**
 * A document with the frames `frame-0`, `frame-1`, … on the layer `layer`, the tags `tag-0`,
 * `tag-1`, … in the order given, and the default export settings changed as stated.
 */
export function sprite(spec: SpriteSpec): SpriteDoc {
    const drawn = spec.frames.find((frame) => frame !== null);
    const [width, height] = spec.size ?? [drawn?.width ?? 1, drawn?.height ?? 1];
    const doc: SpriteDoc = {
        id: "doc",
        name: spec.name,
        width,
        height,
        colorMode: "rgba",
        layers: [
            {
                id: "layer",
                name: "Layer 1",
                kind: "pixel",
                visible: true,
                locked: false,
                opacity: 255,
                blend: "normal",
            },
        ],
        frames: spec.frames.map((_, index) => ({
            id: `frame-${index}`,
            durationMs: spec.durations?.[index] ?? 100,
        })),
        cels: new Map(),
        images: new Map(),
        tags: (spec.tags ?? []).map((tag, index) => ({
            id: `tag-${index}`,
            name: tag.name,
            color: tag.color ?? 0x000000ff,
            fromFrameId: `frame-${tag.from}`,
            toFrameId: `frame-${tag.to}`,
            direction: tag.direction ?? "forward",
            repeat: tag.repeat ?? 0,
        })),
        palette: { name: "Test", colors: [] },
        pivot: { x: spec.pivot?.[0] ?? 0.5, y: spec.pivot?.[1] ?? 0.5 },
        settings: defaultDocSettings(width, height),
        exportSettings: exportSettings(spec.settings),
    };
    spec.frames.forEach((frame, index) => {
        if (frame === null) return;
        doc.images.set(`image-${index}`, frame);
        doc.cels.set(celKey("layer", `frame-${index}`), {
            imageId: `image-${index}`,
            opacity: 255,
        });
    });
    return doc;
}

/** The default export settings with some of them changed. */
export function exportSettings(change: SpriteSpec["settings"] = {}): ExportSettings {
    const defaults = defaultExportSettings();
    return { ...defaults, ...change, files: { ...defaults.files, ...change.files } };
}

// --- the fixture of the golden files --------------------------------------------------------------

/** What the six frames of the fixture show: 5 × 3 pixels each. */
export const HERO_FRAMES: readonly (PixelBuffer | null)[] = [
    // 0: a 2 × 2 block in the top-left corner. Outside every tag.
    grid("AB...", "CD...", "....."),
    // 1: 3 × 2 pixels against the right and bottom edge.
    grid(".....", "..EFG", "..HIJ"),
    // 2: one column of 3 pixels with a transparent column of the frame to its right.
    grid(".K...", ".L...", ".M..."),
    // 3: nothing: an empty cel.
    null,
    // 4: the whole canvas.
    grid("NOPQR", "STUVW", "XYZAB"),
    // 5: the pixels of frame 0 again, in an image of its own. Outside every tag.
    grid("AB...", "CD...", "....."),
];

/**
 * The fixture of the golden files (ticket SE-051, acceptance): the document "Hero Walk" of
 * 5 × 3 pixels, an odd size on both axes, exported with trim. It has three tags (a forward
 * loop, a ping-pong, a reverse with repeat 2, the last under a name that differs from the
 * first only by case), two frames outside every tag of which one repeats the other, an empty
 * frame, a pivot at the bottom centre, and a hidden layer that must not show.
 */
export function heroWalk(): SpriteDoc {
    const doc = sprite({
        name: "Hero Walk",
        frames: [...HERO_FRAMES],
        durations: [100, 80, 120, 1, 65535, 100],
        tags: [
            { name: "Walk", from: 1, to: 2, direction: "forward", repeat: 0, color: 0x3cb371ff },
            { name: "Turn Around", from: 2, to: 4, direction: "pingpong", color: 0xff000080 },
            // Alpha 0: Aseprite's data leaves such a colour out.
            { name: "WALK", from: 3, to: 4, direction: "reverse", repeat: 2, color: 0x12345600 },
        ],
        pivot: [0.5, 1],
        settings: { trim: true, files: { asepriteJson: "array" } },
    });
    doc.layers.push({
        id: "layer-guide",
        name: "Guide",
        kind: "pixel",
        visible: false,
        locked: false,
        opacity: 255,
        blend: "normal",
    });
    doc.images.set("image-guide", grid("ZZZZZ", "ZZZZZ", "ZZZZZ"));
    doc.cels.set(celKey("layer-guide", "frame-0"), { imageId: "image-guide", opacity: 255 });
    return doc;
}

// --- bundles ------------------------------------------------------------------------------------

/** The bytes of the file of a bundle whose name ends with `ending`. */
export function bytesOf(bundle: Bundle, ending: string): Uint8Array {
    const file = bundle.files.find((candidate) => candidate.name.endsWith(ending));
    if (!file) throw new Error(`The bundle has no file ending in "${ending}".`);
    return file.bytes;
}

/** The text of that file. Throws when it is not UTF-8. */
export function textOf(bundle: Bundle, ending: string): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytesOf(bundle, ending));
}

/** The generator the golden files were written by. */
export const GOLDEN_GENERATOR = "ngne-sprite-editor 0.0.0";

/** A text as the version of the editor that wrote the golden files would have written it. */
export function withGoldenGenerator(text: string): string {
    return text.replaceAll(ATLAS_GENERATOR, GOLDEN_GENERATOR);
}

/** The error of class `type` that `run` throws. Any other is passed on; none is one. */
export function errorOf<E extends Error>(type: new (...args: never[]) => E, run: () => unknown): E {
    try {
        run();
    } catch (error) {
        if (error instanceof type) return error;
        throw error;
    }
    throw new Error(`Expected ${type.name}, but nothing was thrown.`);
}

// --- sinks --------------------------------------------------------------------------------------

/** A sink that keeps what it is given. */
export class Recorder implements SpriteSink {
    readonly sprites: SheetSprite[] = [];
    sprite = (sprite: SheetSprite): void => {
        this.sprites.push(sprite);
    };
}

/** An NGNE frame with one scene, ready for sprites. `pixelSnap` is the camera's; NGNE's default is on. */
export function ngneFrame(pixelSnap = true): Frame {
    const camera = new Camera();
    camera.pixelSnap = pixelSnap;
    const frame = new Frame();
    frame.reset();
    frame.scene(camera, 1);
    return frame;
}

/** One quad as NGNE's `Frame` packs it for the renderer (quad-layout.js, 14 floats). */
export interface Quad {
    /** Position of the corner (0, 0) of the quad, and its two edges from there. */
    origin: [number, number];
    i: [number, number];
    j: [number, number];
    /** Texture coordinates of that corner, and their extent along `i` and `j`. */
    uv: [number, number, number, number];
    tint: [number, number, number, number];
    texture: string | undefined;
}

/** The quads of an NGNE frame, in the order they were added. A −0 is given as 0. */
export function quadsOf(frame: Frame): Quad[] {
    return Array.from({ length: frame.count }, (_, index) => {
        const d = Array.from(
            frame.data.subarray(index * 14, index * 14 + 14),
            (value) => value + 0,
        );
        return {
            origin: [d[0], d[1]],
            i: [d[2], d[3]],
            j: [d[4], d[5]],
            uv: [d[6], d[7], d[8], d[9]],
            tint: [d[10], d[11], d[12], d[13]],
            texture: frame.textures[index],
        };
    });
}

/** The x and y of the four corners of a quad, each list ascending. */
export function cornersOf(quad: Quad): { xs: number[]; ys: number[] } {
    const corners = [
        quad.origin,
        [quad.origin[0] + quad.i[0], quad.origin[1] + quad.i[1]],
        [quad.origin[0] + quad.j[0], quad.origin[1] + quad.j[1]],
        [quad.origin[0] + quad.i[0] + quad.j[0], quad.origin[1] + quad.i[1] + quad.j[1]],
    ];
    const ascending = (a: number, b: number) => a - b;
    return {
        xs: corners.map(([x]) => x).sort(ascending),
        ys: corners.map(([, y]) => y).sort(ascending),
    };
}

/**
 * What NGNE's renderer shows of a frame on a transparent `width` × `height` target, worked
 * out on the CPU from the quads the frame holds, the way the quad shader does it
 * (quad-shader.js): a pixel is sampled at its centre; the centre lies in a quad at the
 * corner coordinates (s, t) with `centre = origin + s·i + t·j`, both in [0, 1); its texture
 * coordinate is `uv.xy + (s, t)·uv.zw`; and the sampler takes the nearest texel. A texel
 * with alpha above 0 replaces what is there (the tests draw opaque or transparent texels).
 */
export function rasterize(
    frame: Frame,
    atlas: PixelBuffer,
    width: number,
    height: number,
): PixelBuffer {
    const target = createPixelBuffer(width, height);
    for (const quad of quadsOf(frame)) {
        const [ix, iy] = quad.i;
        const [jx, jy] = quad.j;
        const determinant = ix * jy - jx * iy;
        // Only the pixels of the target that the quad's bounding box touches can lie in it.
        const { xs, ys } = cornersOf(quad);
        const left = Math.max(0, Math.floor(xs[0]));
        const right = Math.min(width, Math.ceil(xs[3]));
        const top = Math.max(0, Math.floor(ys[0]));
        const bottom = Math.min(height, Math.ceil(ys[3]));
        for (let y = top; y < bottom; y++) {
            for (let x = left; x < right; x++) {
                const px = x + 0.5 - quad.origin[0];
                const py = y + 0.5 - quad.origin[1];
                const s = (px * jy - py * jx) / determinant;
                const t = (py * ix - px * iy) / determinant;
                if (s < 0 || s >= 1 || t < 0 || t >= 1) continue;
                const u = Math.floor((quad.uv[0] + s * quad.uv[2]) * atlas.width);
                const v = Math.floor((quad.uv[1] + t * quad.uv[3]) * atlas.height);
                const from = (v * atlas.width + u) * 4;
                if (atlas.data[from + 3] === 0) continue;
                target.data.set(atlas.data.subarray(from, from + 4), (y * width + x) * 4);
            }
        }
    }
    return target;
}

/**
 * A transparent `width` × `height` buffer with `image` copied to (`left`, `top`). Throws
 * when the image does not lie inside it: a test places what it expects to see in full.
 */
export function placed(
    image: PixelBuffer,
    left: number,
    top: number,
    width: number,
    height: number,
): PixelBuffer {
    if (left < 0 || top < 0 || left + image.width > width || top + image.height > height) {
        throw new Error(
            `placed: ${image.width}×${image.height} at ${left}, ${top} leaves the target`,
        );
    }
    const target = createPixelBuffer(width, height);
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const from = (y * image.width + x) * 4;
            const to = ((top + y) * width + left + x) * 4;
            target.data.set(image.data.subarray(from, from + 4), to);
        }
    }
    return target;
}

/** Describes the first pixel in which two buffers differ, or null when they are byte-equal. */
export function firstDifference(actual: PixelBuffer, expected: PixelBuffer): string | null {
    if (actual.width !== expected.width || actual.height !== expected.height) {
        return `${actual.width}×${actual.height}, expected ${expected.width}×${expected.height}`;
    }
    for (let at = 0; at < expected.data.length; at += 4) {
        const found = actual.data.subarray(at, at + 4).join();
        const wanted = expected.data.subarray(at, at + 4).join();
        if (found !== wanted) {
            const index = at / 4;
            const x = index % expected.width;
            return `pixel (${x}, ${(index - x) / expected.width}) is ${found}, expected ${wanted}`;
        }
    }
    return null;
}

// --- NGNE's demo --------------------------------------------------------------------------------

/** One frame of the atlas data NGNE's demo draws from (demo/assets/starfall.json). */
export interface DemoRect {
    x: number;
    y: number;
    w: number;
    h: number;
    pivot: readonly [number, number];
}

/**
 * `drawSprite` of NGNE's `demo/sprites.ts`, as it stands at the tag v0.2.1 of
 * https://github.com/that-webdev-dude/ngne. The demo is not part of the npm package, so its
 * arithmetic is written out here, statement for statement. Only the atlas (`art`, the JSON
 * the demo imports) and the texture ID, which the demo fixes, are parameters, and `frame` is
 * typed by the one method the function calls, so that a recording sink can stand in for it.
 */
export function demoDrawSprite(
    frame: Pick<Frame, "sprite">,
    art: { width: number; height: number; frames: Record<string, DemoRect> },
    texture: string,
    name: string,
    x: number,
    y: number,
    rotation = 0,
    layer = 3,
    alpha = 1,
): void {
    const rect = art.frames[name];
    const dx = (0.5 - rect.pivot[0]) * rect.w;
    const dy = (0.5 - rect.pivot[1]) * rect.h;
    const cos = Math.cos(rotation),
        sin = Math.sin(rotation);
    frame.sprite({
        x: x + dx * cos - dy * sin,
        y: y + dx * sin + dy * cos,
        width: rect.w,
        height: rect.h,
        texture,
        u: rect.x / art.width,
        v: rect.y / art.height,
        uw: rect.w / art.width,
        vh: rect.h / art.height,
        rotation,
        layer,
        alpha,
    });
}

// --- the TypeScript compiler --------------------------------------------------------------------

/**
 * The compiler settings of a generated module (SPEC §9.5): those of NGNE's guide for a
 * Vite consumer (`moduleResolution: "Bundler"`, DOM libraries, `types: []`,
 * `skipLibCheck: false`, ES2022) plus `strict`, `verbatimModuleSyntax`,
 * `exactOptionalPropertyTypes`, `noUnusedLocals` and `noUnusedParameters`.
 */
export const CONSUMER_OPTIONS: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
    skipLibCheck: false,
    noEmit: true,
    strict: true,
    verbatimModuleSyntax: true,
    exactOptionalPropertyTypes: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
};

/**
 * Compiles sources as files of the directory `directory`, without writing them: `@ngne/core`
 * is resolved from there as it is for a file on disk. Returns the diagnostics, one line
 * each: `<file>(<line>): TS<code> <message>`.
 */
export function compile(
    directory: string,
    sources: Record<string, string>,
    options: ts.CompilerOptions = CONSUMER_OPTIONS,
): string[] {
    const normalized = (path: string) => path.replaceAll("\\", "/");
    const base = normalized(directory).replace(/\/$/, "");
    const virtual = new Map(
        Object.entries(sources).map(([name, text]) => [`${base}/${name}`, text]),
    );
    const host = ts.createCompilerHost(options);
    const { fileExists, readFile, getSourceFile } = host;
    host.fileExists = (path) => virtual.has(normalized(path)) || fileExists(path);
    host.readFile = (path) => virtual.get(normalized(path)) ?? readFile(path);
    host.getSourceFile = (path, languageVersion, ...rest) => {
        const text = virtual.get(normalized(path));
        return text === undefined
            ? getSourceFile(path, languageVersion, ...rest)
            : ts.createSourceFile(path, text, languageVersion, true);
    };
    const program = ts.createProgram([...virtual.keys()], options, host);
    return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
        if (!diagnostic.file || diagnostic.start === undefined) {
            return `TS${diagnostic.code} ${message}`;
        }
        const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        const name = normalized(diagnostic.file.fileName).split("/").pop();
        return `${name}(${line + 1}): TS${diagnostic.code} ${message}`;
    });
}
