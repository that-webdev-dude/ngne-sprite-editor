import { useEffect } from "react";
import { MAX_DOCUMENT_PIXEL_BYTES } from "../../core/model";
import { watchPixelMemory } from "../../app/state/pixelMemory";
import { toast } from "../toast/toast";

const MB = 1024 * 1024;

/** The warning of SPEC §5.1 for a document whose pixel memory passed 512 MB. */
export function pixelMemoryMessage(name: string, bytes: number): string {
    return (
        `“${name}” uses ${Math.round(bytes / MB)} MB of pixel memory. Operations that would ` +
        `pass ${MAX_DOCUMENT_PIXEL_BYTES / MB} MB are refused.`
    );
}

/**
 * Shows the pixel memory warning of SPEC §5.1 as a toast, once for each open document that
 * passes 512 MB (app/state/pixelMemory.ts). Renders nothing.
 */
export function PixelMemoryWarning() {
    useEffect(
        () =>
            watchPixelMemory({
                warn: (document, bytes) =>
                    toast.info(pixelMemoryMessage(document.session.doc.name, bytes)),
            }),
        [],
    );
    return null;
}
