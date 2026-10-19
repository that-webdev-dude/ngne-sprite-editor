import { canAddReferenceLayer } from "../../core/references";
import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { notices } from "../notices/notices";
import { availableDocument } from "../timeline/timelineDocument";
import { timelineStore } from "../timeline/timelineState";
import { layerNameOf, pickPngFile } from "./pickImage";
import { REFERENCE_COMMANDS as IDS } from "./referenceCommandIds";
import { referenceImages } from "./referenceImages";
import {
    addReferenceLayerFromPng,
    changeReference,
    REFERENCE_LIMIT_MESSAGE,
    referenceLayerOf,
    referenceSourceSize,
    resetReferenceFit,
} from "./references";

// The commands of reference layers (SPEC §7.6, SE-045). New Reference Layer from File… takes
// the Layer menu item planned for it; Reset Reference to Fit and the placement toggle follow
// Layer Properties… in its group. They act on the reference layer whose timeline row ran them,
// otherwise on the active layer when it is a reference layer. Name, visibility, lock and
// opacity are the timeline's layer commands, which take reference layers too.

// Reset to Fit is enabled once the source is decoded: an open menu follows.
referenceImages.subscribe(() => appCommands.refresh());

/** The reference layer a command acts on: the row's (`layerTarget`) or the active one. */
function subject() {
    const document = availableDocument();
    if (!document) return null;
    const id = timelineStore.getState().layerTarget ?? document.session.activeLayerId;
    const layer = referenceLayerOf(document, id);
    return layer ? { document, layer } : null;
}

/** New Reference Layer from File…: a PNG file chosen by the user becomes a reference layer. */
async function newReferenceFromFile(): Promise<void> {
    const document = availableDocument();
    if (!document) return;
    // A fifth one is refused before the picker opens, and again once the file is read.
    if (!canAddReferenceLayer(document.session.doc)) {
        notices.error(REFERENCE_LIMIT_MESSAGE);
        return;
    }
    const picked = await pickPngFile();
    if (!picked) return;
    let bytes: Uint8Array;
    try {
        bytes = await picked.read();
    } catch {
        notices.error(`Could not add the reference layer. “${picked.name}” could not be read.`);
        return;
    }
    await addReferenceLayerFromPng(bytes, {
        documentId: document.id,
        name: layerNameOf(picked.name),
    });
}

export const commands: CommandSpec[] = [
    {
        id: IDS.newReference,
        title: "New Reference Layer from File…",
        enabled: () => availableDocument() !== null,
        run: newReferenceFromFile,
    },
    {
        id: IDS.resetFit,
        title: "Reset Reference to Fit",
        menuPath: ["Layer"],
        menuOrder: 410,
        enabled: () => {
            const found = subject();
            return !!found && referenceSourceSize(found.document, found.layer) !== null;
        },
        run: () => {
            const found = subject();
            if (found) resetReferenceFit(found.layer.id);
        },
    },
    {
        id: IDS.placement,
        title: () =>
            subject()?.layer.placement === "front"
                ? "Move Reference Behind Layers"
                : "Move Reference in Front of Layers",
        menuPath: ["Layer"],
        menuOrder: 420,
        enabled: () => subject() !== null,
        run: () => {
            const found = subject();
            if (!found) return;
            const placement = found.layer.placement === "front" ? "behind" : "front";
            changeReference(found.layer.id, { placement });
        },
    },
];
