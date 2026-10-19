import { useEffect, useRef } from "react";
import type { AtlasMeta } from "../../core/export/atlasFormat";
import type { PixelBuffer } from "../../core/pixels";

/** The box the thumbnail fits in, in CSS pixels. */
const BOX = { width: 320, height: 200 };
/** Largest whole-number magnification of a small atlas. */
const MAX_ZOOM = 8;

/** One rectangle per distinct atlas rectangle (merged frames share one). */
function distinctRects(meta: AtlasMeta): { x: number; y: number; w: number; h: number }[] {
    const seen = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const { x, y, w, h } of Object.values(meta.frames)) {
        seen.set(`${x},${y},${w},${h}`, { x, y, w, h });
    }
    return [...seen.values()];
}

/**
 * The atlas of the export with the outline of each rectangle (DESIGN §7, Export). A small
 * atlas is magnified by a whole number, nearest neighbour; a large one is fitted into the box.
 */
export function AtlasThumbnail({ atlas, meta }: { atlas: PixelBuffer; meta: AtlasMeta }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const context = canvas.current?.getContext("2d");
        if (!context) return;
        const image = new ImageData(atlas.width, atlas.height);
        image.data.set(atlas.data);
        context.putImageData(image, 0, 0);
    }, [atlas]);

    const fit = Math.min(BOX.width / atlas.width, BOX.height / atlas.height);
    const zoom = fit >= 1 ? Math.min(MAX_ZOOM, Math.floor(fit)) : fit;
    const width = atlas.width * zoom;
    const height = atlas.height * zoom;
    return (
        <figure className="export-atlas">
            <div className="export-atlas__frame" style={{ width, height }}>
                <canvas
                    ref={canvas}
                    className="export-atlas__image"
                    width={atlas.width}
                    height={atlas.height}
                    style={{ width, height }}
                    role="img"
                    aria-label={`Atlas, ${atlas.width} × ${atlas.height} px`}
                    data-export-atlas=""
                />
                <svg
                    className="export-atlas__rects"
                    viewBox={`0 0 ${atlas.width} ${atlas.height}`}
                    width={width}
                    height={height}
                    aria-hidden="true"
                >
                    {distinctRects(meta).map(({ x, y, w, h }) => (
                        <rect key={`${x},${y},${w},${h}`} x={x} y={y} width={w} height={h} />
                    ))}
                </svg>
            </div>
            <figcaption className="export-atlas__caption">
                {atlas.width} × {atlas.height} px
            </figcaption>
        </figure>
    );
}
