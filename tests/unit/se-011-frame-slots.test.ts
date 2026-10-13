import { describe, expect, it } from "vitest";
import { FrameSlots } from "../../src/engine/viewport/frameSlots";
import type { SlotImage } from "../../src/engine/viewport/frameSlots";

// SE-011: the frame cache `ed:f:0..7` — least recently used, keyed by `frameId:variant`, and
// a slot's key changing only when the matching upload resolves (SPEC §6.4).

const image = (key: string, size = 8): SlotImage => ({ key, width: size, height: size });
const IDLE = { current: null, newerQueued: false };

/** Reserves a slot for `key` and resolves its upload at once. */
function load(slots: FrameSlots, key: string, keep: readonly (string | null)[] = []): number {
    const slot = slots.reserve(key, keep);
    slots.publish(slot, image(key), IDLE);
    return slot;
}

function shownKeys(slots: FrameSlots): (string | null)[] {
    return Array.from({ length: slots.count }, (_, slot) => slots.shown(slot)?.key ?? null);
}

describe("FrameSlots: reserving", () => {
    it("fills unreserved slots first, in order", () => {
        const slots = new FrameSlots(8);
        expect(["a", "b", "c"].map((key) => slots.reserve(key))).toEqual([0, 1, 2]);
        expect(slots.reservedFor("b")).toBe(1);
        expect(slots.reserved(2)).toBe("c");
        expect(slots.reservedFor("z")).toBe(-1);
    });

    it("gives up the least recently used key when every slot is reserved", () => {
        const slots = new FrameSlots(3);
        for (const key of ["a", "b", "c"]) load(slots, key);
        // "a" is used again, so "b" is the oldest.
        slots.use("a");
        expect(slots.reserve("d")).toBe(1);
        expect(slots.reservedFor("b")).toBe(-1);
        expect(slots.keysByAge()).toEqual(["c", "a", "d"]);
        // Then "c", then "a".
        expect(slots.reserve("e")).toBe(2);
        expect(slots.reserve("f")).toBe(0);
    });

    it("never takes the slot of a key in `keep`, reserved or still shown", () => {
        const slots = new FrameSlots(2);
        load(slots, "old");
        load(slots, "other");
        // "old" is the least recently used, but it is on screen.
        expect(slots.reserve("new", ["new", "old"])).toBe(1);
        // Slot 1 still shows "other" while it is re-keyed: kept, it cannot be taken either.
        expect(slots.reserve("third", ["old", "other"])).toBe(-1);
        expect(slots.reservedFor("new")).toBe(1);
    });

    it("lists the reserved keys from least to most recently used", () => {
        const slots = new FrameSlots(8);
        for (const key of ["a", "b", "c", "d"]) load(slots, key);
        slots.use("b");
        slots.use("a");
        expect(slots.keysByAge()).toEqual(["c", "d", "b", "a"]);
    });
});

describe("FrameSlots: what a slot shows", () => {
    it("shows nothing until the first upload of a slot resolves", () => {
        const slots = new FrameSlots(8);
        const slot = slots.reserve("a");
        expect(slots.showing("a")).toBe(-1);
        expect(slots.shown(slot)).toBeNull();
        slots.publish(slot, image("a", 16), IDLE);
        expect(slots.showing("a")).toBe(slot);
        expect(slots.shown(slot)).toEqual({ key: "a", width: 16, height: 16 });
    });

    it("keeps showing the old key while a slot is re-keyed, and the new one only once it is published", () => {
        const slots = new FrameSlots(1);
        load(slots, "old");
        const slot = slots.reserve("new");
        // The texture is still the old frame's: the key has not moved with the reservation.
        expect(slots.reserved(slot)).toBe("new");
        expect(slots.showing("new")).toBe(-1);
        expect(slots.showing("old")).toBe(slot);
        expect(slots.shown(slot)).toEqual(image("old"));

        slots.publish(slot, image("new"), IDLE);
        expect(slots.showing("old")).toBe(-1);
        expect(slots.showing("new")).toBe(slot);
    });

    it("shows nothing when the published image is not the one the slot is reserved for", () => {
        const slots = new FrameSlots(1);
        load(slots, "a");
        slots.reserve("b");
        slots.reserve("c");
        // "b" was already in flight when the slot went on to "c": the texture is "b" now,
        // which nobody wants, and no longer "a".
        slots.publish(0, image("b"), { current: "c", newerQueued: true });
        expect(shownKeys(slots)).toEqual([null]);
        slots.publish(0, image("c"), { current: "c", newerQueued: false });
        expect(shownKeys(slots)).toEqual(["c"]);
    });

    it("shows an image that a newer upload will replace only for the current frame", () => {
        const slots = new FrameSlots(2);
        load(slots, "current");
        load(slots, "other");
        // The current frame may lag its pixels by an upload.
        slots.publish(0, image("current"), { current: "current", newerQueued: true });
        expect(slots.showing("current")).toBe(0);
        // Another frame's out-of-date pixels are not shown: its newer upload follows.
        slots.publish(1, image("other"), { current: "current", newerQueued: true });
        expect(slots.showing("other")).toBe(-1);
        slots.publish(1, image("other"), { current: "current", newerQueued: false });
        expect(slots.showing("other")).toBe(1);
    });

    it("shows nothing after the placeholder was published", () => {
        const slots = new FrameSlots(1);
        load(slots, "a");
        slots.publish(0, null, IDLE);
        expect(slots.showing("a")).toBe(-1);
        expect(slots.shown(0)).toBeNull();
    });
});

describe("FrameSlots: giving keys up", () => {
    it("frees the slots of released keys at once and names them for the placeholder", () => {
        const slots = new FrameSlots(4);
        for (const key of ["a", "b", "c"]) load(slots, key);
        expect(slots.release((key) => key !== "b")).toEqual([0, 2]);
        expect(shownKeys(slots)).toEqual([null, "b", null, null]);
        expect(slots.keysByAge()).toEqual(["b"]);
        // Freed slots are reserved again before a used one is given up.
        expect(slots.reserve("d")).toBe(0);
        expect(slots.reserve("e")).toBe(2);
    });

    it("does not show an upload that resolves after its key was released", () => {
        const slots = new FrameSlots(2);
        const slot = slots.reserve("a");
        expect(slots.release(() => true)).toEqual([slot]);
        // The upload of "a" was in flight; the placeholder follows it.
        slots.publish(slot, image("a"), { current: null, newerQueued: true });
        expect(slots.showing("a")).toBe(-1);
        slots.publish(slot, null, IDLE);
        expect(slots.shown(slot)).toBeNull();
    });

    it("stops showing a released key in a slot that is being re-keyed, without freeing the slot", () => {
        const slots = new FrameSlots(1);
        load(slots, "old");
        slots.reserve("new");
        expect(slots.release((key) => key === "old")).toEqual([]);
        expect(slots.showing("old")).toBe(-1);
        expect(slots.reservedFor("new")).toBe(0);
    });

    it("gives a reservation up when its image could not be made, so the key can be reserved again", () => {
        const slots = new FrameSlots(2);
        // First upload of "a" never arrived: nothing is shown, the slot is free again.
        expect(slots.reserve("a")).toBe(0);
        slots.unreserve(0);
        expect(slots.reservedFor("a")).toBe(-1);
        expect(slots.showing("a")).toBe(-1);
        expect(slots.keysByAge()).toEqual([]);
        expect(slots.reserve("a")).toBe(0);
        slots.publish(0, image("a"), IDLE);
        expect(slots.showing("a")).toBe(0);
    });

    it("stops showing a key whose refresh could not be made: those pixels are out of date", () => {
        const slots = new FrameSlots(2);
        load(slots, "a");
        // "a" changed, and its new image could not be built.
        slots.unreserve(0);
        expect(slots.showing("a")).toBe(-1);
        expect(slots.reservedFor("a")).toBe(-1);
    });

    it("keeps showing the old key of a slot whose re-keying could not be made", () => {
        const slots = new FrameSlots(1);
        load(slots, "old");
        slots.reserve("new");
        slots.unreserve(0);
        // The texture is still the old frame's.
        expect(slots.showing("old")).toBe(0);
        expect(slots.reservedFor("new")).toBe(-1);
        // The slot counts as free and is taken again, unless what it shows is kept.
        expect(slots.reserve("next", ["old"])).toBe(-1);
        expect(slots.reserve("next")).toBe(0);
        slots.unreserve(5);
        slots.unreserve(0);
        slots.unreserve(0);
        expect(slots.reservedFor("next")).toBe(-1);
    });

    it("takes a disabled slot out of use", () => {
        const slots = new FrameSlots(2);
        load(slots, "a");
        slots.disable(0);
        expect(slots.showing("a")).toBe(-1);
        expect(slots.reserve("b")).toBe(1);
        // No slot is left for a third key while "b" is kept.
        expect(slots.reserve("c", ["b"])).toBe(-1);
        expect(slots.reserve("c")).toBe(1);
    });
});

describe("FrameSlots: a session with nine frames", () => {
    it("re-keys only the least recently used slot when a ninth frame is shown", () => {
        const slots = new FrameSlots(8);
        const keys = Array.from({ length: 9 }, (_, index) => `f${index + 1}:plain`);
        for (const key of keys.slice(0, 8)) load(slots, key, [key]);
        expect(shownKeys(slots)).toEqual(keys.slice(0, 8));

        // Frame 9 while frame 8 is on screen: frame 1's slot is taken.
        const slot = slots.reserve(keys[8] ?? "", [keys[8] ?? "", keys[7] ?? ""]);
        expect(slot).toBe(0);
        expect(slots.showing(keys[8] ?? "")).toBe(-1);
        expect(shownKeys(slots)).toEqual(keys.slice(0, 8));
        slots.publish(slot, image(keys[8] ?? ""), { current: keys[8] ?? null, newerQueued: false });
        expect(shownKeys(slots)).toEqual([keys[8], ...keys.slice(1, 8)]);

        // Every other frame is still cached: none needs a slot.
        for (const key of keys.slice(1, 8)) expect(slots.reservedFor(key)).toBeGreaterThan(0);
    });
});
