import { railGroups } from "../../../app/tools/registry";
import { ColourChips } from "../../colour/ColourChips";
import { Icon } from "../../primitives/Icon";
import { ToolButton } from "../../primitives/ToolButton";
import { useToolState } from "../../tools/useToolState";
import { VariantToolButton } from "../../tools/VariantToolButton";
import { RailFooter, RailGroup } from "../RailFrame";

/**
 * Tool rail content (DESIGN §5.1), rendered from the tool registry (SE-014): a button per
 * slot, in the groups of the rail. A registered tool's button selects it; the active tool's
 * is pressed (a tool held with its key while it is held). A slot planned for a later ticket
 * is a disabled button until its tool is registered. A slot with variants (SE-031) shows the
 * one selected last, with a corner mark, and holding it opens the menu of its variants. The
 * colour chips and their reset button sit in the `RailFooter` (SE-016).
 */
export function ToolRail() {
    const tools = useToolState();
    const active = tools.activeId();
    return (
        <>
            {railGroups(tools.registry.railSlots()).map((group) => (
                <RailGroup key={group[0]?.id}>
                    {group.map((slot) => {
                        const shown = tools.shownInSlot(slot);
                        if (shown && slot.variants.length > 1) {
                            return (
                                <VariantToolButton
                                    key={slot.id}
                                    slot={slot}
                                    shown={shown}
                                    active={shown.id === active}
                                    select={(id) => void tools.select(id)}
                                />
                            );
                        }
                        const icon = shown?.icon ?? slot.icon;
                        return (
                            <ToolButton
                                key={slot.id}
                                label={shown?.label ?? slot.label}
                                shortcut={shown?.shortcut ?? slot.shortcut}
                                data-tool={slot.id}
                                active={shown !== null && shown.id === active}
                                disabled={shown === null}
                                onClick={() => shown && tools.select(shown.id)}
                            >
                                {icon ? <Icon icon={icon} /> : null}
                            </ToolButton>
                        );
                    })}
                </RailGroup>
            ))}
            <RailFooter>
                <ColourChips />
            </RailFooter>
        </>
    );
}
