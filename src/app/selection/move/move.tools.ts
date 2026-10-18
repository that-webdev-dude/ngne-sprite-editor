import type { ToolSpec } from "../../tools/types";
import { floatingState } from "../floatingState";
import { createMoveTool } from "./moveTool";

// The Move tool of the app (SE-032), on the app's floating selection. It takes the rail slot
// planned for it (`planned.tools.ts`: the select group, key V, its icon).

export const moveTool: ToolSpec = createMoveTool({ floating: floatingState });

export const tools: ToolSpec[] = [moveTool];
