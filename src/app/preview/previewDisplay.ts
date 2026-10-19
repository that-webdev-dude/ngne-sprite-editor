// The size of the preview canvas on the page (SPEC §6.5, DESIGN §5.5): the document scaled by
// a whole number of device pixels per texel, as large as fits the stage.

export interface PreviewDisplay {
    /** Device pixels per document pixel: a whole number, or 1/n when the document is larger. */
    scale: number;
    /** CSS size of the canvas: `scale × size / ratio`. */
    width: number;
    height: number;
}

/**
 * The display of a `doc`-sized canvas in a stage of `stage` device pixels at the device
 * pixel ratio `ratio`. The largest whole scale at which the document fits; at least 1, so a
 * stage not laid out yet shows 1:1. A document larger than the stage at 1:1 is shown at
 * 1/n, the largest such scale that fits, where texels no longer map to whole device pixels.
 */
export function previewDisplay(
    doc: { width: number; height: number },
    stage: { width: number; height: number },
    ratio: number,
): PreviewDisplay {
    const fit = Math.min(stage.width / doc.width, stage.height / doc.height);
    let scale: number;
    if (!(fit > 0)) scale = 1;
    else if (fit >= 1) scale = Math.floor(fit);
    else scale = 1 / Math.ceil(1 / fit);
    return { scale, width: (scale * doc.width) / ratio, height: (scale * doc.height) / ratio };
}
