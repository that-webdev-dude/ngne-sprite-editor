import { celAt, celKey, frameIndex } from "../model";
import type { BitMask, DocSession, IdGenerator, PixelBuffer, Rect } from "../model";
import { blitPixels } from "../pixels";
import { allocateBuffer, copyRect, type PixelAllocator } from "./allocate";
import type { Command } from "./command";
import { TransactionError } from "./errors";
import { patchCommand, touchedByImage } from "./pixelPatch";

/** Opacity of the cel a transaction creates (the default of SPEC §5.1). */
const NEW_CEL_OPACITY = 255;

/** Target of a transaction: the cel of a pixel layer at a frame. */
export interface TransactionOptions {
    layerId: string;
    frameId: string;
    /**
     * Clip mask with the document's dimensions: a pixel whose bit is 0 keeps the value it
     * had at `begin`. Without a mask every pixel can change.
     */
    clip?: BitMask;
}

/** One open tool stroke on a cel image (SPEC §5.2). `History.begin` returns it. */
export interface Transaction {
    readonly layerId: string;
    readonly frameId: string;
    /** ID of `image`. */
    readonly imageId: string;
    /** The cel's image. The tool writes into `image.data` and reports it with `markDirty`. */
    readonly image: PixelBuffer;
    /** True when `begin` found the cel empty and created it and its image. */
    readonly createdCel: boolean;
    /** Bounding rectangle of the changes reported so far; null when there is none. */
    readonly dirty: Rect | null;
    /** False after `commit` or `abort`. A closed transaction rejects every call. */
    readonly open: boolean;
    /**
     * Reports that the tool wrote pixels inside `rect` (integers; clipped to the canvas).
     * With a clip mask, the pixels of `rect` outside the mask get their value at `begin`
     * back at once and do not count as changed. Unreported writes are not undoable.
     */
    markDirty(rect: Rect): void;
    /**
     * Closes the stroke as one history entry labelled `label`, which includes the creation
     * of the cel when `begin` created it, and returns its command. When no change was
     * reported it acts as `abort` and returns null. When the entry cannot be allocated it
     * also restores the state at `begin`, and throws `AllocationError`.
     */
    commit(label: string): Command | null;
    /** Closes the stroke with no history entry: pixels as at `begin`, a created cel removed. */
    abort(): void;
}

/** What a transaction needs from the history that begins it. */
export interface TransactionHost {
    /** Makes the ID of the image of a created cel. */
    newId: IdGenerator;
    allocate: PixelAllocator;
    /** Called once when the transaction closes, before `record`. */
    closed(): void;
    /** Takes the command of a commit. Its change is already in the session. */
    record(command: Command): void;
}

function maskFits(mask: BitMask, width: number, height: number): boolean {
    return (
        mask.width === width &&
        mask.height === height &&
        mask.data.length === Math.ceil((width * height) / 8)
    );
}

/** The part of `rect` inside a `width` × `height` canvas, or null when there is none. */
function clipToCanvas(rect: Rect, width: number, height: number): Rect | null {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)) {
        throw new RangeError(
            `A dirty rectangle must have integer coordinates, got ` +
                `${rect.x}, ${rect.y}, ${rect.width}, ${rect.height}.`,
        );
    }
    const x = Math.max(rect.x, 0);
    const y = Math.max(rect.y, 0);
    const right = Math.min(rect.x + rect.width, width);
    const bottom = Math.min(rect.y + rect.height, height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

function union(a: Rect | null, b: Rect): Rect {
    if (!a) return b;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const right = Math.max(a.x + a.width, b.x + b.width);
    const bottom = Math.max(a.y + a.height, b.y + b.height);
    return { x, y, width: right - x, height: bottom - y };
}

/** Command of a stroke on an empty cel: `do` creates the image and the cel, `undo` removes both. */
function createCelCommand(
    label: string,
    transaction: Transaction,
    area: Rect,
    pixels: PixelBuffer,
    allocate: PixelAllocator,
): Command {
    const { layerId, frameId, imageId } = transaction;
    const { width, height } = transaction.image;
    const key = celKey(layerId, frameId);
    return {
        label,
        bytes: pixels.data.byteLength,
        touched: { frameIds: [frameId], layerIds: [layerId], structure: false },
        do({ doc }) {
            // Allocated before the document changes, so a failure leaves it as it was.
            const image = allocateBuffer(allocate, width, height);
            blitPixels(image, pixels, area.x, area.y);
            doc.images.set(imageId, image);
            doc.cels.set(key, { imageId, opacity: NEW_CEL_OPACITY });
        },
        undo({ doc }) {
            doc.cels.delete(key);
            doc.images.delete(imageId);
        },
    };
}

class StrokeTransaction implements Transaction {
    readonly layerId: string;
    readonly frameId: string;
    readonly imageId: string;
    readonly image: PixelBuffer;
    readonly createdCel: boolean;
    readonly #session: DocSession;
    readonly #host: TransactionHost;
    readonly #clip: BitMask | null;
    /** The image at `begin`; null for a created cel, whose image was transparent. */
    readonly #before: PixelBuffer | null;
    #dirty: Rect | null = null;
    #open = true;

    constructor(
        session: DocSession,
        host: TransactionHost,
        options: TransactionOptions,
        imageId: string,
        image: PixelBuffer,
        before: PixelBuffer | null,
    ) {
        this.layerId = options.layerId;
        this.frameId = options.frameId;
        this.imageId = imageId;
        this.image = image;
        this.createdCel = before === null;
        this.#session = session;
        this.#host = host;
        this.#clip = options.clip ?? null;
        this.#before = before;
    }

    get dirty(): Rect | null {
        return this.#dirty && { ...this.#dirty };
    }

    get open(): boolean {
        return this.#open;
    }

    markDirty(rect: Rect): void {
        this.#assertOpen("markDirty");
        const area = clipToCanvas(rect, this.image.width, this.image.height);
        if (!area) return;
        const changed = this.#clip ? this.#applyClip(this.#clip, area) : area;
        if (changed) this.#dirty = union(this.#dirty, changed);
    }

    commit(label: string): Command | null {
        this.#assertOpen("commit");
        const area = this.#dirty;
        let command: Command | null = null;
        try {
            if (area) command = this.#command(label, area);
        } finally {
            if (!command) this.#restore();
            this.#close();
        }
        if (command) this.#host.record(command);
        return command;
    }

    abort(): void {
        this.#assertOpen("abort");
        this.#restore();
        this.#close();
    }

    #assertOpen(call: string): void {
        if (!this.#open) {
            throw new TransactionError(`${call}: the transaction is already closed.`);
        }
    }

    #close(): void {
        this.#open = false;
        this.#host.closed();
    }

    /**
     * Gives the pixels of `area` outside the mask their value at `begin` back and returns
     * the bounding rectangle of those inside it, or null when the mask excludes all of `area`.
     */
    #applyClip(mask: BitMask, area: Rect): Rect | null {
        const { width, data } = this.image;
        const before = this.#before?.data;
        const right = area.x + area.width;
        const bottom = area.y + area.height;
        let minX = right;
        let minY = bottom;
        let maxX = -1;
        let maxY = -1;
        for (let y = area.y; y < bottom; y++) {
            for (let x = area.x; x < right; x++) {
                const bit = y * width + x;
                if (mask.data[bit >> 3] & (1 << (bit & 7))) {
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                } else {
                    const at = bit * 4;
                    data[at] = before ? before[at] : 0;
                    data[at + 1] = before ? before[at + 1] : 0;
                    data[at + 2] = before ? before[at + 2] : 0;
                    data[at + 3] = before ? before[at + 3] : 0;
                }
            }
        }
        return maxX < 0
            ? null
            : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    }

    /** The command for the pixels of `area`, which are already in the image. */
    #command(label: string, area: Rect): Command {
        const { allocate } = this.#host;
        const after = copyRect(allocate, this.image, area);
        if (!this.#before) return createCelCommand(label, this, area, after, allocate);
        return patchCommand({
            label,
            imageId: this.imageId,
            x: area.x,
            y: area.y,
            before: copyRect(allocate, this.#before, area),
            after,
            touched: touchedByImage(this.#session.doc, this.imageId),
        });
    }

    /** Puts the session back to its state at `begin`. */
    #restore(): void {
        const { doc } = this.#session;
        if (this.#before) {
            this.image.data.set(this.#before.data);
        } else {
            doc.cels.delete(celKey(this.layerId, this.frameId));
            doc.images.delete(this.imageId);
        }
    }
}

/**
 * Begins a stroke on the cel of a pixel layer at a frame: keeps a copy of the cel's image
 * or, when the cel is empty, creates a transparent image and the cel. Throws
 * `TransactionError` for a target that is not a cel of a pixel layer or a mask of the
 * wrong size, and `AllocationError` (session unchanged) when memory runs out.
 */
export function beginTransaction(
    session: DocSession,
    options: TransactionOptions,
    host: TransactionHost,
): Transaction {
    const { doc } = session;
    const { layerId, frameId, clip } = options;
    const layer = doc.layers.find((candidate) => candidate.id === layerId);
    if (!layer) throw new TransactionError(`begin: no layer has ID "${layerId}".`);
    if (layer.kind !== "pixel") {
        throw new TransactionError(`begin: layer "${layerId}" is a ${layer.kind} layer.`);
    }
    if (frameIndex(doc, frameId) === -1) {
        throw new TransactionError(`begin: no frame has ID "${frameId}".`);
    }
    if (clip && !maskFits(clip, doc.width, doc.height)) {
        throw new TransactionError(
            `begin: the clip mask is ${clip.width}×${clip.height} with ${clip.data.length} ` +
                `bytes; the document is ${doc.width}×${doc.height}.`,
        );
    }

    const cel = celAt(doc, layerId, frameId);
    if (cel) {
        const image = doc.images.get(cel.imageId);
        if (!image) {
            throw new TransactionError(`begin: the cel names image "${cel.imageId}".`);
        }
        const whole = { x: 0, y: 0, width: image.width, height: image.height };
        const before = copyRect(host.allocate, image, whole);
        return new StrokeTransaction(session, host, options, cel.imageId, image, before);
    }

    const image = allocateBuffer(host.allocate, doc.width, doc.height);
    const imageId = host.newId();
    doc.images.set(imageId, image);
    doc.cels.set(celKey(layerId, frameId), { imageId, opacity: NEW_CEL_OPACITY });
    return new StrokeTransaction(session, host, options, imageId, image, null);
}
