import { BLEND_FUNCTIONS } from "../composite";
import type { Command } from "../history";
import type { BlendMode, DocSession, Layer, PixelLayer, Touched } from "../model";
import { LayerError } from "./errors";
import { findLayer, findPixelLayer, normalizeLayerName, touchedByLayers } from "./lookup";

// Rename, visibility, lock, opacity and blend mode (SPEC §7.3): one property of one layer.
// None changes the list of layers, so `structure` is false (SPEC §5.2). Name, visibility,
// lock and opacity belong to pixel and reference layers alike; a reference layer names no
// frame in `touched`, because it is not part of a composite (SPEC §5.3).
//
// A command finds its layer by ID when it is done, so several of them make one step in a
// `compositeCommand` (a layer properties popover: name and opacity).

/** Lock and name are not part of a composite. */
function nothingTouched(): Touched {
    return { frameIds: [], layerIds: [], structure: false };
}

/**
 * A command that sets one property of the layer `find` returns: `do` keeps the value it finds
 * and writes `value`, `undo` writes the kept value back.
 */
function propertyCommand<L extends Layer, K extends keyof L>(
    label: string,
    touched: Touched,
    find: (session: DocSession) => L,
    property: K,
    value: L[K],
): Command {
    let previous = value;
    return {
        label,
        // One small value.
        bytes: 0,
        touched,
        do(session) {
            const layer = find(session);
            previous = layer[property];
            layer[property] = value;
        },
        undo(session) {
            find(session)[property] = previous;
        },
    };
}

/**
 * Renames a layer; names need not be unique (SPEC §5.1). The name is stored without
 * surrounding white space. Throws the `layer-not-found` error, and the `name` error for an
 * empty name.
 */
export function renameLayerCommand(session: DocSession, layerId: string, name: string): Command {
    findLayer(session.doc, layerId);
    return propertyCommand(
        "Rename Layer",
        nothingTouched(),
        ({ doc }) => findLayer(doc, layerId),
        "name",
        normalizeLayerName(name),
    );
}

/**
 * Shows or hides a layer. The active layer stays active when it is hidden. Throws the
 * `layer-not-found` error.
 */
export function setLayerVisibleCommand(
    session: DocSession,
    layerId: string,
    visible: boolean,
): Command {
    const layer = findLayer(session.doc, layerId);
    return propertyCommand(
        visible ? "Show Layer" : "Hide Layer",
        touchedByLayers(session.doc, [layer], false),
        ({ doc }) => findLayer(doc, layerId),
        "visible",
        visible,
    );
}

/**
 * Locks or unlocks a layer. A lock keeps tools from painting on the layer (SPEC §7.1); the
 * layer commands themselves work on a locked layer, as in Aseprite. Throws the
 * `layer-not-found` error.
 */
export function setLayerLockedCommand(
    session: DocSession,
    layerId: string,
    locked: boolean,
): Command {
    findLayer(session.doc, layerId);
    return propertyCommand(
        locked ? "Lock Layer" : "Unlock Layer",
        nothingTouched(),
        ({ doc }) => findLayer(doc, layerId),
        "locked",
        locked,
    );
}

/**
 * Sets the opacity of a layer, 0 (transparent) to 255. Throws the `layer-not-found` error,
 * and the `opacity` error unless `opacity` is an integer in that range.
 */
export function setLayerOpacityCommand(
    session: DocSession,
    layerId: string,
    opacity: number,
): Command {
    const layer = findLayer(session.doc, layerId);
    if (!Number.isInteger(opacity) || opacity < 0 || opacity > 255) {
        throw new LayerError(
            "opacity",
            `Layer opacity ${opacity} is not allowed: it must be an integer from 0 to 255.`,
        );
    }
    return propertyCommand(
        "Layer Opacity",
        touchedByLayers(session.doc, [layer], false),
        ({ doc }) => findLayer(doc, layerId),
        "opacity",
        opacity,
    );
}

/**
 * Sets the blend mode of a pixel layer. Throws the `layer-not-found` error, the
 * `not-a-pixel-layer` error for a reference layer, which has no blend mode (SPEC §5.1), and
 * the `blend-mode` error for a value that is not a `BlendMode`.
 */
export function setLayerBlendModeCommand(
    session: DocSession,
    layerId: string,
    blend: BlendMode,
): Command {
    const label = "Blend Mode";
    const layer = findPixelLayer(session.doc, layerId, label);
    if (!Object.hasOwn(BLEND_FUNCTIONS, blend)) {
        throw new LayerError("blend-mode", `"${String(blend)}" is not a blend mode.`);
    }
    return propertyCommand<PixelLayer, "blend">(
        label,
        touchedByLayers(session.doc, [layer], false),
        ({ doc }) => findPixelLayer(doc, layerId, label),
        "blend",
        blend,
    );
}
