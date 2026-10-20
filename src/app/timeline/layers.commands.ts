import { chainedCommand, compositeCommand } from "../../core/history";
import type { Command } from "../../core/history";
import {
    addLayerCommand,
    canDeleteLayer,
    deleteLayerCommand,
    duplicateLayerCommand,
    isLayerName,
    normalizeLayerName,
    renameLayerCommand,
    setLayerLockedCommand,
    setLayerOpacityCommand,
    setLayerVisibleCommand,
} from "../../core/layers";
import type { Layer } from "../../core/model";
import { setReferenceCommand } from "../../core/references";
import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import { sourcesFreedBy, withReferenceSources } from "../references/referenceSources";
import { effectiveSelection, rowOrder, targetLayerIds } from "./selection";
import { TIMELINE_COMMANDS as IDS } from "./timelineCommandIds";
import { TIMELINE_MENUS } from "./timelineEditIds";
import {
    activateCel,
    availableDocument,
    canEdit,
    executeOnActive,
    settledDocumentOf,
} from "./timelineDocument";
import { setTimelineVisible, timelineStore } from "./timelineState";
import type { PropertiesDraft } from "./timelineState";

// Layer commands of the timeline (SPEC §7.3, §7.8; SE-022): new, duplicate and delete take
// the Layer menu items planned for them; New Layer is Shift+N. Layer Properties… opens the
// popover of DESIGN §7 (name, opacity) for the active layer, which applies its values in one
// undo step when it closes (Apply Layer Properties). Rename Layer starts the in-place rename
// of the active layer, as a double-click on its name does (Apply Layer Name ends it). Show /
// Hide and Lock / Unlock act on the layer whose row button ran them, otherwise on the active
// layer. ↑ and ↓ in the timeline make the layer above or below active (Move the active cell).
// Reference layers (SE-045) take the same commands but Duplicate Layer; their popover adds X,
// Y, scale and placement, applied in the same undo step. ↑ and ↓ go on from the bottom pixel
// layer into the Reference group under it.
//
// Every command that changes the document applies a floating selection first and does
// nothing during a stroke (`timelineDocument.ts`). Apply Layer Name and Apply Layer Properties
// do the same on their draft's document when it is the active one; while that document cannot
// take the edit, they keep the draft (the field or the popover stays). The registry loads this
// module; the panel takes the ids from `timelineCommandIds.ts`.

// `enabled` and `title` read the timeline state too: an open menu follows its changes. The
// arguments a row or the duration field hand a command for one run (`withArguments`) are not
// shown anywhere, so setting them tells no one.
timelineStore.subscribe((state, previous) => {
    const shown =
        state.visible !== previous.visible ||
        state.selection !== previous.selection ||
        state.rename !== previous.rename ||
        state.properties !== previous.properties;
    if (shown) appCommands.refresh();
});

function layerOf(document: OpenDocument, layerId: string): Layer | undefined {
    return document.session.doc.layers.find((layer) => layer.id === layerId);
}

/**
 * The layer a layer command acts on: the row's (`layerTarget`) or the active one, a pixel or a
 * reference layer.
 */
function subjectLayer(): { document: OpenDocument; layer: Layer } | null {
    const document = availableDocument();
    if (!document) return null;
    const id = timelineStore.getState().layerTarget ?? document.session.activeLayerId;
    const layer = layerOf(document, id);
    return layer ? { document, layer } : null;
}

function selectionOf(document: OpenDocument) {
    return effectiveSelection(timelineStore.getState().selection, document.id, document.session);
}

/**
 * The layers Delete Layer removes, of either kind (SE-045 review A), when at least one pixel
 * layer stays.
 */
function deletableLayers(document: OpenDocument): string[] | null {
    const { session } = document;
    const ids = targetLayerIds(session, selectionOf(document));
    if (ids.length === 0 || !ids.every((id) => canDeleteLayer(session.doc, id))) return null;
    const removed = new Set(ids);
    const staying = session.doc.layers.filter(
        (layer) => layer.kind === "pixel" && !removed.has(layer.id),
    );
    return staying.length > 0 ? ids : null;
}

function deleteLayers(): void {
    executeOnActive((document) => {
        const ids = deletableLayers(document);
        if (!ids) return null;
        const { session } = document;
        const command: Command | null =
            ids.length === 1
                ? deleteLayerCommand(session, ids[0])
                : chainedCommand(
                      "Delete Layers",
                      session,
                      ids.map((id) => (current) => deleteLayerCommand(current, id)),
                  );
        // The step holds the sources of the reference layers it deletes (SPEC §7.6).
        if (!command) return null;
        return withReferenceSources(command, {
            sessions: sessionsStore,
            documentId: document.id,
            owned: sourcesFreedBy(session.doc, ids, document.referenceSources),
        });
    });
}

function toggleVisible(): void {
    const subject = subjectLayer();
    if (!subject) return;
    const { id, visible } = subject.layer;
    executeOnActive(({ session }) => setLayerVisibleCommand(session, id, !visible));
}

function toggleLocked(): void {
    const subject = subjectLayer();
    if (!subject) return;
    const { id, locked } = subject.layer;
    executeOnActive(({ session }) => setLayerLockedCommand(session, id, !locked));
}

/** Layer Properties…: opens the popover on the row's layer or the active one. */
function openProperties(): void {
    const subject = subjectLayer();
    if (!subject) return;
    const { document, layer } = subject;
    let reference: PropertiesDraft["reference"] = null;
    if (layer.kind === "reference") {
        const { x, y, scale, placement, locked } = layer;
        reference = { x, y, scale, placement, locked };
    }
    setTimelineVisible(true);
    timelineStore.setState({
        rename: null,
        properties: {
            documentId: document.id,
            layerId: layer.id,
            name: layer.name,
            opacity: layer.opacity,
            reference,
        },
    });
}

/**
 * Apply Layer Properties: closes the popover; its name and opacity (and a reference layer's
 * X, Y, scale and placement) become one undo step of the layer's document, or none when
 * nothing changed. A name that is empty after trimming is
 * not applied (the layer keeps its name). While the document cannot take the edit, the popover
 * stays open with what it shows.
 */
function applyProperties(): void {
    const { properties } = timelineStore.getState();
    if (!properties) return;
    const document = settledDocumentOf(properties.documentId);
    if (!document) return;
    timelineStore.setState({ properties: null });
    const { session } = document;
    const layer = layerOf(document, properties.layerId);
    if (!layer) return;
    const edits: Command[] = [];
    if (isLayerName(properties.name)) {
        const rename = renameLayerCommand(session, layer.id, properties.name);
        if (rename) edits.push(rename);
    }
    const opacity = setLayerOpacityCommand(session, layer.id, properties.opacity);
    if (opacity) edits.push(opacity);
    const { reference } = properties;
    // A locked reference keeps its geometry (SPEC §7.6).
    if (reference && layer.kind === "reference" && !layer.locked) {
        const { x, y, scale, placement } = reference;
        const placed = setReferenceCommand(session, layer.id, { x, y, scale, placement });
        if (placed) edits.push(placed);
    }
    const [first] = edits;
    if (!first) return;
    document.history.execute(
        edits.length === 1 ? first : compositeCommand("Layer Properties", edits),
    );
}

/** Rename Layer: the name of the active layer becomes a field in its row. */
function startRename(): void {
    const subject = subjectLayer();
    if (!subject) return;
    setTimelineVisible(true);
    timelineStore.setState({
        properties: null,
        rename: {
            documentId: subject.document.id,
            layerId: subject.layer.id,
            name: subject.layer.name,
        },
    });
}

/**
 * Apply Layer Name: ends the in-place rename; a valid, changed name is one undo step. While the
 * document cannot take the edit, the field stays with what it holds.
 */
function applyRename(): void {
    const { rename } = timelineStore.getState();
    if (!rename) return;
    const document = settledDocumentOf(rename.documentId);
    if (!document) return;
    timelineStore.setState({ rename: null });
    if (!isLayerName(rename.name) || !layerOf(document, rename.layerId)) return;
    const command = renameLayerCommand(
        document.session,
        rename.layerId,
        normalizeLayerName(rename.name),
    );
    if (command) document.history.execute(command);
}

/**
 * The layer `step` rows above (1) or below (-1) the active one, if there is one: the rows of
 * the pixel layers, then those of the Reference group (`rowOrder`).
 */
function neighbourLayer(step: 1 | -1): string | null {
    const document = availableDocument();
    if (!document) return null;
    const layerIds = rowOrder(document.session.doc);
    const index = layerIds.indexOf(document.session.activeLayerId);
    if (index === -1) return null;
    return layerIds[index + step] ?? null;
}

function moveToLayer(step: 1 | -1): void {
    const layerId = neighbourLayer(step);
    if (layerId !== null) activateCel({ layerId });
}

const hasDocument = () => availableDocument() !== null;

export const commands: CommandSpec[] = [
    {
        id: IDS.newLayer,
        title: "New Layer",
        shortcut: "Shift+N",
        contextMenus: [{ menu: TIMELINE_MENUS.layer, order: 100 }],
        enabled: hasDocument,
        run: () => void executeOnActive(({ session }) => addLayerCommand(session)),
    },
    {
        id: IDS.duplicateLayer,
        title: "Duplicate Layer",
        contextMenus: [{ menu: TIMELINE_MENUS.layer, order: 110 }],
        enabled: () => {
            const document = availableDocument();
            return (
                !!document && layerOf(document, document.session.activeLayerId)?.kind === "pixel"
            );
        },
        run: () =>
            void executeOnActive(({ session }) =>
                duplicateLayerCommand(session, session.activeLayerId),
            ),
    },
    {
        id: IDS.deleteLayer,
        title: "Delete Layer",
        contextMenus: [{ menu: TIMELINE_MENUS.layer, order: 120 }],
        enabled: () => {
            const document = availableDocument();
            return !!document && deletableLayers(document) !== null;
        },
        run: deleteLayers,
    },
    {
        id: IDS.layerProperties,
        title: "Layer Properties…",
        contextMenus: [{ menu: TIMELINE_MENUS.layer, order: 310 }],
        enabled: () => subjectLayer() !== null,
        run: openProperties,
    },
    {
        id: IDS.applyLayerProperties,
        title: "Apply Layer Properties",
        enabled: () => {
            const { properties } = timelineStore.getState();
            return !!properties && canEdit(properties.documentId);
        },
        run: applyProperties,
    },
    {
        id: IDS.renameLayer,
        title: "Rename Layer",
        contextMenus: [{ menu: TIMELINE_MENUS.layer, order: 300 }],
        enabled: () => subjectLayer() !== null,
        run: startRename,
    },
    {
        id: IDS.applyLayerName,
        title: "Apply Layer Name",
        enabled: () => {
            const { rename } = timelineStore.getState();
            return !!rename && canEdit(rename.documentId);
        },
        run: applyRename,
    },
    {
        id: IDS.toggleVisible,
        title: () => (subjectLayer()?.layer.visible === false ? "Show Layer" : "Hide Layer"),
        enabled: () => subjectLayer() !== null,
        run: toggleVisible,
    },
    {
        id: IDS.toggleLocked,
        title: () => (subjectLayer()?.layer.locked ? "Unlock Layer" : "Lock Layer"),
        enabled: () => subjectLayer() !== null,
        run: toggleLocked,
    },
    {
        id: IDS.layerAbove,
        title: "Go to Layer Above",
        shortcut: "ArrowUp",
        context: "timeline",
        enabled: () => neighbourLayer(1) !== null,
        run: () => moveToLayer(1),
    },
    {
        id: IDS.layerBelow,
        title: "Go to Layer Below",
        shortcut: "ArrowDown",
        context: "timeline",
        enabled: () => neighbourLayer(-1) !== null,
        run: () => moveToLayer(-1),
    },
];
