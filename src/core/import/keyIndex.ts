/**
 * Set of unsigned 32-bit keys that numbers them 0, 1, 2, … in the order they were added, so a
 * caller keeps one value per key in an array of its own. Open addressing with linear probing;
 * the numbering depends only on the order of the `add` calls.
 */
export class KeyIndex {
    /** The keys by number; the first `size` entries are in use. */
    keys = new Uint32Array(32);
    /** How many keys were added. */
    size = 0;
    /** The number of the key in each slot, or -1 for an empty slot. Twice as long as `keys`. */
    private slots = new Int32Array(64).fill(-1);
    /** Shifts a 32-bit hash down to a slot index. */
    private shift = 26;

    /**
     * The number of `key`. A key not seen before is added and gets the next number, which is
     * the value `size` had before the call.
     */
    add(key: number): number {
        const mask = this.slots.length - 1;
        let slot = Math.imul(key, 0x9e3779b1) >>> this.shift;
        for (;;) {
            const number = this.slots[slot];
            if (number === -1) {
                break;
            }
            if (this.keys[number] === key) {
                return number;
            }
            slot = (slot + 1) & mask;
        }
        if (this.size === this.keys.length) {
            this.grow();
            return this.add(key);
        }
        this.slots[slot] = this.size;
        this.keys[this.size] = key;
        return this.size++;
    }

    /** Forgets every key and keeps the storage. */
    clear(): void {
        this.slots.fill(-1);
        this.size = 0;
    }

    /** Doubles the storage and places the keys again, keeping their numbers. */
    private grow(): void {
        const keys = new Uint32Array(this.keys.length * 2);
        keys.set(this.keys);
        this.keys = keys;
        this.slots = new Int32Array(keys.length * 2).fill(-1);
        this.shift--;
        const mask = this.slots.length - 1;
        for (let number = 0; number < this.size; number++) {
            let slot = Math.imul(keys[number], 0x9e3779b1) >>> this.shift;
            while (this.slots[slot] !== -1) {
                slot = (slot + 1) & mask;
            }
            this.slots[slot] = number;
        }
    }
}
