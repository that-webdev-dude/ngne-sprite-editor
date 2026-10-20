import type { StoreApi } from "zustand/vanilla";
import type { SymmetrySettings } from "../../core/model";
import { sessionsStore } from "../state/sessions";
import type { OpenDocument, SessionsState } from "../state/sessions";
import type { Tool, ToolContext, ToolPointer } from "../tools/types";
import type { ViewMapping } from "../view/coordinates";
import { axisGeometry, handleAt } from "./axisGeometry";
import type { AxisName } from "./axisGeometry";
import { setSymmetry } from "./symmetry";

// Dragging a symmetry axis (SE-062). A left press on an axis's handle (`axisGeometry.ts`) is
// grabbed before the active tool (`PipelineSources.grab`): for that press the pointer
// pipeline runs one of the tools below, which moves the axis with the pointer, snapped to
// half pixels, by as much as the pointer moved since the press, so grabbing a handle off its
// centre does not make the axis jump. It changes `DocSettings.symmetry` of the press's
// document as it goes, with no history entry (SPEC §5.2); Escape, a pointer cancel or the
// document left puts the axis back where the press found it. The axis stays on the canvas:
// 0 to twice its side, in half pixels.

/** The pipeline's grab: the tool a left press takes on a handle, or null. */
export type AxisGrab = (
    pointer: ToolPointer,
    document: OpenDocument,
    mapping: ViewMapping,
) => Tool | null;

interface AxisDrag {
    /** The axis in half pixels at the press. */
    readonly start: number;
    /** The pointer's document position across the axis at the press. */
    readonly from: number;
}

const field = (axis: AxisName): "axisX" | "axisY" => (axis === "x" ? "axisX" : "axisY");
const across = (axis: AxisName, pointer: ToolPointer) =>
    axis === "x" ? pointer.position.x : pointer.position.y;

function axisTool(axis: AxisName, sessions: StoreApi<SessionsState>): Tool {
    const key = field(axis);
    const drags = new WeakMap<ToolContext, AxisDrag>();
    const move = (context: ToolContext, pointer: ToolPointer) => {
        const drag = drags.get(context);
        if (!drag) return;
        const patch: Partial<SymmetrySettings> = {
            [key]: drag.start + Math.round(2 * (across(axis, pointer) - drag.from)),
        };
        setSymmetry(patch, context.document.id, sessions);
    };
    return {
        id: `symmetry-axis-${axis}`,
        label: axis === "x" ? "Move Vertical Axis" : "Move Horizontal Axis",
        source: "app/symmetry/axisDrag.ts",
        options: [],
        railOrder: undefined,
        // The vertical axis moves left and right, the horizontal one up and down.
        cursor: axis === "x" ? "ew-resize" : "ns-resize",
        latestSample: true,
        onDown(context, pointer) {
            const start = context.session.doc.settings.symmetry[key];
            drags.set(context, { start, from: across(axis, pointer) });
        },
        onMove: move,
        onUp(context, pointer) {
            move(context, pointer);
            drags.delete(context);
        },
        onCancel(context) {
            const drag = drags.get(context);
            drags.delete(context);
            // The press's document, also when the drag ends because another one became active.
            if (drag) setSymmetry({ [key]: drag.start }, context.document.id, sessions);
        },
    };
}

/**
 * The grab of the axes' handles on the documents of `sessions`: the tool that drags the axis
 * whose handle is under the pointer on the document, shown with `mapping`; null when no handle
 * is there or the document has no symmetry.
 */
export function createAxisGrab(sessions: StoreApi<SessionsState>): AxisGrab {
    const tools: Readonly<Record<AxisName, Tool>> = {
        x: axisTool("x", sessions),
        y: axisTool("y", sessions),
    };
    return (pointer, document, mapping) => {
        const { symmetry } = document.session.doc.settings;
        if (symmetry.mode === "none") return null;
        const geometry = axisGeometry(mapping, symmetry);
        const axis = handleAt(geometry, pointer.device, mapping.frame.ratio);
        return axis ? tools[axis] : null;
    };
}

/** The app's grab, on its session store (`tools/appPipeline.ts`). */
export const grabAxis: AxisGrab = createAxisGrab(sessionsStore);
