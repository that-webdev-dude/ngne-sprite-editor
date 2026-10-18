import type { Command, History, Transaction } from "../history";
import { celAt } from "../model";
import type { BitMask, DocSession, IdGenerator, PixelBuffer, Rect, Selection } from "../model";
import { createMask, fullMask, maskHas, selectionOf, selectionsEqual } from "../selection";

// The floating selection of SPEC §5.2 and §7.2 (SE-032): pixels lifted out of a cel (a move)
// or brought in (a paste), held over the cel until they are applied or cancelled. It lives
// inside one transaction of the document's history, opened when the pixels float and closed
// when they land, so the whole of it is one undo step and nothing else changes the document
// meanwhile.
//
//   lift: the selected pixels are copied into the floating content, and the place they came
//     from is transparent underneath it; paste: the content comes from outside, over the cel
//   moveTo: the cel image is what lies under the float (its base) with the content written
//     over it at the float's position, the pixels of its mask replacing what is there,
//     transparent ones included; what lies off the canvas is not written
//   apply: the transaction is committed, with the selection moved along, as one entry;
//     cancel: it is aborted, pixels and selection as they were before the float
//
// The image the transaction holds is the cel's own, so every reader of the document (the
// compositor, the live composite of SE-014, the eyedropper) sees the float where it is. The
// content is never clipped while it floats: moved off the canvas and back, it is whole again.
// It is clipped when it is applied.

/** Floating pixels and which of them belong to the float: a buffer and a mask of one size. */
export interface FloatingContent {
    /** Straight RGBA8. A pixel outside the mask is transparent (0, 0, 0, 0). */
    readonly pixels: PixelBuffer;
    /** Set where a pixel belongs to the float. */
    readonly mask: BitMask;
}

/** The cel a float is over: the cel of a pixel layer at a frame. */
export interface FloatTarget {
    layerId: string;
    frameId: string;
}

export interface LiftOptions extends FloatTarget {
    /**
     * The pixels lifted: those of a selection, which then moves with them; null lifts the whole
     * cel and leaves the selection alone (the Move tool with no selection, SPEC §7.1).
     */
    selection: Selection | null;
    /** The label of the undo step; the default is "Move". */
    label?: string;
}

export interface PasteOptions extends FloatTarget {
    content: FloatingContent;
    /** Where the content's top-left pixel goes, in document pixels (whole numbers). */
    x: number;
    y: number;
    /** The label of the undo step; the default is "Paste". */
    label?: string;
}

/** The part of `rect` inside a `width` × `height` canvas, or null. */
function clipTo(rect: Rect, width: number, height: number): Rect | null {
    const x = Math.max(rect.x, 0);
    const y = Math.max(rect.y, 0);
    const right = Math.min(rect.x + rect.width, width);
    const bottom = Math.min(rect.y + rect.height, height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

function union(a: Rect | null, b: Rect | null): Rect | null {
    if (!a) return b && { ...b };
    if (!b) return { ...a };
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const right = Math.max(a.x + a.width, b.x + b.width);
    const bottom = Math.max(a.y + a.height, b.y + b.height);
    return { x, y, width: right - x, height: bottom - y };
}

function assertWhole(caller: string, ...values: number[]): void {
    if (!values.every(Number.isSafeInteger)) {
        throw new RangeError(`${caller}: positions are whole numbers, got ${values.join(", ")}.`);
    }
}

function assertContent(content: FloatingContent, caller: string): void {
    const { pixels, mask } = content;
    const fits =
        Number.isInteger(pixels.width) &&
        Number.isInteger(pixels.height) &&
        pixels.width >= 1 &&
        pixels.height >= 1 &&
        pixels.data.length === pixels.width * pixels.height * 4 &&
        mask.width === pixels.width &&
        mask.height === pixels.height &&
        mask.data.length === Math.ceil((mask.width * mask.height) / 8);
    if (!fits) {
        throw new RangeError(
            `${caller}: the content is ${pixels.width}×${pixels.height} with a ` +
                `${mask.width}×${mask.height} mask.`,
        );
    }
}

/**
 * The pixels of `image` inside `area` (on the image) that `selection` selects, as floating
 * content: the area's size, with the pixels outside the selection transparent. Without a
 * selection every pixel of the area belongs to it. A missing image (an empty cel) is
 * transparent.
 */
function contentOf(image: PixelBuffer | null, selection: Selection | null, area: Rect) {
    const { width, height } = area;
    const pixels: PixelBuffer = { width, height, data: new Uint8ClampedArray(width * height * 4) };
    const mask = selection ? createMask(width, height) : fullMask(width, height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const docX = area.x + x;
            const docY = area.y + y;
            if (selection) {
                if (!maskHas(selection.mask, docX, docY)) continue;
                const bit = y * width + x;
                mask.data[bit >> 3] |= 1 << (bit & 7);
            }
            if (!image) continue;
            const from = (docY * image.width + docX) * 4;
            pixels.data.set(image.data.subarray(from, from + 4), (y * width + x) * 4);
        }
    }
    return { pixels, mask };
}

/**
 * The pixels of the cel of `target` that `selection` selects (SPEC §7.2, Copy): the
 * selection's bounding rectangle, the pixels outside the selection transparent; with no
 * selection the whole cel. An empty cel gives transparent pixels.
 */
export function copySelected(
    session: DocSession,
    target: FloatTarget,
    selection: Selection | null,
): FloatingContent {
    const { doc } = session;
    const cel = celAt(doc, target.layerId, target.frameId);
    const image = cel ? (doc.images.get(cel.imageId) ?? null) : null;
    const area = selection?.bounds ?? { x: 0, y: 0, width: doc.width, height: doc.height };
    return contentOf(image, selection, area);
}

/** An image as floating content: every pixel belongs to it (a pasted PNG). */
export function contentOfImage(pixels: PixelBuffer): FloatingContent {
    return { pixels, mask: fullMask(pixels.width, pixels.height) };
}

/** The command that puts `after` in place of `before` as the session's selection. */
function selectionCommand(
    before: Selection | null,
    after: Selection | null,
    label: string,
): Command {
    return {
        label,
        bytes: (before?.mask.data.byteLength ?? 0) + (after?.mask.data.byteLength ?? 0),
        // No composite changes: no frame, no layer, no structure (as SE-030's commands).
        touched: { frameIds: [], layerIds: [], structure: false },
        do(session) {
            session.selection = after;
        },
        undo(session) {
            session.selection = before;
        },
    };
}

/**
 * Pixels floating over a cel, inside a transaction of its document's history (SPEC §5.2).
 * Made by `lift` or `paste`; ends with `apply` or `cancel`, after which every call throws.
 */
export class FloatingSelection {
    /** The label of the undo step it becomes: "Move", "Paste". */
    readonly label: string;
    /** The floating pixels; never clipped while they float. */
    readonly content: FloatingContent;
    /**
     * Whether the session's selection is the float's: it follows the float, and applying moves
     * it for good. False for the whole cel lifted without a selection.
     */
    readonly selects: boolean;
    /** The transaction that holds the float: its image is the cel's, with the float in it. */
    readonly transaction: Transaction;
    readonly #session: DocSession;
    /** The cel's image under the float: as at the start, less the pixels a lift took. */
    readonly #base: PixelBuffer;
    /** The session's selection before the float. */
    readonly #before: Selection | null;
    #x: number;
    #y: number;
    /** Where the content is written now: its rectangle on the canvas, or null when off it. */
    #placed: Rect | null;
    #open = true;

    private constructor(init: {
        session: DocSession;
        transaction: Transaction;
        label: string;
        content: FloatingContent;
        selects: boolean;
        base: PixelBuffer;
        x: number;
        y: number;
        placed: Rect | null;
    }) {
        this.#session = init.session;
        this.transaction = init.transaction;
        this.label = init.label;
        this.content = init.content;
        this.selects = init.selects;
        this.#base = init.base;
        this.#before = init.session.selection;
        this.#x = init.x;
        this.#y = init.y;
        this.#placed = init.placed;
    }

    /**
     * Lifts the pixels of a selection (or the whole cel) out of the cel of `options`: begins
     * the transaction (creating the cel when it is empty) and makes them float where they are,
     * so the image does not change yet. Throws what `History.begin` throws (a target that is
     * not the cel of a pixel layer, a limit, memory), with the session unchanged.
     */
    static lift(history: History, options: LiftOptions, newId?: IdGenerator): FloatingSelection {
        const { session } = history;
        const { width, height } = session.doc;
        const { selection } = options;
        if (selection && (selection.mask.width !== width || selection.mask.height !== height)) {
            throw new RangeError(
                `FloatingSelection.lift: the selection is ${selection.mask.width}×` +
                    `${selection.mask.height}, the document ${width}×${height}.`,
            );
        }
        const transaction = history.begin(
            { layerId: options.layerId, frameId: options.frameId },
            newId,
        );
        try {
            const { image } = transaction;
            const area = selection?.bounds ?? { x: 0, y: 0, width, height };
            const content = contentOf(image, selection, area);
            const base: PixelBuffer = { width, height, data: image.data.slice() };
            // Underneath, the lifted pixels are gone.
            for (let y = 0; y < area.height; y++) {
                for (let x = 0; x < area.width; x++) {
                    if (!maskHas(content.mask, x, y)) continue;
                    const at = ((area.y + y) * width + area.x + x) * 4;
                    base.data.fill(0, at, at + 4);
                }
            }
            return new FloatingSelection({
                session,
                transaction,
                label: options.label ?? "Move",
                content,
                selects: selection !== null,
                base,
                x: area.x,
                y: area.y,
                // The content is where it was taken from: the image is as it was.
                placed: clipTo(area, width, height),
            });
        } catch (error) {
            transaction.abort();
            throw error;
        }
    }

    /**
     * Pastes `options.content` over the cel of `options` at `options.x`, `options.y`: begins
     * the transaction (creating the cel when it is empty), writes the content into the image
     * and makes the selection its mask. The content belongs to the float from then on. Throws
     * as `lift`, and `RangeError` for content whose buffer and mask do not match.
     */
    static paste(history: History, options: PasteOptions, newId?: IdGenerator): FloatingSelection {
        const { session } = history;
        const { width, height } = session.doc;
        assertContent(options.content, "FloatingSelection.paste");
        assertWhole("FloatingSelection.paste", options.x, options.y);
        const transaction = history.begin(
            { layerId: options.layerId, frameId: options.frameId },
            newId,
        );
        let float: FloatingSelection;
        try {
            float = new FloatingSelection({
                session,
                transaction,
                label: options.label ?? "Paste",
                content: options.content,
                selects: true,
                base: { width, height, data: transaction.image.data.slice() },
                x: options.x,
                y: options.y,
                placed: null,
            });
            float.#render();
            // Last: it changes the selection only once it has the whole mask.
            float.#follow();
        } catch (error) {
            transaction.abort();
            throw error;
        }
        return float;
    }

    /** False once the float was applied or cancelled. */
    get open(): boolean {
        return this.#open;
    }

    /** The document position of the content's top-left pixel. */
    get x(): number {
        return this.#x;
    }

    get y(): number {
        return this.#y;
    }

    /** The content's rectangle in the document, which may reach past the canvas. */
    get bounds(): Rect {
        const { width, height } = this.content.pixels;
        return { x: this.#x, y: this.#y, width, height };
    }

    /** The part of `bounds` on the canvas, where the content is written now; null when none. */
    get placed(): Rect | null {
        return this.#placed && { ...this.#placed };
    }

    /** Whether document pixel `x, y` holds a pixel of the float (inside its mask). */
    contains(x: number, y: number): boolean {
        return maskHas(this.content.mask, x - this.#x, y - this.#y);
    }

    /**
     * Moves the content's top-left pixel to `x`, `y` (whole numbers). Returns the rectangle of
     * the image that was rewritten (the place left and the place taken, on the canvas), which
     * the transaction has been told of; null when nothing on the canvas changed.
     */
    moveTo(x: number, y: number): Rect | null {
        this.#assertOpen("moveTo");
        assertWhole("FloatingSelection.moveTo", x, y);
        if (x === this.#x && y === this.#y) return null;
        this.#x = x;
        this.#y = y;
        const changed = this.#render();
        this.#follow();
        return changed;
    }

    /** Moves the content by `dx`, `dy` pixels: `moveTo` from where it is. */
    moveBy(dx: number, dy: number): Rect | null {
        return this.moveTo(this.#x + dx, this.#y + dy);
    }

    /**
     * Applies the float: the content stays where it is, clipped to the canvas, and the
     * transaction is committed as one history entry labelled `label`, with the selection's
     * move when it moved. Returns that command, or null when nothing changed (no entry). On
     * a failure (`AllocationError`) the pixels and the selection are as before the float.
     */
    apply(): Command | null {
        this.#assertOpen("apply");
        this.#open = false;
        const after = this.#session.selection;
        const extra =
            this.selects && !selectionsEqual(this.#before, after)
                ? selectionCommand(this.#before, after, this.label)
                : undefined;
        // Back where it started: the selection before, itself (selections are values).
        if (!extra) this.#session.selection = this.#before;
        try {
            return this.transaction.commit(this.label, extra);
        } catch (error) {
            this.#session.selection = this.#before;
            throw error;
        }
    }

    /** Cancels the float: the cel's pixels and the selection are exactly as before it. */
    cancel(): void {
        this.#assertOpen("cancel");
        this.#open = false;
        this.transaction.abort();
        this.#session.selection = this.#before;
    }

    #assertOpen(call: string): void {
        if (!this.#open) {
            throw new Error(`FloatingSelection.${call}: the float was applied or cancelled.`);
        }
    }

    /**
     * Writes the content at its position: the base back over where it was, then its pixels.
     * Reports the rectangle rewritten to the transaction and returns it.
     */
    #render(): Rect | null {
        const { image } = this.transaction;
        const { width, height } = image;
        const base = this.#base.data;
        const old = this.#placed;
        if (old) {
            for (let y = old.y; y < old.y + old.height; y++) {
                const start = (y * width + old.x) * 4;
                image.data.set(base.subarray(start, start + old.width * 4), start);
            }
        }
        const { pixels, mask } = this.content;
        const next = clipTo(this.bounds, width, height);
        if (next) {
            for (let y = next.y; y < next.y + next.height; y++) {
                const row = y - this.#y;
                for (let x = next.x; x < next.x + next.width; x++) {
                    const bit = row * mask.width + (x - this.#x);
                    if ((mask.data[bit >> 3] & (1 << (bit & 7))) === 0) continue;
                    const from = bit * 4;
                    image.data.set(pixels.data.subarray(from, from + 4), (y * width + x) * 4);
                }
            }
        }
        this.#placed = next;
        const changed = union(old, next);
        if (changed) this.transaction.markDirty(changed);
        return changed;
    }

    /** Makes the session's selection the float's mask where it is, clipped to the canvas. */
    #follow(): void {
        if (!this.selects) return;
        const { width, height } = this.#session.doc;
        const placed = this.#placed;
        if (!placed) {
            this.#session.selection = null;
            return;
        }
        const mask = createMask(width, height);
        const content = this.content.mask;
        for (let y = placed.y; y < placed.y + placed.height; y++) {
            const row = (y - this.#y) * content.width - this.#x;
            for (let x = placed.x; x < placed.x + placed.width; x++) {
                const from = row + x;
                if ((content.data[from >> 3] & (1 << (from & 7))) === 0) continue;
                const to = y * width + x;
                mask.data[to >> 3] |= 1 << (to & 7);
            }
        }
        this.#session.selection = selectionOf(mask);
    }
}
