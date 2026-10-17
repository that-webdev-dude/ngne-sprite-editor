import { CircleDashed, Pentagon } from "lucide-react";
import { activeComposites } from "../../state/composites";
import type { ToolSpec } from "../../tools/types";
import { lassoTool, polygonLassoTool } from "./lasso";
import { marqueeTool } from "./marquee";
import { pendingSelection } from "./pendingShape";
import { createWand } from "./wand";

// The selection tools of the app (SPEC §7.1, SE-031). The rectangular marquee, the lasso and
// the magic wand take the rail slots planned for them (`planned.tools.ts`: M, Q, W); the
// elliptical marquee (Shift+M) and the polygon lasso (Shift+Q) are variants of the marquee's
// and the lasso's slots (DESIGN §5.1). Each keeps its own option values (SPEC §7.1).

export const rectangleMarqueeTool: ToolSpec = marqueeTool(
    { id: "marquee", label: "Rectangular marquee", kind: "rectangle" },
    pendingSelection,
);

export const ellipseMarqueeTool: ToolSpec = marqueeTool(
    {
        id: "ellipse-marquee",
        label: "Elliptical marquee",
        kind: "ellipse",
        variantOf: "marquee",
        shortcut: "Shift+M",
        railOrder: 301,
        icon: CircleDashed,
    },
    pendingSelection,
);

export const freehandLassoTool: ToolSpec = lassoTool(
    { id: "lasso", label: "Lasso" },
    pendingSelection,
);

export const polygonLasso: ToolSpec = polygonLassoTool(
    {
        id: "polygon-lasso",
        label: "Polygon lasso",
        variantOf: "lasso",
        shortcut: "Shift+Q",
        railOrder: 311,
        icon: Pentagon,
    },
    pendingSelection,
);

export const wandTool: ToolSpec = createWand({ composites: activeComposites }, pendingSelection);

export const tools: ToolSpec[] = [
    rectangleMarqueeTool,
    ellipseMarqueeTool,
    freehandLassoTool,
    polygonLasso,
    wandTool,
];
