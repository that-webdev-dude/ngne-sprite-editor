import type { DockPanel } from "../dock/registry";
import "./panels.css";

/** Empty until SE-016 adds the colour picker (DESIGN §5.3). */
function ColourPanel() {
    return <div className="panel-placeholder panel-placeholder--colour" />;
}

export const dockPanel: DockPanel = { id: "colour", title: "Colour", order: 10, Body: ColourPanel };
