import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { gridLayout } from "../../core/import";
import type { GridOptions } from "../../core/import";
import type { PixelBuffer, PixelRect } from "../../core/pixels";
import { PixelCanvas } from "./PixelCanvas";

/** The box the source is fitted into, in CSS pixels. */
const BOX = { width: 420, height: 260 };
/** Most cells the grid overlay draws. */
const MAX_CELLS = 1024;

/** The CSS scale the source is shown at: whole numbers up to 8 when it fits, otherwise less. */
export function sourceScale(width: number, height: number): number {
    const fit = Math.min(BOX.width / width, BOX.height / height);
    return fit >= 1 ? Math.min(8, Math.floor(fit)) : fit;
}

/** The cells of the grid over the region, in source pixels; none when the grid does not fit. */
function cellRects(region: PixelRect, grid: GridOptions): PixelRect[] {
    let layout;
    try {
        layout = gridLayout(region.width, region.height, grid);
    } catch {
        return [];
    }
    const rects: PixelRect[] = [];
    for (let row = 0; row < layout.rows; row++) {
        for (let column = 0; column < layout.columns; column++) {
            if (rects.length >= MAX_CELLS) return rects;
            rects.push({
                x: region.x + layout.offsetX + column * (layout.cellWidth + layout.spacingX),
                y: region.y + layout.offsetY + row * (layout.cellHeight + layout.spacingY),
                width: layout.cellWidth,
                height: layout.cellHeight,
            });
        }
    }
    return rects;
}

interface Drag {
    pointerId: number;
    /** Where the press was, in source pixels. */
    from: { x: number; y: number };
    /** Moving the crop rectangle as it was at the press; otherwise drawing a new one. */
    moving: PixelRect | null;
}

/**
 * The source pane of Import PNG (DESIGN §7): the source image, the crop rectangle and the
 * grid cells over it. Dragging inside the crop rectangle moves it; dragging elsewhere draws a
 * new one. The pointer is the quick way; the Region fields of the form do the same.
 */
export function SourcePane({
    pixels,
    crop,
    grid,
    onCrop,
}: {
    pixels: PixelBuffer;
    crop: PixelRect | null;
    grid: GridOptions | null;
    onCrop(rect: PixelRect): void;
}) {
    const drag = useRef<Drag | null>(null);
    const { width, height } = pixels;
    const scale = sourceScale(width, height);
    const shown = { width: width * scale, height: height * scale };
    const region = crop ?? { x: 0, y: 0, width, height };

    const pointAt = (event: ReactPointerEvent<SVGSVGElement>, round: (n: number) => number) => {
        const box = event.currentTarget.getBoundingClientRect();
        const x = round(((event.clientX - box.left) / box.width) * width);
        const y = round(((event.clientY - box.top) / box.height) * height);
        return { x: Math.min(width, Math.max(0, x)), y: Math.min(height, Math.max(0, y)) };
    };
    const inside = (point: { x: number; y: number }, rect: PixelRect) =>
        point.x >= rect.x &&
        point.y >= rect.y &&
        point.x < rect.x + rect.width &&
        point.y < rect.y + rect.height;

    return (
        <div className="import-source" data-import-source-pane="">
            <div className="import-source__frame" style={shown}>
                <PixelCanvas
                    pixels={pixels}
                    className="import-source__image"
                    style={shown}
                    data-import-source=""
                />
                <svg
                    className="import-source__overlay"
                    viewBox={`0 0 ${width} ${height}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    data-import-overlay=""
                    onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        const from = pointAt(event, Math.floor);
                        event.currentTarget.setPointerCapture(event.pointerId);
                        drag.current = {
                            pointerId: event.pointerId,
                            from,
                            moving: crop && inside(from, crop) ? crop : null,
                        };
                    }}
                    onPointerMove={(event) => {
                        const current = drag.current;
                        if (!current || current.pointerId !== event.pointerId) return;
                        if (current.moving) {
                            const at = pointAt(event, Math.floor);
                            const { moving } = current;
                            const x = moving.x + at.x - current.from.x;
                            const y = moving.y + at.y - current.from.y;
                            onCrop({
                                ...moving,
                                x: Math.min(width - moving.width, Math.max(0, x)),
                                y: Math.min(height - moving.height, Math.max(0, y)),
                            });
                            return;
                        }
                        const at = pointAt(event, Math.round);
                        const x0 = Math.min(current.from.x, at.x);
                        const y0 = Math.min(current.from.y, at.y);
                        const x1 = Math.max(current.from.x + 1, at.x);
                        const y1 = Math.max(current.from.y + 1, at.y);
                        if (
                            Math.abs(at.x - current.from.x) < 1 &&
                            Math.abs(at.y - current.from.y) < 1
                        ) {
                            return;
                        }
                        onCrop({
                            x: x0,
                            y: y0,
                            width: Math.min(width, x1) - x0,
                            height: Math.min(height, y1) - y0,
                        });
                    }}
                    onPointerUp={(event) => {
                        if (drag.current?.pointerId === event.pointerId) drag.current = null;
                    }}
                    onPointerCancel={() => {
                        drag.current = null;
                    }}
                >
                    {crop ? (
                        <>
                            <path
                                className="import-source__shade"
                                fillRule="evenodd"
                                d={`M0 0H${width}V${height}H0Z M${crop.x} ${crop.y}h${crop.width}v${crop.height}h${-crop.width}Z`}
                            />
                            <rect
                                className="import-source__crop"
                                x={crop.x}
                                y={crop.y}
                                width={crop.width}
                                height={crop.height}
                                data-import-crop={`${crop.x},${crop.y},${crop.width},${crop.height}`}
                            />
                        </>
                    ) : null}
                    {grid
                        ? cellRects(region, grid).map((rect) => (
                              <rect
                                  key={`${rect.x},${rect.y}`}
                                  className="import-source__cell"
                                  x={rect.x}
                                  y={rect.y}
                                  width={rect.width}
                                  height={rect.height}
                                  data-import-cell=""
                              />
                          ))
                        : null}
                </svg>
            </div>
        </div>
    );
}
