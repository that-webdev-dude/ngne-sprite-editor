import type { DockPanel } from "../dock/registry";
import "./panels.css";

/** Empty until SE-054 adds the NGNE preview (DESIGN §5.5). */
function PreviewPanel() {
    return <div className="panel-placeholder panel-placeholder--preview" />;
}

export const dockPanel: DockPanel = {
    id: "preview",
    title: "Preview · NGNE",
    order: 30,
    Body: PreviewPanel,
};
