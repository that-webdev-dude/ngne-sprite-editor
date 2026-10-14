import { railGroups } from "../../../app/tools/registry";
import { Icon } from "../../primitives/Icon";
import { ToolButton } from "../../primitives/ToolButton";
import { useToolState } from "../../tools/useToolState";
import { RailGroup } from "../RailFrame";

/**
 * Tool rail content (DESIGN §5.1), rendered from the tool registry (SE-014): a button per
 * slot, in the groups of the rail. A registered tool's button selects it; the active tool's
 * is pressed (a tool held with its key while it is held). A slot planned for a later ticket
 * is a disabled button until its tool is registered. SE-016 adds the colour chips in a
 * `RailFooter`.
 */
export function ToolRail() {
    const tools = useToolState();
    const active = tools.activeId();
    return railGroups(tools.registry.railSlots()).map((group) => (
        <RailGroup key={group[0]?.id}>
            {group.map((slot) => (
                <ToolButton
                    key={slot.id}
                    label={slot.label}
                    shortcut={slot.shortcut}
                    data-tool={slot.id}
                    active={slot.tool !== null && slot.id === active}
                    disabled={slot.tool === null}
                    onClick={() => tools.select(slot.id)}
                >
                    {slot.icon ? <Icon icon={slot.icon} /> : null}
                </ToolButton>
            ))}
        </RailGroup>
    ));
}
