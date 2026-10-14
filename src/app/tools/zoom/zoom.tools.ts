import { zoomBy } from "../../view/viewNavigation";
import type { ToolSpec } from "../types";

// The zoom tool (SPEC §7.1): a click zooms in one step, an Alt-click out, about the clicked
// device pixel, so the document pixel under the pointer stays under it (`zoomBy`, which keeps
// the pan limit, SE-012). Its rail slot, key (Z) and icon are planned in `planned.tools.ts`.

export const zoomTool: ToolSpec = {
    id: "zoom",
    label: "Zoom",
    hint: "Alt: zoom out",
    cursor: ({ modifiers }) => (modifiers.alt ? "zoom-out" : "zoom-in"),
    onDown(context, pointer) {
        if (context.button !== "primary") return;
        zoomBy(pointer.modifiers.alt ? -1 : 1, pointer.device);
    },
};

export const tools: ToolSpec[] = [zoomTool];
