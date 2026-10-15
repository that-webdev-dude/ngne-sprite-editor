import { activeComposites } from "../../state/composites";
import { editorStore } from "../../state/editor";
import type { ToolSpec } from "../types";
import { createEyedropper } from "./eyedropper";

// The eyedropper of the app (SPEC §7.1, SE-016), on the app's composites and editor store.
// Its rail slot, key (I) and icon are planned in `planned.tools.ts`; Alt holds it.

export const eyedropperTool: ToolSpec = createEyedropper({
    editor: editorStore,
    composites: activeComposites,
});

export const tools: ToolSpec[] = [eyedropperTool];
