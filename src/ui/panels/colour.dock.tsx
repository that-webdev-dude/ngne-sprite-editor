import { ColourPicker } from "../colour/ColourPicker";
import type { DockPanel } from "../dock/registry";

/** The colour panel (DESIGN §5.3, SE-016): it edits the foreground colour. */
export const dockPanel: DockPanel = {
    id: "colour",
    title: "Colour",
    order: 10,
    Body: ColourPicker,
};
