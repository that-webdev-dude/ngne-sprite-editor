import type { DockPanel } from "../dock/registry";
import { PreviewPanel } from "../preview/PreviewPanel";

/** The NGNE preview (DESIGN §5.5, SE-054): the engine playing the export's atlas. */
export const dockPanel: DockPanel = {
    id: "preview",
    title: "Preview · NGNE",
    order: 30,
    Body: PreviewPanel,
};
