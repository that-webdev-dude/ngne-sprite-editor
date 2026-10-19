import { referenceRect } from "../../core/references";
import type { EchoCover } from "../tools/strokeEcho.overlay";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import { referenceSourceSize } from "./references";

/**
 * Where the references the viewport draws lie on the canvas of `document` (SE-045): the
 * visible reference layers with an opacity above 0 and a decoded source, as the viewport is
 * given them (`viewportController`), split by placement. What the stroke echo gives way to.
 */
export function referenceCover(document: OpenDocument): EchoCover {
    const behind: EchoCover["behind"][number][] = [];
    const front: EchoCover["front"][number][] = [];
    for (const layer of document.session.doc.layers) {
        if (layer.kind !== "reference" || !layer.visible || layer.opacity === 0) continue;
        const size = referenceSourceSize(document, layer);
        if (!size) continue;
        const rect = referenceRect(layer, size.width, size.height);
        (layer.placement === "front" ? front : behind).push(rect);
    }
    return { behind, front };
}

/** The references of the active document, as `referenceCover` gives them. */
export function activeReferenceCover(): EchoCover {
    const document = activeDocument(sessionsStore.getState());
    return document ? referenceCover(document) : { behind: [], front: [] };
}
