import { PaletteGrid } from "../colour/PaletteGrid";
import { PaletteHeader } from "../colour/PaletteHeader";
import type { DockPanel } from "../dock/registry";

/**
 * The palette (DESIGN §5.4, SE-060): the grid of the document palette, and in the header the
 * preset menu, the add button and the overflow menu of the swatch actions.
 */
export const dockPanel: DockPanel = {
    id: "palette",
    title: "Palette",
    order: 20,
    Body: PaletteGrid,
    HeaderExtra: PaletteHeader,
    // DESIGN §2: collapsed by default at window heights under 800 px.
    collapseBelowHeight: 800,
};
