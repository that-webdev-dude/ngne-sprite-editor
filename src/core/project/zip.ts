import { Inflate, zipSync } from "fflate";
import type { Zippable } from "fflate";
import { ProjectError, quoted } from "./errors";

// The zip container of a project file (docs/FORMAT.md, Container). Writing is fflate's
// `zipSync` with the options that make its output depend on the entries alone. Reading
// walks the central directory here and takes only the inflater from fflate, because a
// project file is untrusted input and fflate's `unzipSync` allocates whatever size an entry
// states, lets a deflate stream expand without bound, checks no CRC-32 and silently keeps
// the last of two entries with one name.

/** One entry to write. */
export interface ZipInput {
    name: string;
    data: Uint8Array;
    /** Written as it is; otherwise deflated. PNG data is compressed already. */
    stored: boolean;
}

/** Deflate level of the entries that are not stored. */
const DEFLATE_LEVEL = 6;

/**
 * A zip archive of the entries, in their order. The same entries always give the same bytes:
 * every entry carries the time stamp 1980-01-01 00:00:00, the earliest a zip can state, and
 * nothing else in the archive depends on the clock, the time zone or the platform.
 */
export function writeZip(entries: readonly ZipInput[]): Uint8Array<ArrayBuffer> {
    const files: Zippable = {};
    for (const { name, data, stored } of entries) {
        // fflate reads the date back with the local-time getters, so it is built from local
        // fields here: the zip then states the same time in every time zone.
        const mtime = new Date(1980, 0, 1, 0, 0, 0);
        files[name] = [data, { level: stored ? 0 : DEFLATE_LEVEL, mtime }];
    }
    return zipSync(files);
}

// --- reading ------------------------------------------------------------------------------------

/** An opened archive. Entries are found by name; their order in the file does not matter. */
export interface ZipArchive {
    /**
     * The content of an entry, or `undefined` when the archive has no entry of that name. The
     * result may be a view of the archive's bytes. Throws `ProjectError`: "too-large" when the
     * entry states more than `maxBytes` (nothing is inflated then), "corrupt-entry" when its
     * data does not inflate to the stated size or fails its CRC-32.
     */
    read(name: string, maxBytes: number): Uint8Array | undefined;
}

interface ZipEntry {
    /** The name as the central directory spells it. */
    rawName: Uint8Array;
    flags: number;
    method: number;
    crc: number;
    compressedSize: number;
    size: number;
    /** Where the local header starts. */
    offset: number;
}

const END_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** Sizes of the three records without their variable parts. */
const END_BYTES = 22;
const CENTRAL_BYTES = 46;
const LOCAL_BYTES = 30;
const ZIP64_LOCATOR_BYTES = 20;
const MAX_COMMENT_BYTES = 0xffff;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 1;

/**
 * Compressed bytes handed to the inflater at a time. Deflate expands at most 1032 times, so a
 * stream that lies about its size is found after about 17 MB of output at the latest.
 */
const INFLATE_STEP_BYTES = 16 * 1024;

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    CRC_TABLE[n] = c;
}

/** CRC-32 as zip defines it (the one of PNG and zlib). */
export function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function notAZip(reason: string): ProjectError {
    return new ProjectError("not-a-zip", `The file is not a zip archive: ${reason}.`);
}

function unsupported(reason: string, entry?: string): ProjectError {
    return new ProjectError("unsupported-zip", `The zip archive cannot be read: ${reason}.`, {
        entry,
    });
}

function corrupt(name: string, reason: string, cause?: unknown): ProjectError {
    return new ProjectError("corrupt-entry", `Entry ${quoted(name)} is damaged: ${reason}.`, {
        entry: name,
        cause,
    });
}

/**
 * Offset of the end-of-central-directory record: the last place where its signature stands
 * and its comment runs exactly to the end of the file.
 */
function findEndRecord(view: DataView): number {
    const last = view.byteLength - END_BYTES;
    const first = Math.max(0, last - MAX_COMMENT_BYTES);
    for (let at = last; at >= first; at--) {
        if (
            view.getUint32(at, true) === END_SIGNATURE &&
            view.getUint16(at + 20, true) === last - at
        ) {
            return at;
        }
    }
    throw notAZip("it has no end-of-central-directory record");
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Inflates a raw deflate stream that must yield exactly `size` bytes. The output is counted
 * while it is produced, so a stream that expands beyond `size` is abandoned there.
 */
function inflate(compressed: Uint8Array, size: number, name: string): Uint8Array {
    const data = new Uint8Array(size);
    let length = 0;
    const inflater = new Inflate((chunk) => {
        if (length + chunk.length > size) {
            throw corrupt(name, `it inflates to more than the ${size} bytes it states`);
        }
        data.set(chunk, length);
        length += chunk.length;
    });
    try {
        let at = 0;
        do {
            const end = Math.min(at + INFLATE_STEP_BYTES, compressed.length);
            inflater.push(compressed.subarray(at, end), end === compressed.length);
            at = end;
        } while (at < compressed.length);
    } catch (cause) {
        if (cause instanceof ProjectError) throw cause;
        throw corrupt(name, "its data is not a valid deflate stream", cause);
    }
    if (length !== size) {
        throw corrupt(name, `it inflates to ${length} bytes and states ${size}`);
    }
    return data;
}

/**
 * Opens a zip archive: finds and checks its central directory; no entry is read yet. The
 * archive must be a plain one: one disk, no zip64 records, a directory that ends where the
 * end record starts, no name twice. `maxTotalBytes` bounds what all `read` calls together
 * may return. `bytes` must not change while the archive is in use.
 *
 * Throws `ProjectError` "not-a-zip" or "unsupported-zip".
 */
export function openZip(bytes: Uint8Array, maxTotalBytes: number): ZipArchive {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = findEndRecord(view);
    const count = view.getUint16(end + 10, true);
    const directoryOffset = view.getUint32(end + 16, true);
    if (directoryOffset + view.getUint32(end + 12, true) !== end) {
        const zip64 =
            end >= ZIP64_LOCATOR_BYTES &&
            view.getUint32(end - ZIP64_LOCATOR_BYTES, true) === ZIP64_LOCATOR_SIGNATURE;
        throw zip64
            ? unsupported("it uses the zip64 extension")
            : notAZip("its central directory does not end where its end record starts");
    }
    const disks = [view.getUint16(end + 4, true), view.getUint16(end + 6, true)];
    if (disks.some((disk) => disk !== 0) || view.getUint16(end + 8, true) !== count) {
        throw unsupported("it spans several disks");
    }

    // A byte order mark stays a character of the name: names are compared as they are spelled.
    const names = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const entries = new Map<string, ZipEntry>();
    let at = directoryOffset;
    for (let index = 0; index < count; index++) {
        const damaged = `entry ${index + 1} of ${count} in its central directory is damaged`;
        if (at + CENTRAL_BYTES > end || view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
            throw notAZip(damaged);
        }
        const nameEnd = at + CENTRAL_BYTES + view.getUint16(at + 28, true);
        const next = nameEnd + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
        if (next > end) throw notAZip(damaged);
        const entry: ZipEntry = {
            rawName: bytes.subarray(at + CENTRAL_BYTES, nameEnd),
            flags: view.getUint16(at + 8, true),
            method: view.getUint16(at + 10, true),
            crc: view.getUint32(at + 16, true),
            compressedSize: view.getUint32(at + 20, true),
            size: view.getUint32(at + 24, true),
            offset: view.getUint32(at + 42, true),
        };
        at = next;
        let name: string;
        try {
            name = names.decode(entry.rawName);
        } catch {
            // Not UTF-8: no entry of a project file has such a name, so it is never read.
            continue;
        }
        if (entries.has(name)) throw unsupported(`two entries are named ${quoted(name)}`, name);
        entries.set(name, entry);
    }
    if (at !== end) throw notAZip("its central directory holds more than its entries");

    /** The bytes of an entry as the archive stores them. */
    const storedData = (name: string, entry: ZipEntry): Uint8Array => {
        const header = entry.offset;
        if (
            header + LOCAL_BYTES > directoryOffset ||
            view.getUint32(header, true) !== LOCAL_SIGNATURE
        ) {
            throw notAZip(`entry ${quoted(name)} has no local header`);
        }
        const nameEnd = header + LOCAL_BYTES + view.getUint16(header + 26, true);
        const start = nameEnd + view.getUint16(header + 28, true);
        if (start + entry.compressedSize > directoryOffset) {
            throw notAZip(`entry ${quoted(name)} runs into the central directory`);
        }
        if (!sameBytes(bytes.subarray(header + LOCAL_BYTES, nameEnd), entry.rawName)) {
            throw notAZip(`the local header of entry ${quoted(name)} has another name`);
        }
        return bytes.subarray(start, start + entry.compressedSize);
    };

    let remaining = maxTotalBytes;
    return {
        read(name, maxBytes) {
            const entry = entries.get(name);
            if (!entry) return undefined;
            if (entry.flags & FLAG_ENCRYPTED) {
                throw unsupported(`entry ${quoted(name)} is encrypted`, name);
            }
            if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
                throw unsupported(
                    `entry ${quoted(name)} uses compression method ${entry.method}`,
                    name,
                );
            }
            // The sizes come from the directory: nothing is inflated or copied before this.
            if (entry.size > maxBytes) {
                throw new ProjectError(
                    "too-large",
                    `Entry ${quoted(name)} holds ${entry.size} bytes; the limit is ` +
                        `${maxBytes} bytes.`,
                    { entry: name },
                );
            }
            if (entry.size > remaining) {
                throw new ProjectError(
                    "too-large",
                    `The entries of the project hold more than ${maxTotalBytes} bytes.`,
                    { entry: name },
                );
            }
            remaining -= entry.size;

            const stored = storedData(name, entry);
            let data = stored;
            if (entry.method === METHOD_DEFLATE) {
                data = inflate(stored, entry.size, name);
            } else if (stored.length !== entry.size) {
                throw corrupt(name, `it stores ${stored.length} bytes and states ${entry.size}`);
            }
            if (crc32(data) !== entry.crc) throw corrupt(name, "it fails its checksum");
            return data;
        },
    };
}
