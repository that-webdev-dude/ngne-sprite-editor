import { moveFramesCommand, reverseFramesCommand } from "../../core/frames";
import { flattenCommand, mergeDownCommand, mergeDownTarget } from "../../core/layers";
import type { SpriteDoc } from "../../core/model";
import type { CommandSpec } from "../commands/types";
import type { OpenDocument } from "../state/sessions";
import {
    anyFilled,
    anyLinked,
    celRows,
    clearCels,
    dropCels,
    dropLayers,
    editableCels,
    linkCels,
    targetCels,
    unlinkCels,
} from "./celTargets";
import { effectiveSelection, targetFrameIds } from "./selection";
import type { CelRef } from "./selection";
import { dropStore } from "./timelineDrop";
import type { DropArgument } from "./timelineDrop";
import { TIMELINE_EDIT_COMMANDS as IDS, TIMELINE_MENUS as MENUS } from "./timelineEditIds";
import {
    activateCel,
    availableDocument,
    executeOnActive,
    settledDocument,
} from "./timelineDocument";
import { setSelection, timelineStore } from "./timelineState";

// Editing commands of the timeline (SE-026; SPEC §7.3, §7.4; DESIGN §4, §5.6).
//
// Link Cels, Unlink Cels and Clear Cels act on the cels the timeline targets (`targetCels`):
// a cel selection, the cels of a frame or layer selection, or the active cel. They leave out
// the cels of locked layers (SE-021 review), so on locked layers only they are disabled.
// Merge Down, Flatten and Reverse Frames take the Layer and Frame menu items planned for them;
// Reverse Frames reverses the selected frames. Merge Down and Flatten write pixels into layers,
// so a locked layer they would write into disables them.
//
// The drops of a drag are commands outside the menus, each one undo step: Move Cels and Copy
// Cels (a Ctrl-drag), Move Frames and Move Layers. The panel hands them what was dragged and
// where it went (`withDrop`). A drop that would put a cel on a locked layer changes nothing.
//
// Every command applies a floating selection first and does nothing during a stroke
// (`timelineDocument.ts`). The commands list the timeline's context menus they appear in.

function selectionOf(document: OpenDocument) {
    return effectiveSelection(timelineStore.getState().selection, document.id, document.session);
}

/** The cels the cel commands act on, without those of locked layers. */
function editableTargets(document: OpenDocument): CelRef[] {
    const { session } = document;
    return editableCels(session.doc, targetCels(session, selectionOf(document)));
}

/** The editable target cels of the active document, if it can take a command. */
function targets(): { document: OpenDocument; cels: CelRef[] } | null {
    const document = availableDocument();
    return document ? { document, cels: editableTargets(document) } : null;
}

/** The drop of the running drag when it was made in the active document. */
function dropOf<Kind extends DropArgument["kind"]>(
    kind: Kind,
): Extract<DropArgument, { kind: Kind }> | null {
    const { drop } = dropStore.getState();
    if (drop?.kind !== kind || availableDocument()?.id !== drop.documentId) return null;
    return drop as Extract<DropArgument, { kind: Kind }>;
}

/**
 * Drops the dragged cels, then selects them where they landed, with the cel the drag began on
 * (or the first one) as the active cel.
 */
function dropCelsRun(copy: boolean): void {
    const drop = dropOf("cels");
    if (!drop) return;
    const document = settledDocument();
    if (!document) return;
    const result = dropCels(document.session, drop.cels, drop.offset, copy);
    if (!result) return;
    document.history.execute(result.command);
    const cels = result.moved.map((pair) => pair.to);
    const anchor =
        result.moved.find(
            (pair) =>
                pair.from.layerId === drop.anchor.layerId &&
                pair.from.frameId === drop.anchor.frameId,
        )?.to ?? cels[0];
    if (!anchor) return;
    const at = activateCel(anchor);
    if (!at) return;
    setSelection({ documentId: document.id, at, kind: "cels", cels, anchor: at });
}

function hasLinkableRow(document: OpenDocument, cels: readonly CelRef[]): boolean {
    const { doc } = document.session;
    return celRows(doc, cels).some(
        (row) =>
            row.frameIds.length > 1 &&
            anyFilled(
                doc,
                row.frameIds.map((frameId) => ({ layerId: row.layerId, frameId })),
            ),
    );
}

/** The selected frames Reverse Frames reverses, or the active frame alone. */
function reversedFrames(document: OpenDocument): string[] {
    return targetFrameIds(document.session, selectionOf(document));
}

/**
 * Merge Down writes the merged pixels into the layer below, so it is refused while either
 * layer is locked (SPEC §7.1 keeps paint off a locked layer), as the cel commands are.
 */
function canMergeDown(doc: SpriteDoc, layerId: string): boolean {
    const source = doc.layers.find((layer) => layer.id === layerId);
    const target = mergeDownTarget(doc, layerId);
    return !!source && !!target && !source.locked && !target.locked;
}

/** Flatten writes into every pixel layer: refused while one of them is locked. */
function canFlatten(doc: SpriteDoc): boolean {
    return doc.layers.every((layer) => layer.kind !== "pixel" || !layer.locked);
}

export const commands: CommandSpec[] = [
    {
        id: IDS.linkCels,
        title: "Link Cels",
        contextMenus: [{ menu: MENUS.cel, order: 100 }],
        enabled: () => {
            const found = targets();
            return !!found && hasLinkableRow(found.document, found.cels);
        },
        run: () =>
            void executeOnActive((document) =>
                linkCels(document.session, editableTargets(document)),
            ),
    },
    {
        id: IDS.unlinkCels,
        title: "Unlink Cels",
        contextMenus: [{ menu: MENUS.cel, order: 110 }],
        enabled: () => {
            const found = targets();
            return !!found && anyLinked(found.document.session.doc, found.cels);
        },
        run: () =>
            void executeOnActive((document) =>
                unlinkCels(document.session, editableTargets(document)),
            ),
    },
    {
        id: IDS.clearCels,
        title: "Clear Cels",
        contextMenus: [{ menu: MENUS.cel, order: 200 }],
        enabled: () => {
            const found = targets();
            return !!found && anyFilled(found.document.session.doc, found.cels);
        },
        run: () =>
            void executeOnActive((document) =>
                clearCels(document.session, editableTargets(document)),
            ),
    },
    {
        id: IDS.moveCels,
        title: "Move Cels",
        enabled: () => dropOf("cels") !== null,
        run: () => dropCelsRun(false),
    },
    {
        id: IDS.copyCels,
        title: "Copy Cels",
        enabled: () => dropOf("cels") !== null,
        run: () => dropCelsRun(true),
    },
    {
        id: IDS.moveFrames,
        title: "Move Frames",
        enabled: () => dropOf("frames") !== null,
        run: () => {
            const drop = dropOf("frames");
            if (!drop) return;
            executeOnActive(({ session }) => {
                const known = new Set(session.doc.frames.map((frame) => frame.id));
                const ids = drop.frameIds.filter((id) => known.has(id));
                const before = Math.min(Math.max(drop.before, 0), session.doc.frames.length);
                return ids.length > 0 ? moveFramesCommand(session.doc, ids, before) : null;
            });
        },
    },
    {
        id: IDS.moveLayers,
        title: "Move Layers",
        enabled: () => dropOf("layers") !== null,
        run: () => {
            const drop = dropOf("layers");
            if (!drop) return;
            executeOnActive(({ session }) => dropLayers(session, drop.layerIds, drop.gap));
        },
    },
    {
        id: IDS.reverseFrames,
        title: "Reverse Frames",
        contextMenus: [{ menu: MENUS.frame, order: 200 }],
        enabled: () => {
            const document = availableDocument();
            return !!document && reversedFrames(document).length > 1;
        },
        run: () =>
            void executeOnActive((document) =>
                reverseFramesCommand(document.session.doc, reversedFrames(document)),
            ),
    },
    {
        id: IDS.mergeDown,
        title: "Merge Down",
        contextMenus: [{ menu: MENUS.layer, order: 200 }],
        enabled: () => {
            const document = availableDocument();
            return !!document && canMergeDown(document.session.doc, document.session.activeLayerId);
        },
        run: () =>
            void executeOnActive(({ session }) =>
                canMergeDown(session.doc, session.activeLayerId)
                    ? mergeDownCommand(session, session.activeLayerId)
                    : null,
            ),
    },
    {
        id: IDS.flatten,
        title: "Flatten",
        contextMenus: [{ menu: MENUS.layer, order: 210 }],
        enabled: () => {
            const document = availableDocument();
            return !!document && canFlatten(document.session.doc);
        },
        run: () =>
            void executeOnActive(({ session }) =>
                canFlatten(session.doc) ? flattenCommand(session) : null,
            ),
    },
];
