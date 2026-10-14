import type { DocSettings } from "../../core/model";
import { activeDocument, sessionsStore } from "../state/sessions";
import { clipToRects, fillRects } from "./draw";
import {
    axesOf,
    cellsBetween,
    lineRects,
    pixelGridLines,
    tileGridLines,
    visiblePart,
} from "./gridLines";
import type { OverlayFrame, OverlayLayer } from "./types";

// The pixel grid and the tile grid (DESIGN §6), drawn from `DocSettings.pixelGrid` and
// `DocSettings.grid` of the active document (the View menu toggles them, `grid.commands.ts`).
// Lines lie on texel boundaries (`gridLines.ts`), in the theme's ink: white in the dark
// theme, black in the light one.

/** Strength of the pixel grid's ink (DESIGN §6). */
export const PIXEL_GRID_ALPHA = 0.12;
/** Strength of the tile grid's ink (DESIGN §6). */
export const TILE_GRID_ALPHA = 0.25;

/** The geometry both grids are drawn in; null when the document is off the canvas. */
function placement(frame: OverlayFrame) {
    const { mapping, document, size } = frame;
    const area = visiblePart(mapping.rect, size);
    if (!area) return null;
    return { area, axes: axesOf(mapping.rect, document.session.doc, size) };
}

/**
 * Calls `redraw` when what `read` takes from the active document's settings changes. A
 * history step, a pixel edit or a change of another setting leaves it alone.
 */
function followSettings(read: (settings: DocSettings) => string) {
    return (redraw: () => void): (() => void) => {
        const current = () => {
            const document = activeDocument(sessionsStore.getState());
            return document ? read(document.session.doc.settings) : null;
        };
        let seen = current();
        return sessionsStore.subscribe(() => {
            const next = current();
            if (next === seen) return;
            seen = next;
            redraw();
        });
    };
}

const gridKey = ({ grid }: DocSettings) =>
    `${grid.visible}:${grid.width}x${grid.height}@${grid.offsetX},${grid.offsetY}`;

export const overlayLayers: OverlayLayer[] = [
    {
        id: "pixel-grid",
        order: 200,
        draw(frame) {
            const { settings } = frame.document.session.doc;
            if (!settings.pixelGrid) return;
            const placed = placement(frame);
            if (!placed) return;
            const lines = pixelGridLines(placed.axes, frame.mapping.frame.view.scale);
            if (lines.columns.length === 0 && lines.rows.length === 0) return;
            const { context } = frame;
            // Where a tile-grid line runs, that line alone shows, at its own strength.
            if (settings.grid.visible) {
                const tiles = tileGridLines(placed.axes, settings.grid);
                if (tiles.columns.length > 0 || tiles.rows.length > 0) {
                    clipToRects(context, cellsBetween(tiles, placed.area));
                }
            }
            fillRects(context, lineRects(lines, placed.area), frame.theme.ink, PIXEL_GRID_ALPHA);
        },
        // The tile grid takes its lines out of this one.
        watch: followSettings((settings) => `${settings.pixelGrid}|${gridKey(settings)}`),
    },
    {
        id: "tile-grid",
        order: 300,
        draw(frame) {
            const { settings } = frame.document.session.doc;
            if (!settings.grid.visible) return;
            const placed = placement(frame);
            if (!placed) return;
            const lines = tileGridLines(placed.axes, settings.grid);
            fillRects(
                frame.context,
                lineRects(lines, placed.area),
                frame.theme.ink,
                TILE_GRID_ALPHA,
            );
        },
        watch: followSettings(gridKey),
    },
];
