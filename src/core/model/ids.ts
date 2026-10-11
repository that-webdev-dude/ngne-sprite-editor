/** Returns a new ID on every call. IDs are unique within a document (SPEC §5.1). */
export type IdGenerator = () => string;

/** The default generator: random, so IDs made in one run never match those of a loaded file. */
export const randomId: IdGenerator = () => crypto.randomUUID();

/** A deterministic generator for tests: `id1`, `id2`, … with the given prefix. */
export function sequentialIds(prefix = "id"): IdGenerator {
    let count = 0;
    return () => `${prefix}${++count}`;
}
