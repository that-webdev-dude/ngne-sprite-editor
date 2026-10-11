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
import type { LucideIcon } from "lucide-react";
import { Icon } from "../../primitives/Icon";
import { ToolButton } from "../../primitives/ToolButton";
import { RailGroup } from "../RailFrame";

interface RailTool {
    id: string;
    label: string;
    shortcut: string;
    icon: LucideIcon;
}

/** The groups of DESIGN §5.1 with the keys of SPEC §7.8. */
const GROUPS: readonly (readonly RailTool[])[] = [
    [
        { id: "pencil", label: "Pencil", shortcut: "B", icon: Pencil },
        { id: "eraser", label: "Eraser", shortcut: "E", icon: Eraser },
        { id: "bucket", label: "Paint bucket", shortcut: "G", icon: PaintBucket },
        { id: "eyedropper", label: "Eyedropper", shortcut: "I", icon: Pipette },
    ],
    [
        { id: "line", label: "Line", shortcut: "L", icon: Slash },
        { id: "rectangle", label: "Rectangle", shortcut: "U", icon: Square },
        { id: "ellipse", label: "Ellipse", shortcut: "Shift+U", icon: Circle },
    ],
    [
        { id: "marquee", label: "Marquee", shortcut: "M", icon: SquareDashed },
        { id: "lasso", label: "Lasso", shortcut: "Q", icon: Lasso },
        { id: "wand", label: "Magic wand", shortcut: "W", icon: WandSparkles },
        { id: "move", label: "Move", shortcut: "V", icon: Move },
    ],
    [
        { id: "hand", label: "Hand", shortcut: "H", icon: Hand },
        { id: "zoom", label: "Zoom", shortcut: "Z", icon: ZoomIn },
    ],
];

/**
 * Tool rail content. Placeholder buttons, disabled because no tool exists yet: SE-014 renders
 * the rail from its tool registry, and SE-016 adds the colour chips in a `RailFooter`.
 */
export function ToolRail() {
    return GROUPS.map((group) => (
        <RailGroup key={group[0]?.id}>
            {group.map((tool) => (
                <ToolButton
                    key={tool.id}
                    label={tool.label}
                    shortcut={tool.shortcut}
                    data-tool={tool.id}
                    disabled
                >
                    <Icon icon={tool.icon} />
                </ToolButton>
            ))}
        </RailGroup>
    ));
}
