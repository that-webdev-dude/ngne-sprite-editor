import type { ToolSpec } from "../../tools/types";
import { floatingState } from "../floatingState";
import { createMoveTool } from "./moveTool";

// The Move tool of the app (SE-032), on the app's floating selection. It takes the rail slot
// planned for it (`planned.tools.ts`: the select group, key V, its icon). Its transform
// handles (SE-033) are sized in CSS pixels, so it reads the device pixel ratio.

export const moveTool: ToolSpec = createMoveTool({
    floating: floatingState,
    ratio: () => globalThis.devicePixelRatio || 1,
});

export const tools: ToolSpec[] = [moveTool];
