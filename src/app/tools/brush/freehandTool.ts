import type { DocSession } from "../../../core/model";
import { clonePixelBuffer } from "../../../core/pixels";
import { FreehandStroke, StraightStroke } from "../../../core/raster";
import type { Ink, PixelPoint } from "../../../core/raster";
import type { ToolContext, ToolOptionSpec, ToolPointer, ToolSpec } from "../types";
import { brushOf, paintCursor, PIXEL_PERFECT } from "./brushOptions";

// Freehand paint tools (SPEC §7.1, SE-015): the pencil and the eraser. A stroke stamps the
// tool's brush along the pointer's path (`core/raster` joins the samples with lines) with the
// ink the tool picks for the button. With Shift held at the press, the stroke is a straight
// line from the end of the last stroke on the document (from the press when there is none),
// which follows the pointer until the release. The press keeps a copy of the image: inks read
// the pixels as they were when the stroke began (`core/raster/ink.ts`).
//
// The pipeline (SE-014) opens the stroke's transaction before `onDown` and commits it after
// `onUp`; every change is reported with `markDirty`, over the pixels whose bytes changed only,
// so a stroke that changes nothing records nothing.

/** What a freehand tool's module declares. */
export interface FreehandToolSpec {
    id: string;
    label: string;
    /** In the order of the context bar; the brush options of `brushOptions.ts`. */
    options: readonly ToolOptionSpec[];
    /** The ink of a stroke: from the button (its colour is `context.colour`) and the options. */
    ink(context: ToolContext): Ink;
}

/** One-line hint of the freehand tools' modifiers (DESIGN §5.7). */
export const FREEHAND_HINT = "Shift: straight line from the end of the last stroke";

/** The stroke in progress, by the context of its stroke. */
const strokes = new WeakMap<ToolContext, FreehandStroke | StraightStroke>();
/** Where the last stroke of a freehand tool ended, by document. */
const lastEnds = new WeakMap<DocSession, PixelPoint>();

/** Where the last committed freehand stroke on `session` ended; null when none did yet. */
export function lastStrokeEnd(session: DocSession): PixelPoint | null {
    return lastEnds.get(session) ?? null;
}

function report(context: ToolContext, changed: ReturnType<FreehandStroke["to"]>): void {
    if (changed) context.paint?.markDirty(changed);
}

/** A freehand paint tool. */
export function freehandTool(spec: FreehandToolSpec): ToolSpec {
    return {
        id: spec.id,
        label: spec.label,
        paints: true,
        hint: FREEHAND_HINT,
        options: spec.options,
        cursor: paintCursor,
        onDown(context: ToolContext, pointer: ToolPointer) {
            const { paint, options: values } = context;
            if (!paint) return;
            const options = {
                brush: brushOf(values),
                ink: spec.ink(context),
                pixelPerfect: values[PIXEL_PERFECT.key] === true,
            };
            // The image as the stroke found it, which the inks read.
            const original = clonePixelBuffer(paint.image);
            if (pointer.modifiers.shift) {
                const anchor = lastEnds.get(context.session) ?? pointer.pixel;
                const stroke = new StraightStroke(paint.image, original, options, anchor);
                strokes.set(context, stroke);
                report(context, stroke.to(pointer.pixel));
                return;
            }
            const stroke = new FreehandStroke(paint.image, original, options);
            strokes.set(context, stroke);
            report(context, stroke.start(pointer.pixel));
        },
        onMove(context, pointer) {
            const stroke = strokes.get(context);
            if (stroke) report(context, stroke.to(pointer.pixel));
        },
        onUp(context, pointer) {
            const stroke = strokes.get(context);
            if (!stroke) return;
            strokes.delete(context);
            report(context, stroke.to(pointer.pixel));
            if (stroke.last) lastEnds.set(context.session, stroke.last);
        },
        onCancel(context) {
            strokes.delete(context);
        },
    };
}
