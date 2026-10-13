// The frame cache of SPEC §6.4 as plain bookkeeping: which key each of the slots `ed:f:0..7`
// is reserved for, which key its texture shows, and which slot is given up next. No DOM and
// no NGNE; the renderer instance does the uploads this table asks for.

/** What the texture of a slot shows: a frame key and the size of the uploaded image. */
export interface SlotImage {
    key: string;
    /** Size of the image in document pixels at the time it was built. */
    width: number;
    height: number;
}

/** When an upload into a slot resolved (see `FrameSlots.publish`). */
export interface PublishContext {
    /** The key the viewport wants to draw. */
    current: string | null;
    /** A newer upload of the same slot is already waiting. */
    newerQueued: boolean;
}

interface Slot {
    /** The key the slot is reserved for: shown there, or on its way. */
    reserved: string | null;
    /** What the texture shows now. Null also while it shows something no longer wanted. */
    shown: SlotImage | null;
    /** Order of last use; higher is more recent. */
    used: number;
    /** No upload reaches this slot on this renderer any more. */
    disabled: boolean;
}

/**
 * A least-recently-used cache of frame keys over a fixed number of texture slots.
 *
 * A slot is _reserved_ for a key from `reserve` on and _shows_ a key from the moment the
 * matching upload resolves (`publish`). Between the two it keeps showing what its texture
 * held before: the key a slot shows never runs ahead of its texture (SPEC §6.4, upload
 * queue), so a frame builder that asks `showing(key)` never draws another frame's pixels.
 */
export class FrameSlots {
    readonly #slots: Slot[];
    #clock = 0;

    constructor(count: number) {
        this.#slots = Array.from({ length: count }, () => ({
            reserved: null,
            shown: null,
            used: 0,
            disabled: false,
        }));
    }

    /** Number of slots. */
    get count(): number {
        return this.#slots.length;
    }

    /** The slot reserved for `key`, or -1. */
    reservedFor(key: string): number {
        return this.#slots.findIndex((slot) => slot.reserved === key);
    }

    /** The slot whose texture shows `key`, or -1. */
    showing(key: string): number {
        return this.#slots.findIndex((slot) => slot.shown?.key === key);
    }

    /** What the texture of `slot` shows, or null. */
    shown(slot: number): SlotImage | null {
        return this.#slots[slot]?.shown ?? null;
    }

    /** The key `slot` is reserved for, or null. */
    reserved(slot: number): string | null {
        return this.#slots[slot]?.reserved ?? null;
    }

    /** Counts `key` as used now. */
    use(key: string): void {
        const slot = this.#slots[this.reservedFor(key)];
        if (slot) slot.used = ++this.#clock;
    }

    /**
     * Reserves a slot for `key` and returns it: an unreserved slot when there is one,
     * otherwise the least recently used. A slot reserved for or showing one of `keep` is never
     * taken, so the frame on screen stays while another loads. Returns -1 when no slot can be
     * taken. The caller uploads the key's image into the slot.
     */
    reserve(key: string, keep: readonly (string | null)[] = []): number {
        let chosen = -1;
        for (const [index, slot] of this.#slots.entries()) {
            if (slot.disabled) continue;
            if (slot.reserved === null) {
                // A slot showing a kept key is still on screen while it is re-keyed.
                if (slot.shown && keep.includes(slot.shown.key)) continue;
                chosen = index;
                break;
            }
            if (keep.includes(slot.reserved) || (slot.shown && keep.includes(slot.shown.key))) {
                continue;
            }
            const best = this.#slots[chosen];
            if (!best || slot.used < best.used) chosen = index;
        }
        const slot = this.#slots[chosen];
        if (!slot) return -1;
        slot.reserved = key;
        slot.used = ++this.#clock;
        return chosen;
    }

    /**
     * An upload into `slot` resolved: `image` is what its texture holds now, null for the 1×1
     * placeholder. The slot shows the image when it is still reserved for that key and the
     * image is not already out of date. An image is out of date when a newer upload of the
     * slot is waiting; it is shown all the same when it is the current frame, which may lag
     * its own pixels by an upload but not disappear.
     */
    publish(slot: number, image: SlotImage | null, context: PublishContext): void {
        const state = this.#slots[slot];
        if (!state) return;
        const wanted =
            image !== null &&
            state.reserved === image.key &&
            (!context.newerQueued || image.key === context.current);
        state.shown = wanted ? image : null;
    }

    /**
     * Gives up every key `matches` accepts. Returns the slots that were reserved for such a
     * key: they are free again, and the caller replaces their texture by the 1×1 placeholder
     * (SPEC §6.4). A slot that only still showed such a key while being re-keyed stops
     * showing it and keeps its reservation.
     */
    release(matches: (key: string) => boolean): number[] {
        const freed: number[] = [];
        for (const [index, slot] of this.#slots.entries()) {
            if (slot.shown && matches(slot.shown.key)) slot.shown = null;
            if (slot.reserved !== null && matches(slot.reserved)) {
                slot.reserved = null;
                slot.shown = null;
                slot.used = 0;
                freed.push(index);
            }
        }
        return freed;
    }

    /**
     * Gives up the reservation of `slot` when the image it was reserved for could not be
     * made. Nothing was uploaded, so the texture is what it was: the slot stops showing the
     * key it was reserved for, whose pixels there are out of date, and keeps showing another
     * key it was being re-keyed from. The key can be reserved again, here or elsewhere.
     */
    unreserve(slot: number): void {
        const state = this.#slots[slot];
        if (!state || state.reserved === null) return;
        if (state.shown?.key === state.reserved) state.shown = null;
        state.reserved = null;
        state.used = 0;
    }

    /** Takes `slot` out of use: its uploads failed on this renderer. */
    disable(slot: number): void {
        const state = this.#slots[slot];
        if (!state) return;
        state.disabled = true;
        state.reserved = null;
        state.shown = null;
    }

    /** The reserved keys, least recently used first. */
    keysByAge(): string[] {
        return this.#slots
            .filter((slot): slot is Slot & { reserved: string } => slot.reserved !== null)
            .sort((a, b) => a.used - b.used)
            .map((slot) => slot.reserved);
    }
}
