import { activeComposites } from "../../state/composites";
import type { ToolSpec } from "../types";
import { createBucket } from "./bucket";

// The paint bucket of the app (SPEC §7.1, SE-017), on the app's composites. Its rail slot, key
// (G) and icon are planned in `planned.tools.ts`.

export const bucketTool: ToolSpec = createBucket({ composites: activeComposites });

export const tools: ToolSpec[] = [bucketTool];
