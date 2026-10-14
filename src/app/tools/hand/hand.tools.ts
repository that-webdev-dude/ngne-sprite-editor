import type { Point } from "../../view/coordinates";
import { panBy } from "../../view/viewNavigation";
import type { ToolSpec } from "../types";

// The hand tool (SPEC §7.1): a drag pans the view, by `panBy`, which keeps the pan limit
// (SE-012). Holding Space makes it the active tool from any other (SPEC §7.8). Its rail slot,
// key (H) and icon are planned in `planned.tools.ts`.

/** The drag in progress: where it began and how much of it the view has taken. */
let drag: { start: Point; movedX: number; movedY: number } | null = null;

export const handTool: ToolSpec = {
    id: "hand",
    label: "Hand",
    hold: { key: "Space" },
    cursor: ({ pressed }) => (pressed ? "grabbing" : "grab"),
    onDown(_context, pointer) {
        drag = { start: pointer.device, movedX: 0, movedY: 0 };
    },
    onMove(_context, pointer) {
        if (!drag) return;
        // The whole drag in device pixels, less what was applied: nothing is lost to rounding.
        const x = Math.round(pointer.device.x - drag.start.x);
        const y = Math.round(pointer.device.y - drag.start.y);
        const dx = x - drag.movedX;
        const dy = y - drag.movedY;
        drag.movedX = x;
        drag.movedY = y;
        if (dx !== 0 || dy !== 0) panBy(dx, dy);
    },
    onUp() {
        drag = null;
    },
    onCancel() {
        drag = null;
    },
};

export const tools: ToolSpec[] = [handTool];
