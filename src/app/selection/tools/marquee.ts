import type { PixelPoint } from "../../../core/raster";
import { createMask } from "../../../core/selection";
import type { SelectionMode } from "../../../core/selection";
import type { ToolContext, ToolPointer, ToolSpec } from "../../tools/types";
import { cornersRect, shapeMask } from "./pendingShape";
import type { PendingStore } from "./pendingShape";
import { applySelection, SELECTION_HINT, SELECTION_MODE, selectionModeOf } from "./selectionMode";

// The rectangular and elliptical marquees (SPEC §7.1, SE-031). The press fixes one corner and
// the pointer the other, both pixels included; the release selects the rectangle, or the
// filled ellipse that fits it (`core/selection`), combined with the selection by the mode of
// the press. Until the pointer has left the pressed pixel the gesture is a click, which
// selects nothing (so a click with Replace deselects). The pending shape shows on the overlay
// from the first move to another pixel. Escape takes the gesture back.

interface Drag {
    readonly start: PixelPoint;
    readonly mode: SelectionMode;
    end: PixelPoint;
    /** The pointer has left the pressed pixel. */
    moved: boolean;
}

export interface MarqueeSpec {
    id: string;
    label: string;
    kind: "rectangle" | "ellipse";
    /** The rail slot it is a variant of (`ToolSpec.variantOf`). */
    variantOf?: string;
    shortcut?: string;
    railOrder?: number;
    icon?: ToolSpec["icon"];
}

/** A marquee tool showing its pending shape in `pending`. */
export function marqueeTool(spec: MarqueeSpec, pending: PendingStore): ToolSpec {
    const drags = new WeakMap<ToolContext, Drag>();

    const shapeOf = (drag: Drag) => ({ kind: spec.kind, rect: cornersRect(drag.start, drag.end) });

    const follow = (context: ToolContext, pointer: ToolPointer) => {
        const drag = drags.get(context);
        if (!drag) return;
        drag.end = { x: pointer.pixel.x, y: pointer.pixel.y };
        if (drag.end.x !== drag.start.x || drag.end.y !== drag.start.y) drag.moved = true;
        if (drag.moved) pending.set(context.session, shapeOf(drag));
    };

    return {
        id: spec.id,
        label: spec.label,
        icon: spec.icon,
        shortcut: spec.shortcut,
        railOrder: spec.railOrder,
        variantOf: spec.variantOf,
        hint: SELECTION_HINT,
        options: [SELECTION_MODE],
        cursor: "crosshair",
        onDown(context, pointer) {
            const start = { x: pointer.pixel.x, y: pointer.pixel.y };
            drags.set(context, {
                start,
                end: start,
                mode: selectionModeOf(context.options, pointer.modifiers),
                moved: false,
            });
        },
        onMove: follow,
        onUp(context, pointer) {
            follow(context, pointer);
            const drag = drags.get(context);
            drags.delete(context);
            pending.clear();
            if (!drag) return;
            const { width, height } = context.session.doc;
            const shape = drag.moved
                ? shapeMask(shapeOf(drag), width, height)
                : createMask(width, height);
            applySelection(context, shape, drag.mode, spec.label);
        },
        onCancel(context) {
            drags.delete(context);
            pending.clear();
        },
    };
}
