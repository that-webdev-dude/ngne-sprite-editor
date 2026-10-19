import type { ComponentType } from "react";
// Declares `import.meta.glob` wherever this module is compiled.
import type {} from "../../import-meta";

/**
 * Registry of content that takes the context bar's place of the tool options (DESIGN §5.2;
 * SE-033: the transform fields of a floating selection). A feature adds such content by
 * creating a module named `*.contextbar.tsx` anywhere under `src/ui` that exports
 * `contextBarContent`; this file finds it with a glob import, so no shared file is edited
 * (AGENTS.md, Parallel work). While an entry is shown, the context bar shows it after the
 * tool's name instead of the tool's options; the first shown entry by `order` wins.
 *
 *     // src/ui/tools/transform.contextbar.tsx
 *     export const contextBarContent: ContextBarContent = {
 *         id: "transform", order: 10, shown, subscribe, Body: TransformFields,
 *     };
 */
export interface ContextBarContent {
    /** Stable, unique id; also the `data-context-content` attribute of its wrapper. */
    id: string;
    /** Precedence among entries shown at once, ascending. */
    order: number;
    /** Whether the content takes the bar now. Must not throw. */
    shown(): boolean;
    /** Calls `listener` whenever `shown` may have changed; returns the unsubscribe. */
    subscribe(listener: () => void): () => void;
    /** The content, mounted while it is shown. */
    Body: ComponentType;
}

/** What a `*.contextbar.tsx` module exports. */
export interface ContextBarContentModule {
    contextBarContent?: ContextBarContent;
}

/** Validates the discovered modules and returns their content by `order`. */
export function collectContextBarContent(
    modules: Record<string, ContextBarContentModule>,
): ContextBarContent[] {
    const seen = new Map<string, string>();
    const entries: ContextBarContent[] = [];
    for (const [path, module] of Object.entries(modules)) {
        const entry = module.contextBarContent;
        if (!entry) throw new Error(`${path} does not export "contextBarContent".`);
        const first = seen.get(entry.id);
        if (first) {
            throw new Error(
                `Context bar content id "${entry.id}" is used by ${first} and ${path}.`,
            );
        }
        seen.set(entry.id, path);
        entries.push(entry);
    }
    return entries.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Every registered context bar content, by `order`. */
export const contextBarContents: readonly ContextBarContent[] = collectContextBarContent(
    import.meta.glob<ContextBarContentModule>("../**/*.contextbar.tsx", { eager: true }),
);

/** The id of the first content shown now, or null: the tool's options are shown. */
export function shownContextBarContent(
    entries: readonly ContextBarContent[] = contextBarContents,
): ContextBarContent | null {
    return entries.find((entry) => entry.shown()) ?? null;
}

/** Subscribes to every entry's changes. */
export function subscribeContextBarContent(
    listener: () => void,
    entries: readonly ContextBarContent[] = contextBarContents,
): () => void {
    const stops = entries.map((entry) => entry.subscribe(listener));
    return () => stops.forEach((stop) => stop());
}
