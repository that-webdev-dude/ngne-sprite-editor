import {
    Circle,
    Eraser,
    Hand,
    Lasso,
    Move,
    PaintBucket,
    Pencil,
    Pipette,
    Slash,
    Square,
    SquareDashed,
    WandSparkles,
    ZoomIn,
} from "lucide-react";
import type { PlannedToolSpec } from "./types";

/**
 * The slots of the tool rail (DESIGN §5.1) with the keys of SPEC §7.8. Each is shown as a
 * disabled button until a tool with the same id is registered from its ticket's own
 * `*.tools.ts` module; the tool then takes the slot over, its position, key and icon included
 * unless it names its own. Positions are spaced by 10; the hundreds are the rail's groups:
 * draw · shapes · select · navigate.
 */
export const plannedTools: PlannedToolSpec[] = [
    { id: "pencil", label: "Pencil", shortcut: "B", icon: Pencil, railOrder: 100 },
    { id: "eraser", label: "Eraser", shortcut: "E", icon: Eraser, railOrder: 110 },
    { id: "bucket", label: "Paint bucket", shortcut: "G", icon: PaintBucket, railOrder: 120 },
    { id: "eyedropper", label: "Eyedropper", shortcut: "I", icon: Pipette, railOrder: 130 },
    { id: "line", label: "Line", shortcut: "L", icon: Slash, railOrder: 200 },
    { id: "rectangle", label: "Rectangle", shortcut: "U", icon: Square, railOrder: 210 },
    { id: "ellipse", label: "Ellipse", shortcut: "Shift+U", icon: Circle, railOrder: 220 },
    { id: "marquee", label: "Marquee", shortcut: "M", icon: SquareDashed, railOrder: 300 },
    { id: "lasso", label: "Lasso", shortcut: "Q", icon: Lasso, railOrder: 310 },
    { id: "wand", label: "Magic wand", shortcut: "W", icon: WandSparkles, railOrder: 320 },
    { id: "move", label: "Move", shortcut: "V", icon: Move, railOrder: 330 },
    { id: "hand", label: "Hand", shortcut: "H", icon: Hand, railOrder: 400 },
    { id: "zoom", label: "Zoom", shortcut: "Z", icon: ZoomIn, railOrder: 410 },
];
