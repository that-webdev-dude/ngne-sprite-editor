import type { CommandSpec } from "../commands/types";
import { activeView, canNavigate, fitActiveView, zoomBy, zoomTo } from "./viewNavigation";
import { KEY_ZOOMS, MAX_ZOOM, MIN_ZOOM } from "./zoom";

// View navigation commands (SE-012). Zoom In, Zoom Out, Fit and 100% take the items planned
// for them in the View menu (commands/planned.commands.ts). SPEC §7.8 binds the keys 1 to 6 to
// the zooms 1×, 2×, 4×, 8×, 16× and 32× and 0 to "fit and centre", all in the canvas context;
// "100%" is 1× (SPEC §6.4), so key 1 is its shortcut. Zoom In and Zoom Out have no key: the
// wheel does that.
//
// Without a cursor to zoom about, a command keeps the centre of the viewport in place.
// Each command needs a document and a viewport size; `enabled` reads `viewportSize` as well
// as the session store, so the component that observes the viewport region refreshes the
// registry when a size is reported (ui/viewport/ViewportProbe).

function scale(): number | null {
    return canNavigate() ? (activeView()?.scale ?? null) : null;
}

/** The commands of the keys 2 to 6; key 1 is "100%". */
const keyZooms: CommandSpec[] = KEY_ZOOMS.slice(1).map((zoom, index) => ({
    id: `view.zoom${zoom}x`,
    title: `Zoom ${zoom}×`,
    shortcut: String(index + 2),
    context: "canvas",
    enabled: canNavigate,
    run: () => zoomTo(zoom),
}));

export const commands: CommandSpec[] = [
    {
        id: "view.zoomIn",
        title: "Zoom In",
        enabled: () => (scale() ?? MAX_ZOOM) < MAX_ZOOM,
        run: () => zoomBy(1),
    },
    {
        id: "view.zoomOut",
        title: "Zoom Out",
        enabled: () => (scale() ?? MIN_ZOOM) > MIN_ZOOM,
        run: () => zoomBy(-1),
    },
    {
        id: "view.fit",
        title: "Fit",
        shortcut: "0",
        context: "canvas",
        enabled: canNavigate,
        run: fitActiveView,
    },
    {
        id: "view.zoom100",
        title: "100%",
        shortcut: String(KEY_ZOOMS.indexOf(1) + 1),
        context: "canvas",
        enabled: canNavigate,
        run: () => zoomTo(1),
    },
    ...keyZooms,
];
