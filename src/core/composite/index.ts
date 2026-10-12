// The CPU compositor of SPEC §5.3, the single source of truth for pixels: `compositeFrame`
// for one composite or a dirty rectangle of it, `CompositeCache` for the composites of a
// document's frames, and the blend functions both use.

export { BLEND_FUNCTIONS } from "./blend";
export type { BlendFunction } from "./blend";
export { CompositeCache, DEFAULT_COMPOSITE_CACHE_BUDGET_BYTES } from "./cache";
export type { CompositeCacheOptions } from "./cache";
export { compositeFrame } from "./compositeFrame";
export type { CelOverride, CompositeOptions } from "./compositeFrame";
