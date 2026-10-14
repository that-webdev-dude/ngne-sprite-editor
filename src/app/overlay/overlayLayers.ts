// Declares `import.meta.glob` wherever this module is compiled.
import type {} from "../../import-meta";
import type { OverlayLayer, OverlayLayerModule } from "./types";

/**
 * Draw-layer registry of the overlay (SE-013). A feature adds chrome to the overlay by
 * creating a module named `*.overlay.ts` anywhere under `src` that exports `overlayLayers`;
 * this file finds it with a glob import, so no shared file is edited (AGENTS.md, Parallel
 * work):
 *
 *     // src/app/tools/brushCursor.overlay.ts
 *     export const overlayLayers: OverlayLayer[] = [
 *         { id: "brush-cursor", order: 900, draw: drawBrushCursor, watch: followTool },
 *     ];
 *
 * A layer module is evaluated while this one loads: it may import the types, but nothing
 * else from the overlay that imports this file.
 */

/** Thrown when the discovered layers cannot form one stack; the message names the module. */
export class OverlayLayerError extends Error {
    override readonly name = "OverlayLayerError";
}

/** Validates the discovered modules and returns their layers in drawing order, bottom first. */
export function collectOverlayLayers(modules: Record<string, OverlayLayerModule>): OverlayLayer[] {
    const seen = new Map<string, string>();
    const layers: OverlayLayer[] = [];
    for (const [path, module] of Object.entries(modules)) {
        const exported = module.overlayLayers;
        if (!Array.isArray(exported)) {
            throw new OverlayLayerError(`${path} does not export "overlayLayers".`);
        }
        for (const layer of exported as readonly OverlayLayer[]) {
            if (typeof layer.id !== "string" || layer.id.trim() === "") {
                throw new OverlayLayerError(`A layer of ${path} has no id.`);
            }
            const first = seen.get(layer.id);
            if (first !== undefined) {
                throw new OverlayLayerError(
                    `Overlay layer id "${layer.id}" is used by ${first} and ${path}.`,
                );
            }
            if (!Number.isFinite(layer.order)) {
                throw new OverlayLayerError(`Overlay layer "${layer.id}" (${path}) has no order.`);
            }
            seen.set(layer.id, path);
            layers.push(layer);
        }
    }
    // Equal orders are drawn by id, so the stack does not depend on module order.
    return layers.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Every draw layer of the app, bottom first. */
export const overlayLayers: readonly OverlayLayer[] = collectOverlayLayers(
    import.meta.glob<OverlayLayerModule>("../../**/*.overlay.{ts,tsx}", { eager: true }),
);
