import type { PixelPoint } from "../../../core/raster";
import type { SelectionMode } from "../../../core/selection";
import type { ToolContext, ToolPointer, ToolSpec } from "../../tools/types";
import { shapeMask } from "./pendingShape";
import type { PendingStore } from "./pendingShape";
import { applySelection, SELECTION_HINT, SELECTION_MODE, selectionModeOf } from "./selectionMode";

// The lasso and the polygon lasso (SPEC §7.1, SE-031). Both select the polygon of
// `core/selection` through their points (Bresenham sides, the last point joined to the first,
// the pixels whose centres lie inside by the even-odd rule); fewer than 3 points select
// nothing, so with Replace they deselect. The mode is the one of the first press.
//
//   Lasso          the press and every sample of the drag after it is a point (a sample on
//                  the pixel of the point before adds none); the release closes the path.
//   Polygon lasso  a gesture of several presses (SPEC §7.8, `gesture`): every press and
//                  every release adds the pixel under the pointer as a vertex, unless it is
//                  the last vertex already; Enter or a double click closes the polygon
//                  through the vertices. The pending shape runs on to the pointer.
//
// Escape takes the gesture back; for the polygon lasso so does a change of tool or document.

/** The points of a path, each a pixel other than the one before. */
class Path {
    readonly points: PixelPoint[] = [];

    /** Adds `pixel` unless it is the last point already. */
    add(pixel: PixelPoint): void {
        const last = this.points[this.points.length - 1];
        if (last && last.x === pixel.x && last.y === pixel.y) return;
        this.points.push({ x: pixel.x, y: pixel.y });
    }

    /** The points, with `pointer` after them unless it is the last one. */
    through(pointer: PixelPoint | null): PixelPoint[] {
        const last = this.points[this.points.length - 1];
        const points = [...this.points];
        if (pointer && !(last && last.x === pointer.x && last.y === pointer.y)) {
            points.push({ x: pointer.x, y: pointer.y });
        }
        return points;
    }
}

interface Trace {
    readonly path: Path;
    readonly mode: SelectionMode;
    /** Where the pointer is now (the polygon lasso's pending vertex). */
    pointer: PixelPoint | null;
}

export interface LassoSpec {
    id: string;
    label: string;
    variantOf?: string;
    shortcut?: string;
    railOrder?: number;
    icon?: ToolSpec["icon"];
}

/** Selects the polygon through `points` on the stroke's document. */
function select(
    context: ToolContext,
    points: readonly PixelPoint[],
    mode: SelectionMode,
    label: string,
): void {
    const { width, height } = context.session.doc;
    applySelection(context, shapeMask({ kind: "polygon", points }, width, height), mode, label);
}

/** The freehand lasso, showing its path in `pending`. */
export function lassoTool(spec: LassoSpec, pending: PendingStore): ToolSpec {
    const traces = new WeakMap<ToolContext, Trace>();

    const follow = (context: ToolContext, pointer: ToolPointer) => {
        const trace = traces.get(context);
        if (!trace) return;
        const before = trace.path.points.length;
        trace.path.add(pointer.pixel);
        if (trace.path.points.length !== before) {
            pending.set(context.session, { kind: "polygon", points: trace.path.through(null) });
        }
    };

    return {
        ...spec,
        hint: SELECTION_HINT,
        options: [SELECTION_MODE],
        cursor: "crosshair",
        onDown(context, pointer) {
            const trace: Trace = {
                path: new Path(),
                mode: selectionModeOf(context.options, pointer.modifiers),
                pointer: null,
            };
            traces.set(context, trace);
            follow(context, pointer);
        },
        onMove: follow,
        onUp(context, pointer) {
            follow(context, pointer);
            const trace = traces.get(context);
            traces.delete(context);
            pending.clear();
            if (trace) select(context, trace.path.points, trace.mode, spec.label);
        },
        onCancel(context) {
            traces.delete(context);
            pending.clear();
        },
    };
}

/** The status-bar hint of the polygon lasso. */
export const POLYGON_LASSO_HINT = `Enter or double-click: close · ${SELECTION_HINT}`;

/** The polygon lasso, showing its polygon so far in `pending`. */
export function polygonLassoTool(spec: LassoSpec, pending: PendingStore): ToolSpec {
    const traces = new WeakMap<ToolContext, Trace>();

    const show = (context: ToolContext, trace: Trace) =>
        pending.set(context.session, {
            kind: "polygon",
            points: trace.path.through(trace.pointer),
        });

    /** Follows the pointer; with `vertex`, its pixel becomes a vertex. */
    const at = (context: ToolContext, pointer: ToolPointer, vertex: boolean) => {
        const trace = traces.get(context);
        if (!trace) return;
        trace.pointer = { x: pointer.pixel.x, y: pointer.pixel.y };
        if (vertex) trace.path.add(pointer.pixel);
        show(context, trace);
    };

    const end = (context: ToolContext) => {
        traces.delete(context);
        pending.clear();
    };

    return {
        ...spec,
        hint: POLYGON_LASSO_HINT,
        options: [SELECTION_MODE],
        cursor: "crosshair",
        onDown(context, pointer) {
            if (!traces.has(context)) {
                // The first press opens the gesture; its modifiers set the mode.
                traces.set(context, {
                    path: new Path(),
                    mode: selectionModeOf(context.options, pointer.modifiers),
                    pointer: null,
                });
                context.openGesture();
            }
            at(context, pointer, true);
        },
        onMove: (context, pointer) => at(context, pointer, false),
        onUp: (context, pointer) => at(context, pointer, true),
        onHover: (context, pointer) => at(context, pointer, false),
        onClose(context) {
            const trace = traces.get(context);
            end(context);
            if (trace) select(context, trace.path.points, trace.mode, spec.label);
        },
        onCancel: end,
    };
}
