import type { CommandSpec } from "../commands/types";
import { activeSymmetry, followDocumentSizes, setSymmetry, setTiledMode } from "./symmetry";
import type { SymmetryMode, TiledMode } from "./symmetry";

// The View menu's symmetry and tiled mode toggles (SPEC §2.3 View; SE-062), in the group of
// the items planned for them (`view.symmetry`, `view.tiled`), which they replace. Symmetry and
// tiled mode each have an axis per direction, X and Y, switched on and off on their own, so
// "both" is the two toggles on (as Aseprite's two symmetry buttons). A menu item of the
// registry has no checked state, so each title says what choosing it does, as the grid and
// onion toggles' do (REVIEW E37). They change `DocSettings` with no history entry and do not
// set the dirty flag (SPEC §5.2); being view preferences they are enabled during a stroke or a
// floating selection, and a stroke under way keeps the symmetry it began with. No key is bound.

export const SYMMETRY_X_COMMAND = "view.symmetryX";
export const SYMMETRY_Y_COMMAND = "view.symmetryY";
export const TILED_X_COMMAND = "view.tiledX";
export const TILED_Y_COMMAND = "view.tiledY";

/** Whether `mode` has the axis `axis` on. */
const has = (mode: SymmetryMode | TiledMode, axis: "x" | "y") => mode === axis || mode === "both";

/** `mode` with the axis `axis` switched over. */
function toggled<Mode extends SymmetryMode | TiledMode>(mode: Mode, axis: "x" | "y"): Mode {
    const x = has(mode, "x") !== (axis === "x");
    const y = has(mode, "y") !== (axis === "y");
    return (x && y ? "both" : x ? "x" : y ? "y" : "none") as Mode;
}

const hasDocument = () => activeSymmetry() !== null;

function symmetryToggle(id: string, axis: "x" | "y", name: string, order: number): CommandSpec {
    return {
        id,
        title: () => {
            const active = activeSymmetry();
            return `${active && has(active.symmetry.mode, axis) ? "Turn Off" : "Turn On"} ${name}`;
        },
        menuPath: ["View"],
        // The group of the planned items (commands/planned.commands.ts).
        menuOrder: order,
        replaces: ["view.symmetry"],
        enabled: hasDocument,
        run: () => {
            const active = activeSymmetry();
            if (active) setSymmetry({ mode: toggled(active.symmetry.mode, axis) });
        },
    };
}

function tiledToggle(id: string, axis: "x" | "y", name: string, order: number): CommandSpec {
    return {
        id,
        title: () => {
            const active = activeSymmetry();
            return `${active && has(active.tiled, axis) ? "Turn Off" : "Turn On"} ${name}`;
        },
        menuPath: ["View"],
        menuOrder: order,
        replaces: ["view.tiled"],
        enabled: hasDocument,
        run: () => {
            const active = activeSymmetry();
            if (active) setTiledMode(toggled(active.tiled, axis));
        },
    };
}

// The axes of the app's documents follow their canvas when its size changes (SE-062 review
// B), from when the app loads its commands at start, for the life of the page.
followDocumentSizes();

export const commands: CommandSpec[] = [
    symmetryToggle(SYMMETRY_X_COMMAND, "x", "Horizontal Symmetry", 400),
    symmetryToggle(SYMMETRY_Y_COMMAND, "y", "Vertical Symmetry", 410),
    tiledToggle(TILED_X_COMMAND, "x", "Tiling in X", 420),
    tiledToggle(TILED_Y_COMMAND, "y", "Tiling in Y", 430),
];
