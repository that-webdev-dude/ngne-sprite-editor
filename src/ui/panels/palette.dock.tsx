import { PaletteGrid } from "../colour/PaletteGrid";
import type { DockPanel } from "../dock/registry";

/** The palette (DESIGN §5.4): a read-only grid of the document palette until SE-060. */
export const dockPanel: DockPanel = {
    id: "palette",
    title: "Palette",
    order: 20,
    Body: PaletteGrid,
    // DESIGN §2: collapsed by default at window heights under 800 px.
    collapseBelowHeight: 800,
};
