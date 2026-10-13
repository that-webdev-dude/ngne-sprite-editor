import {
    ATLAS_FORMAT,
    ATLAS_VERSION,
    MAX_ATLAS_ENTRIES,
    MAX_ATLAS_FRAMES,
    MAX_ATLAS_ID_LENGTH,
    MAX_ENTRY_MS,
} from "./atlasFormat";
import type { AtlasMeta } from "./atlasFormat";
import { AtlasError } from "./errors";
import type { AtlasErrorCode } from "./errors";
import { isAtlasId } from "./names";
import { MAX_ATLAS_SIDE } from "./packErrors";
import type { AtlasAnimation, AtlasEntry, AtlasFrame } from "./sprite-runtime";

// The reader of `ngne-sprite-atlas` version 1 (docs/FORMAT.md §2). Nothing here trusts the
// value it is given: it comes from a file. Every member is read as an own member and checked
// for its type and range before it is used; IDs are checked before a member is read by one;
// and what is returned is a new object that holds the members of the format and no other.

type Json = Record<string, unknown>;

/** A name or an ID as a message shows it: quoted, and cut when it is very long. */
function quoted(text: string): string {
    return JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}…` : text);
}

/** A value as a message shows it. Objects and arrays are named, not printed. */
function shown(value: unknown): string {
    if (value === undefined) return "nothing";
    if (value === null) return "null";
    if (Array.isArray(value)) return "an array";
    if (typeof value === "string") return quoted(value);
    return typeof value === "object" ? "an object" : String(value);
}

/** Throws the error for the member at `path`; `problem` completes the sentence. */
function fail(code: AtlasErrorCode, path: string, problem: string): never {
    throw new AtlasError(code, path, `${path === "" ? "The atlas" : `\`${path}\``} ${problem}.`);
}

function isObject(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown, path: string): Json {
    if (!isObject(value)) fail("field", path, `must be an object, got ${shown(value)}`);
    return value;
}

/** The path of the member `key` of the object at `path`. */
function at(path: string, key: string): string {
    return path === "" ? key : `${path}.${key}`;
}

/** The member `key` of an object. Only its own members count; the names are fixed ones. */
function member(owner: Json, key: string, path: string): unknown {
    if (!Object.hasOwn(owner, key)) fail("field", path, `has no member \`${key}\``);
    return owner[key];
}

function integer(value: unknown, path: string, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        fail("field", path, `must be an integer from ${min} to ${max}, got ${shown(value)}`);
    }
    // -0 is the integer 0.
    return value === 0 ? 0 : value;
}

function string(value: unknown, path: string): string {
    if (typeof value !== "string") fail("field", path, `must be a string, got ${shown(value)}`);
    return value;
}

/**
 * The names of the members of an ID-keyed object, each checked to be an ID. Two names that
 * differ only by case are reported as such; the form of an ID has no upper-case letter.
 */
function ids(owner: Json, path: string): string[] {
    const names = Object.keys(owner);
    const exact = new Set(names);
    // Not narrowed by the guard: a name that fails it is still a string.
    const valid: (name: string) => boolean = isAtlasId;
    for (const name of names) {
        if (valid(name)) continue;
        const lower = name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
        if (lower !== name && exact.has(lower)) {
            fail(
                "id",
                path,
                `has the IDs ${quoted(lower)} and ${quoted(name)}, which differ only by case`,
            );
        }
        fail(
            "id",
            path,
            `has the ID ${quoted(name)}; an ID is 1 to ${MAX_ATLAS_ID_LENGTH} characters of ` +
                `a-z, 0-9, "_" and "-" and starts with a letter or a digit`,
        );
    }
    return names;
}

function readFrame(value: unknown, path: string, width: number, height: number): AtlasFrame {
    const frame = object(value, path);
    const read = (key: string, min: number, max: number) =>
        integer(member(frame, key, path), at(path, key), min, max);
    const side = (key: string) => {
        const size = read(key, 2, MAX_ATLAS_SIDE);
        if (size % 2 !== 0) fail("field", at(path, key), `must be even, got ${size}`);
        return size;
    };
    const x = read("x", 0, MAX_ATLAS_SIDE);
    const y = read("y", 0, MAX_ATLAS_SIDE);
    const w = side("w");
    const h = side("h");
    const sourceW = read("sourceW", 1, MAX_ATLAS_SIDE);
    const sourceH = read("sourceH", 1, MAX_ATLAS_SIDE);
    const offsetX = read("offsetX", 0, sourceW - 1);
    const offsetY = read("offsetY", 0, sourceH - 1);

    const pivotPath = at(path, "pivot");
    const pivot: unknown = member(frame, "pivot", path);
    if (!Array.isArray(pivot) || pivot.length !== 2) {
        fail("field", pivotPath, `must be an array of two numbers, got ${shown(pivot)}`);
    }
    const [pivotX, pivotY] = [0, 1].map((index) => {
        const part: unknown = pivot[index];
        if (typeof part !== "number" || !(part >= 0 && part <= 1)) {
            fail(
                "field",
                `${pivotPath}[${index}]`,
                `must be a number from 0 to 1, got ${shown(part)}`,
            );
        }
        return part === 0 ? 0 : part;
    });

    if (x + w > width || y + h > height) {
        fail(
            "bounds",
            path,
            `covers ${x}, ${y} to ${x + w}, ${y + h}, outside the image of ${width}x${height} px`,
        );
    }
    // The even size may take a rectangle one pixel past its source frame, and no further.
    if (offsetX + w > sourceW + 1 || offsetY + h > sourceH + 1) {
        fail(
            "bounds",
            path,
            `reaches ${Math.max(offsetX + w - sourceW, offsetY + h - sourceH)} px past its ` +
                `source frame of ${sourceW}x${sourceH} px; at most 1 px is allowed`,
        );
    }
    return { x, y, w, h, sourceW, sourceH, offsetX, offsetY, pivot: [pivotX, pivotY] };
}

function readAnimation(
    value: unknown,
    path: string,
    frameIds: ReadonlySet<string>,
    /** Entries the atlas may still hold; lowered by those of this animation. */
    budget: { entries: number },
): AtlasAnimation {
    const animation = object(value, path);
    const playback = member(animation, "playback", path);
    if (playback !== "loop" && playback !== "once") {
        fail("field", at(path, "playback"), `must be "loop" or "once", got ${shown(playback)}`);
    }
    const entriesPath = at(path, "entries");
    const list: unknown = member(animation, "entries", path);
    if (!Array.isArray(list)) fail("field", entriesPath, `must be an array, got ${shown(list)}`);
    if (list.length === 0) fail("field", entriesPath, "must hold at least one entry");
    // Before any entry is read: the length of an array costs nothing to ask.
    budget.entries -= list.length;
    if (budget.entries < 0) {
        fail(
            "limit",
            entriesPath,
            `takes the atlas past ${MAX_ATLAS_ENTRIES} animation entries, the most it may hold`,
        );
    }

    const entries: AtlasEntry[] = [];
    let sum = 0;
    for (let index = 0; index < list.length; index++) {
        const entryPath = `${entriesPath}[${index}]`;
        const entry = object(list[index], entryPath);
        const frame = string(member(entry, "frame", entryPath), at(entryPath, "frame"));
        if (!frameIds.has(frame)) {
            fail(
                "frame-reference",
                at(entryPath, "frame"),
                `names ${quoted(frame)}, which is no frame of the atlas`,
            );
        }
        const ms = integer(member(entry, "ms", entryPath), at(entryPath, "ms"), 1, MAX_ENTRY_MS);
        sum += ms;
        entries.push({ frame, ms });
    }
    // After the entries, so that an entry at fault is named and not the sum it spoils.
    const durationMs = integer(
        member(animation, "durationMs", path),
        at(path, "durationMs"),
        1,
        MAX_ATLAS_ENTRIES * MAX_ENTRY_MS,
    );
    if (durationMs !== sum) {
        fail(
            "duration",
            at(path, "durationMs"),
            `is ${durationMs}, but the entries add up to ${sum}`,
        );
    }
    return { playback, durationMs, entries };
}

function read(json: unknown, pngSize: { width: number; height: number }): AtlasMeta {
    if (!isObject(json)) fail("format", "", `must be an object, got ${shown(json)}`);
    // `format` and `version` first and alone: they keep their meaning in every version.
    const format = Object.hasOwn(json, "format") ? json.format : undefined;
    if (format !== ATLAS_FORMAT) {
        fail(
            "format",
            "format",
            `must be "${ATLAS_FORMAT}", got ${shown(format)}: this is not a sprite atlas`,
        );
    }
    const version = integer(member(json, "version", ""), "version", 1, Number.MAX_SAFE_INTEGER);
    if (version > ATLAS_VERSION) {
        fail(
            "newer-version",
            "version",
            `is ${version}; this reader knows the format up to version ${ATLAS_VERSION}`,
        );
    }

    const generator = string(member(json, "generator", ""), "generator");
    const image = string(member(json, "image", ""), "image");
    if (image === "" || /[/\\]/.test(image)) {
        fail("field", "image", `must be a file name without a folder, got ${shown(image)}`);
    }
    const width = integer(member(json, "width", ""), "width", 1, MAX_ATLAS_SIDE);
    const height = integer(member(json, "height", ""), "height", 1, MAX_ATLAS_SIDE);
    if (!isObject(pngSize) || pngSize.width !== width || pngSize.height !== height) {
        const actual = isObject(pngSize)
            ? `${shown(pngSize.width)}x${shown(pngSize.height)}`
            : shown(pngSize);
        fail(
            "image-size",
            "",
            `states an image of ${width}x${height} px, but the image is ${actual} px`,
        );
    }

    const frames = object(member(json, "frames", ""), "frames");
    const frameIds = ids(frames, "frames");
    if (frameIds.length === 0) fail("field", "frames", "must hold at least one frame");
    if (frameIds.length > MAX_ATLAS_FRAMES) {
        fail(
            "limit",
            "frames",
            `holds ${frameIds.length} frames; at most ${MAX_ATLAS_FRAMES} are allowed`,
        );
    }
    const readFrames = frameIds.map((id) => {
        return [id, readFrame(frames[id], `frames[${quoted(id)}]`, width, height)] as const;
    });

    const animations = object(member(json, "animations", ""), "animations");
    const known = new Set(frameIds);
    const budget = { entries: MAX_ATLAS_ENTRIES };
    const readAnimations = ids(animations, "animations").map((id) => {
        const path = `animations[${quoted(id)}]`;
        return [id, readAnimation(animations[id], path, known, budget)] as const;
    });

    // `Object.fromEntries` defines members; it never calls a setter, whatever the ID.
    return {
        format: ATLAS_FORMAT,
        version: ATLAS_VERSION,
        generator,
        image,
        width,
        height,
        frames: Object.fromEntries(readFrames),
        animations: Object.fromEntries(readAnimations),
    };
}

/**
 * Checks a parsed `<name>.atlas.json` against `ngne-sprite-atlas` version 1 (docs/FORMAT.md
 * §2) and against the size of its image, and returns the atlas: a new object with the
 * members of the format, in the order in which they are written. Members the format does
 * not name are left out, as NGNE's own readers leave them out.
 *
 * - Every member has its type and lies in its range. `x, y, w, h` are integers and `w` and
 *   `h` are even.
 * - `width` and `height` are those of the image, `pngSize`.
 * - Every rectangle lies inside the image. It may reach one pixel past its source frame
 *   (`offsetX + w = sourceW + 1`, SPEC §9.2), and no further.
 * - IDs of frames and animations have the form of `isAtlasId`.
 * - Every animation entry names a frame of the atlas and has a positive `ms`; `durationMs`
 *   is the sum of the entries.
 * - There are at most `MAX_ATLAS_FRAMES` frames and `MAX_ATLAS_ENTRIES` entries.
 *
 * `json` is untrusted. A member with a name such as `__proto__` or `constructor` is data
 * like any other. The pixels are not looked at.
 *
 * Throws `AtlasError`, and nothing else: its `code` says what is wrong, its `path` where.
 */
export function validateAtlas(
    json: unknown,
    pngSize: { width: number; height: number },
): AtlasMeta {
    try {
        return read(json, pngSize);
    } catch (error) {
        if (error instanceof AtlasError) throw error;
        // A value that throws when it is read is not parsed JSON, and is no atlas either.
        throw new AtlasError("format", "", "The atlas cannot be read.", { cause: error });
    }
}
