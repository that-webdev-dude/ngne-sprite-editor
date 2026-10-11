import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectDockPanels, dockPanels } from "../../src/ui/dock/registry";
import type { DockPanel } from "../../src/ui/dock/registry";

// AGENTS.md, Parallel work: a dock panel registers from its own module and the registry
// discovers it; no shared file is edited.

const Body = () => null;
const panel = (id: string, order: number): DockPanel => ({ id, title: id, order, Body });

describe("dock panel registry", () => {
    it("discovers every *.dock.tsx module under src/ui", () => {
        const modules = readdirSync(new URL("../../src/ui/", import.meta.url), {
            recursive: true,
            encoding: "utf8",
        }).filter((path) => path.endsWith(".dock.tsx"));
        expect(modules.length).toBeGreaterThanOrEqual(3);
        expect(dockPanels).toHaveLength(modules.length);
    });

    it("holds the three sections of DESIGN §2 in dock order", () => {
        expect(dockPanels.map((entry) => [entry.id, entry.title])).toEqual([
            ["colour", "Colour"],
            ["palette", "Palette"],
            ["preview", "Preview · NGNE"],
        ]);
        for (const entry of dockPanels) expect(typeof entry.Body).toBe("function");
    });

    it("collapses the palette by default below 800 px of window height", () => {
        const byId = new Map(dockPanels.map((entry) => [entry.id, entry]));
        expect(byId.get("palette")?.collapseBelowHeight).toBe(800);
        expect(byId.get("colour")?.collapseBelowHeight).toBeUndefined();
        expect(byId.get("preview")?.collapseBelowHeight).toBeUndefined();
    });

    it("orders panels by `order`, whatever the module order", () => {
        const panels = collectDockPanels({
            "./z.dock.tsx": { dockPanel: panel("last", 30) },
            "./a.dock.tsx": { dockPanel: panel("middle", 20) },
            "./m.dock.tsx": { dockPanel: panel("first", 10) },
            "./b.dock.tsx": { dockPanel: panel("also-middle", 20) },
        });
        expect(panels.map((entry) => entry.id)).toEqual(["first", "also-middle", "middle", "last"]);
    });

    it("rejects two panels with one id, naming both modules", () => {
        expect(() =>
            collectDockPanels({
                "./a.dock.tsx": { dockPanel: panel("colour", 10) },
                "./b.dock.tsx": { dockPanel: panel("colour", 20) },
            }),
        ).toThrow(/"colour".*\.\/a\.dock\.tsx.*\.\/b\.dock\.tsx/);
    });

    it("rejects a module that does not export dockPanel", () => {
        expect(() => collectDockPanels({ "./a.dock.tsx": {} })).toThrow(
            './a.dock.tsx does not export "dockPanel".',
        );
    });
});
