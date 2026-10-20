import { setCelOpacityCommand } from "../../core/cels";
import { celAt } from "../../core/model";
import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { sessionsStore } from "../state/sessions";
import { celFacts, celPropertiesStore } from "./celProperties";
import { CEL_PROPERTIES_COMMANDS as IDS } from "./celPropertiesIds";
import { unlinkCels } from "./celTargets";
import { TIMELINE_MENUS } from "./timelineEditIds";
import { availableDocument, canEdit, settledDocumentOf } from "./timelineDocument";
import { setTimelineVisible } from "./timelineState";

// The cel properties popover (DESIGN §7, SE-061): Frame → Cel Properties… and the cel context
// menu open it for the active cel (a right-click makes the cel it was on the active one,
// SE-026). It shows the cel's opacity, whether the cel is linked, and Unlink. As the layer
// properties popover (DESIGN §5.6), it changes nothing while it is open and applies the
// opacity when it closes (Enter, Escape or a press outside) in one undo step (Apply Cel
// Properties); while the document cannot take it (a stroke) the popover stays open. The
// opacity is the cel's own, not its image's: a linked cel keeps its own (SE-021). On a locked
// layer the popover is read-only (the timeline's cel commands leave locked layers alone).
// Unlink gives the popover's cel an image of its own at once, one undo step of its own.

// `enabled` reads the popover's state: an open menu follows its changes.
celPropertiesStore.subscribe(() => appCommands.refresh());

/** The active cel of the active document when it has one on a pixel layer. */
function activeCel() {
    const document = availableDocument();
    if (!document) return null;
    const { doc, activeLayerId, activeFrameId } = document.session;
    const facts = celFacts(doc, activeLayerId, activeFrameId);
    return facts ? { document, layerId: activeLayerId, frameId: activeFrameId } : null;
}

/** The open popover's cel, with its facts now, while its document can take an edit. */
function editableDraft() {
    const { draft } = celPropertiesStore.getState();
    if (!draft || !canEdit(draft.documentId)) return null;
    const document = sessionsStore
        .getState()
        .documents.find((entry) => entry.id === draft.documentId);
    const facts = document && celFacts(document.session.doc, draft.layerId, draft.frameId);
    return facts ? { draft, facts } : null;
}

/** Cel Properties…: opens the popover on the active cel. */
function openCelProperties(): void {
    const found = activeCel();
    if (!found) return;
    const { document, layerId, frameId } = found;
    const cel = celAt(document.session.doc, layerId, frameId);
    if (!cel) return;
    setTimelineVisible(true);
    celPropertiesStore.setState({
        draft: { documentId: document.id, layerId, frameId, opacity: cel.opacity },
    });
}

/**
 * Apply Cel Properties: closes the popover; a changed opacity becomes one undo step of the
 * cel's document. Nothing is applied to a cel that is gone or on a locked layer. While the
 * document cannot take the edit, the popover stays open with what it shows.
 */
function applyCelProperties(): void {
    const { draft } = celPropertiesStore.getState();
    if (!draft) return;
    const document = settledDocumentOf(draft.documentId);
    if (!document) return;
    celPropertiesStore.setState({ draft: null });
    const { doc } = document.session;
    const facts = celFacts(doc, draft.layerId, draft.frameId);
    if (!facts || facts.locked) return;
    const command = setCelOpacityCommand(
        doc,
        { layerIds: [draft.layerId], frameIds: [draft.frameId] },
        draft.opacity,
    );
    if (command) document.history.execute(command);
}

/** Unlink: gives the popover's cel an image of its own; the popover stays open. */
function unlinkCel(): void {
    const found = editableDraft();
    if (!found || found.facts.locked || found.facts.linkedWith === 0) return;
    const { draft } = found;
    const document = settledDocumentOf(draft.documentId);
    if (!document) return;
    const command = unlinkCels(document.session, [
        { layerId: draft.layerId, frameId: draft.frameId },
    ]);
    if (command) document.history.execute(command);
}

export const commands: CommandSpec[] = [
    {
        id: IDS.open,
        title: "Cel Properties…",
        contextMenus: [{ menu: TIMELINE_MENUS.cel, order: 300 }],
        enabled: () => activeCel() !== null,
        run: openCelProperties,
    },
    {
        id: IDS.apply,
        title: "Apply Cel Properties",
        enabled: () => {
            const { draft } = celPropertiesStore.getState();
            return !!draft && canEdit(draft.documentId);
        },
        run: applyCelProperties,
    },
    {
        id: IDS.unlink,
        title: "Unlink Cel",
        enabled: () => {
            const found = editableDraft();
            return !!found && !found.facts.locked && found.facts.linkedWith > 0;
        },
        run: unlinkCel,
    },
];
