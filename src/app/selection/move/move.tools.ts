import { referencePreview } from "../../references/referencePreview";
import { changeReference, referenceSourceSize } from "../../references/references";
import type { ToolSpec } from "../../tools/types";
import { floatingState } from "../floatingState";
import { createMoveTool } from "./moveTool";

// The Move tool of the app (SE-032), on the app's floating selection. It takes the rail slot
// planned for it (`planned.tools.ts`: the select group, key V, its icon). Its transform
// handles (SE-033) are sized in CSS pixels, so it reads the device pixel ratio. A drag of a
// reference layer (SE-046) is shown through the app's reference preview, which the viewport
// draws, and recorded with `changeReference`.

export const moveTool: ToolSpec = createMoveTool({
    floating: floatingState,
    ratio: () => globalThis.devicePixelRatio || 1,
    references: {
        preview: referencePreview,
        sourceSize: referenceSourceSize,
        change: (_context, layerId, change, label) => changeReference(layerId, change, label),
    },
});

export const tools: ToolSpec[] = [moveTool];
