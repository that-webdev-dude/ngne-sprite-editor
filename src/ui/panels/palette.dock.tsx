import type { DockPanel } from "../dock/registry";
import "./panels.css";

/** Empty until SE-016 adds the swatch grid (DESIGN §5.4). */
function PalettePanel() {
    return <div className="panel-placeholder panel-placeholder--palette" />;
}

export const dockPanel: DockPanel = {
    id: "palette",
    title: "Palette",
    order: 20,
    Body: PalettePanel,
    // DESIGN §2: collapsed by default at window heights under 800 px.
    collapseBelowHeight: 800,
};
