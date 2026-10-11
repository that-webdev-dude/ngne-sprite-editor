import type { ComponentType } from "react";
// Declares `import.meta.glob` wherever this module is compiled.
import type {} from "../../import-meta";

/**
 * Dock panel registry. A feature adds a section to the right dock by creating a module named
 * `*.dock.tsx` anywhere under `src/ui` that exports `dockPanel`; this file finds it with a
 * glob import, so no shared file is edited (AGENTS.md, Parallel work).
 *
 *     // src/ui/panels/colour.dock.tsx
 *     export const dockPanel: DockPanel = { id: "colour", title: "Colour", order: 10, Body };
 */
export interface DockPanel {
    /** Stable, unique id; also the `data-dock-panel` attribute of the section. */
    id: string;
    /** Section header text. */
    title: string;
    /** Position in the dock, ascending. Built-in panels use 10, 20, 30. */
    order: number;
    /** Panel content, mounted only while the section is expanded. */
    Body: ComponentType;
    /** Right side of the header (a menu, the current item). */
    HeaderExtra?: ComponentType;
    /** Collapsed by default while the window is lower than this many CSS pixels. */
    collapseBelowHeight?: number;
}

/** What a `*.dock.tsx` module exports. */
export interface DockPanelModule {
    dockPanel?: DockPanel;
}

/** Validates the discovered modules and returns their panels in dock order. */
export function collectDockPanels(modules: Record<string, DockPanelModule>): DockPanel[] {
    const seen = new Map<string, string>();
    const panels: DockPanel[] = [];
    for (const [path, module] of Object.entries(modules)) {
        const panel = module.dockPanel;
        if (!panel) throw new Error(`${path} does not export "dockPanel".`);
        const first = seen.get(panel.id);
        if (first) throw new Error(`Dock panel id "${panel.id}" is used by ${first} and ${path}.`);
        seen.set(panel.id, path);
        panels.push(panel);
    }
    return panels.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Every dock panel of the app, in dock order. */
export const dockPanels: readonly DockPanel[] = collectDockPanels(
    import.meta.glob<DockPanelModule>("../**/*.dock.tsx", { eager: true }),
);
