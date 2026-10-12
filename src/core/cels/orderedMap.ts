// A change of a `Map` that can be taken back exactly: after `revertMapEdit` the map has the
// entries it had, in the iteration order it had. `SpriteDoc.cels` and `SpriteDoc.images`
// change this way, so undo leaves a document that also saves as it did before.

/** What `revertMapEdit` needs to take one `applyMapEdit` back. */
export interface MapUndo<V> {
    /** The removed entries with their position in the iteration order, lowest first. */
    removed: { key: string; value: V; index: number }[];
    /** The entries whose value was replaced, with the value they had. */
    replaced: [string, V][];
    /** The keys that were new. They went to the end of the order. */
    added: string[];
}

/**
 * Deletes the keys of `removes`, then sets the entries of `sets`: an existing key keeps its
 * place in the order, a new one goes to the end. Keys of `removes` the map lacks are ignored.
 */
export function applyMapEdit<V>(
    map: Map<string, V>,
    removes: readonly string[],
    sets: readonly (readonly [string, V])[],
): MapUndo<V> {
    const removed: MapUndo<V>["removed"] = [];
    if (removes.length > 0) {
        const doomed = new Set(removes);
        let index = 0;
        for (const [key, value] of map) {
            if (doomed.has(key)) removed.push({ key, value, index });
            index++;
        }
        for (const { key } of removed) map.delete(key);
    }
    const replaced: MapUndo<V>["replaced"] = [];
    const added: string[] = [];
    for (const [key, value] of sets) {
        const previous = map.get(key);
        if (previous === undefined) added.push(key);
        else replaced.push([key, previous]);
        map.set(key, value);
    }
    return { removed, replaced, added };
}

/** Takes back the `applyMapEdit` that returned `undo`, on a map that is as that call left it. */
export function revertMapEdit<V>(map: Map<string, V>, undo: MapUndo<V>): void {
    for (const key of undo.added) map.delete(key);
    for (const [key, value] of undo.replaced) map.set(key, value);
    if (undo.removed.length === 0) return;
    // A map takes new entries at its end only, so it is refilled: the entries it kept in
    // their order, each removed one at the position it had.
    const kept = [...map];
    map.clear();
    let nextKept = 0;
    let nextRemoved = 0;
    for (let index = 0; index < kept.length + undo.removed.length; index++) {
        const removed = undo.removed[nextRemoved];
        if (removed && (removed.index === index || nextKept === kept.length)) {
            map.set(removed.key, removed.value);
            nextRemoved++;
        } else {
            const [key, value] = kept[nextKept++];
            map.set(key, value);
        }
    }
}
