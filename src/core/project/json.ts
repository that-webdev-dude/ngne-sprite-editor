import { ProjectError, quoted } from "./errors";
import type { ProjectErrorCode } from "./errors";
import { MAX_ID_LENGTH, isProjectId } from "./format";

// JSON entries of a project file: their text, and the checks a parsed value goes through
// before any of it is used. Nothing here trusts the value: it comes from a file.

/** The text of a JSON entry: UTF-8, four-space indent, a line feed at the end. */
export function encodeJson(value: unknown): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(`${JSON.stringify(value, null, 4)}\n`);
}

/**
 * The value of a JSON entry. A byte order mark at the start is skipped. Throws `ProjectError`
 * "corrupt-entry" when the bytes are not UTF-8 or the text is not JSON.
 */
export function parseJson(bytes: Uint8Array, entry: string): unknown {
    const damaged = (reason: string, cause: unknown) =>
        new ProjectError("corrupt-entry", `Entry ${quoted(entry)} is damaged: ${reason}.`, {
            entry,
            cause,
        });
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (cause) {
        throw damaged("it is not UTF-8 text", cause);
    }
    try {
        return JSON.parse(text) as unknown;
    } catch (cause) {
        throw damaged("it is not valid JSON", cause);
    }
}

/** A value as a message shows it. Objects and arrays are named, not printed. */
function shown(value: unknown): string {
    if (value === undefined) return "nothing";
    if (value === null) return "null";
    if (Array.isArray(value)) return "an array";
    if (typeof value === "string") return quoted(value);
    return typeof value === "object" ? "an object" : String(value);
}

/**
 * Typed reads of the values of one JSON entry. Every method returns the value it was given,
 * narrowed, or throws a `ProjectError` with the reader's code. The message names the entry,
 * the path of the value (`layers[2].opacity`) and what the value must be.
 */
export class JsonReader {
    readonly #code: ProjectErrorCode;
    readonly #entry: string;

    constructor(code: ProjectErrorCode, entry: string) {
        this.#code = code;
        this.#entry = entry;
    }

    /** Throws the reader's error for the value at `path`; `problem` completes the sentence. */
    fail(path: string, problem: string): never {
        const subject = path === "" ? "the top-level value" : `\`${path}\``;
        throw new ProjectError(this.#code, `${this.#entry}: ${subject} ${problem}.`, {
            entry: this.#entry,
        });
    }

    /** A JSON object, whatever its fields. A field it lacks reads as `undefined`. */
    record(value: unknown, path: string): Record<string, unknown> {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            this.fail(path, `must be an object, got ${shown(value)}`);
        }
        return value as Record<string, unknown>;
    }

    /** A JSON object with exactly the fields `keys`: none missing and no other. */
    object<Key extends string>(
        value: unknown,
        path: string,
        keys: readonly Key[],
    ): Record<Key, unknown> {
        const record = this.record(value, path);
        for (const key of keys) {
            if (!Object.hasOwn(record, key)) this.fail(path, `has no field \`${key}\``);
        }
        const known: readonly string[] = keys;
        for (const key of Object.keys(record)) {
            if (!known.includes(key)) this.fail(path, `has an unknown field ${quoted(key)}`);
        }
        return record;
    }

    /** A JSON array of at most `maxLength` items. */
    array(value: unknown, path: string, maxLength = Infinity): unknown[] {
        if (!Array.isArray(value)) this.fail(path, `must be an array, got ${shown(value)}`);
        if (value.length > maxLength) {
            this.fail(path, `holds ${value.length} items; at most ${maxLength} are allowed`);
        }
        return value as unknown[];
    }

    string(value: unknown, path: string): string {
        if (typeof value !== "string") this.fail(path, `must be a string, got ${shown(value)}`);
        return value;
    }

    boolean(value: unknown, path: string): boolean {
        if (typeof value !== "boolean") {
            this.fail(path, `must be true or false, got ${shown(value)}`);
        }
        return value;
    }

    /** A finite number from `min` to `max`. Without bounds: any finite number. */
    number(value: unknown, path: string, min = -Infinity, max = Infinity): number {
        const range = min === -Infinity && max === Infinity ? "" : ` from ${min} to ${max}`;
        if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
            this.fail(path, `must be a number${range}, got ${shown(value)}`);
        }
        return value;
    }

    /** An integer from `min` to `max`. */
    integer(value: unknown, path: string, min: number, max: number): number {
        if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
            this.fail(path, `must be an integer from ${min} to ${max}, got ${shown(value)}`);
        }
        return value;
    }

    /** One of the strings `options`. */
    oneOf<Option extends string>(value: unknown, path: string, options: readonly Option[]): Option {
        const found = options.find((option) => option === value);
        if (found === undefined) {
            const list = options.map((option) => `"${option}"`).join(", ");
            this.fail(path, `must be one of ${list}, got ${shown(value)}`);
        }
        return found;
    }

    /** An ID: see `isProjectId`. */
    id(value: unknown, path: string): string {
        if (!isProjectId(value)) {
            this.fail(
                path,
                `must be an ID of 1 to ${MAX_ID_LENGTH} characters from A-Z, a-z, 0-9, "_" ` +
                    `and "-", got ${shown(value)}`,
            );
        }
        return value;
    }

    /** A colour written `#rrggbbaa`, as the number 0xRRGGBBAA. */
    color(value: unknown, path: string): number {
        if (typeof value !== "string" || !/^#[0-9a-fA-F]{8}$/.test(value)) {
            this.fail(path, `must be a colour written "#rrggbbaa", got ${shown(value)}`);
        }
        return Number.parseInt(value.slice(1), 16);
    }
}

/**
 * The names of a string union as a list, in the order of the fields of `names`. Taking an
 * object makes the compiler refuse a list that misses a name of the union.
 */
export function namesOf<Name extends string>(names: Record<Name, true>): readonly Name[] {
    return Object.keys(names) as Name[];
}
