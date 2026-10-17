import type { ToolSpec } from "../types";
import { createSprayTool } from "./sprayTool";
import type { SpraySeeds } from "./sprayTool";

// The spray of the app (SPEC §7.1, SE-065). Each stroke takes a seed from `spraySeeds`, which
// draws a random one; a test may replace `next` to make the strokes it draws reproducible.

export const spraySeeds: SpraySeeds = {
    next: () => Math.floor(Math.random() * 2 ** 32),
};

export const sprayTool: ToolSpec = createSprayTool({ next: () => spraySeeds.next() });

export const tools: ToolSpec[] = [sprayTool];
