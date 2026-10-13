import { Component, useEffect } from "react";
import type { ReactNode } from "react";
import { surfaces, useOpenSurface } from "../../app/surfaces/surfaces";
import type { SurfaceId } from "../../app/surfaces/surfaces";
import { CommandPalette } from "../commandPalette/CommandPalette";
import { focusMenuOpener } from "../focus/menuOpener";
import { PreferencesDialog } from "../preferences/PreferencesDialog";
import { ShortcutSheet } from "../shortcuts/ShortcutSheet";
import { toast } from "../toast/toast";

const SURFACES: Record<SurfaceId, { name: string; Surface: () => ReactNode }> = {
    "command-palette": { name: "Command palette", Surface: CommandPalette },
    preferences: { name: "Preferences", Surface: PreferencesDialog },
    "shortcut-sheet": { name: "Keyboard shortcuts", Surface: ShortcutSheet },
};

interface SurfaceBoundaryState {
    failed: boolean;
}

/**
 * Error boundary of the surfaces. A surface that crashes is closed and reported by an error
 * toast (DESIGN §4: a toast reports failures); the shell behind it stays usable, and the
 * surface can be opened again. React reports the caught error to the console.
 */
class SurfaceBoundary extends Component<{ children: ReactNode }, SurfaceBoundaryState> {
    override state: SurfaceBoundaryState = { failed: false };

    static getDerivedStateFromError(): SurfaceBoundaryState {
        return { failed: true };
    }

    override componentDidCatch(): void {
        const { open } = surfaces.store.getState();
        surfaces.close();
        toast.error(`${open ? SURFACES[open].name : "The dialog"} failed to open.`);
        this.setState({ failed: false });
    }

    override render(): ReactNode {
        return this.state.failed ? null : this.props.children;
    }
}

/**
 * Shows the surface a command has opened (app/surfaces/surfaces.ts): the command palette, the
 * Preferences dialog or the shortcut sheet. Mounted at the root of the app, outside every
 * region and inside a boundary of its own, so a failed region does not take the surfaces with
 * it (REVIEW.md, Checkpoint B decisions, B11).
 */
export function AppSurfaces() {
    const open = useOpenSurface();
    // A surface opened from a menu item is opened while that menu still has focus. The
    // listener runs in the same call, before the surface exists, so the surface's opener is
    // the menu's control and not an item that is about to disappear.
    useEffect(
        () =>
            surfaces.store.subscribe((state, previous) => {
                if (state.open && !previous.open) focusMenuOpener();
            }),
        [],
    );
    const Surface = open ? SURFACES[open].Surface : null;
    return <SurfaceBoundary>{Surface ? <Surface /> : null}</SurfaceBoundary>;
}
