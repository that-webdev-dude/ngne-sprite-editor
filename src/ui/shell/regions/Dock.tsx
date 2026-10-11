import { useState } from "react";
import { DockSection } from "../../dock/DockSection";
import { dockPanels } from "../../dock/registry";
import { useWindowHeight } from "../../platform/useWindowSize";

/**
 * Dock content: one section per registered panel (dock/registry.ts), in registry order. A
 * section the user has not toggled follows its panel's default for the current window height.
 */
export function Dock() {
    const windowHeight = useWindowHeight();
    const [chosen, setChosen] = useState<Record<string, boolean>>({});
    return dockPanels.map((panel) => {
        const byDefault =
            panel.collapseBelowHeight !== undefined && windowHeight < panel.collapseBelowHeight;
        return (
            <DockSection
                key={panel.id}
                panel={panel}
                collapsed={chosen[panel.id] ?? byDefault}
                onCollapsedChange={(collapsed) =>
                    setChosen((current) => ({ ...current, [panel.id]: collapsed }))
                }
            />
        );
    });
}
