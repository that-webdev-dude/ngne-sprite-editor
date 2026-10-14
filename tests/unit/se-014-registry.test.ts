import { readdirSync } from "node:fs";
import { posix } from "node:path";
import { Brush } from "lucide-react";
import { describe, expect, it } from "vitest";
import { createEditorStore } from "../../src/app/state/editor";
import { createStatusStore } from "../../src/app/state/status";
import { createToolState, followToolHint } from "../../src/app/tools/activeTool";
import { optionValue, optionValues } from "../../src/app/tools/options";
import { plannedTools } from "../../src/app/tools/planned.tools";
import {
    createToolRegistry,
    railGroups,
    registerToolModules,
    ToolRegistryError,
} from "../../src/app/tools/registry";
import { toolModulePaths, toolRegistry } from "../../src/app/tools/toolRegistry";
import type { ToolOptionSpec, ToolSpec } from "../../src/app/tools/types";
import { readSpecKeyTable } from "../e2e/se-007-spec-keys";

// SE-014: the tool registry. A tool comes from a module of its own (`*.tools.ts`, found by a
// glob), takes the rail slot planned for its id, and brings its key, options and hint.

const tool = (id: string, extra: Partial<ToolSpec> = {}): ToolSpec => ({ id, label: id, ...extra });

/** The rail of DESIGN §5.1, top to bottom, with the keys of SPEC §7.8. */
const RAIL = [
    ["pencil", "B"],
    ["eraser", "E"],
    ["bucket", "G"],
    ["eyedropper", "I"],
    ["line", "L"],
    ["rectangle", "U"],
    ["ellipse", "Shift+U"],
    ["marquee", "M"],
    ["lasso", "Q"],
    ["wand", "W"],
    ["move", "V"],
    ["hand", "H"],
    ["zoom", "Z"],
];

describe("discovery", () => {
    it("discovers every *.tools.ts module under src", () => {
        const modules = readdirSync(new URL("../../src/", import.meta.url), {
            recursive: true,
            encoding: "utf8",
        })
            .map((path) => path.replaceAll("\\", "/"))
            .filter((path) => /\.tools\.tsx?$/.test(path));
        expect(modules).toEqual(
            expect.arrayContaining([
                "app/tools/planned.tools.ts",
                "app/tools/hand/hand.tools.ts",
                "app/tools/zoom/zoom.tools.ts",
            ]),
        );
        const fromRegistry = (path: string) => {
            const relative = posix.relative("app/tools", path);
            return relative.startsWith(".") ? relative : `./${relative}`;
        };
        expect([...toolModulePaths]).toEqual(modules.map(fromRegistry).sort());
        for (const registered of toolRegistry.list()) {
            expect(toolModulePaths, registered.id).toContain(registered.source);
        }
    });

    it("plans the rail of DESIGN §5.1 with the keys of SPEC §7.8", () => {
        expect(plannedTools.map((plan) => [plan.id, plan.shortcut])).toEqual(RAIL);
        const canvas = readSpecKeyTable()
            .bindings.filter((binding) => binding.context === "canvas")
            .map((binding) => binding.chord);
        for (const plan of plannedTools) expect(canvas, plan.id).toContain(plan.shortcut);
        // Groups: draw, shapes, select, navigate.
        expect(railGroups(toolRegistry.railSlots()).map((group) => group.length)).toEqual([
            4, 3, 4, 2,
        ]);
    });

    it("holds the tools of this ticket, hand and zoom, in their slots; a slot has its tool exactly when one is registered", () => {
        const slots = toolRegistry.railSlots();
        expect(slots.map((slot) => slot.id)).toEqual(RAIL.map(([id]) => id));
        for (const slot of slots) {
            expect(slot.tool, slot.id).toBe(toolRegistry.get(slot.id) ?? null);
        }
        for (const id of ["hand", "zoom"]) {
            const registered = toolRegistry.get(id);
            const plan = plannedTools.find((entry) => entry.id === id);
            expect(registered, id).toBeDefined();
            expect(slots.find((slot) => slot.id === id)?.tool, id).toBe(registered);
            expect(registered?.shortcut, id).toBe(plan?.shortcut);
            expect(registered?.railOrder, id).toBe(plan?.railOrder);
            expect(registered?.icon, id).toBe(plan?.icon);
        }
        expect(toolRegistry.get("hand")?.hold?.key).toBe("Space");
    });
});

describe("registry", () => {
    it("lets a tool take its planned slot, and gives it back when the tool is removed", () => {
        const registry = createToolRegistry();
        registerToolModules(registry, { "./planned.tools.ts": { plannedTools } });
        expect(registry.railSlots().every((slot) => slot.tool === null)).toBe(true);
        let notified = 0;
        registry.subscribe(() => notified++);
        const version = registry.version();

        const remove = registry.register(tool("pencil", { label: "Pencil", paints: true }));
        const pencil = registry.railSlots()[0];
        expect(pencil?.id).toBe("pencil");
        expect(pencil?.tool?.paints).toBe(true);
        expect(pencil?.tool?.shortcut).toBe("B");
        expect(registry.version()).not.toBe(version);
        remove();
        expect(registry.railSlots()[0]?.tool).toBeNull();
        expect(notified).toBe(2);
    });

    it("places a tool by its own position and key, and leaves a tool without one out of the rail", () => {
        const registry = createToolRegistry();
        registerToolModules(registry, {
            "./b.tools.ts": {
                tools: [tool("curve", { shortcut: "Shift+L", railOrder: 230, icon: Brush })],
            },
            "./a.tools.ts": { plannedTools },
            "./c.tools.ts": { tools: [tool("hidden")] },
        });
        const ids = registry.railSlots().map((slot) => slot.id);
        expect(ids.indexOf("curve")).toBe(ids.indexOf("ellipse") + 1);
        expect(ids).not.toContain("hidden");
        expect(registry.get("hidden")?.railOrder).toBeUndefined();
        expect(registry.list().map((entry) => entry.id)).toEqual(["curve", "hidden"]);
    });

    it("groups the rail by the hundreds of the positions", () => {
        const registry = createToolRegistry();
        for (const [id, railOrder] of [
            ["a", 100],
            ["b", 150],
            ["c", 200],
            ["d", 410],
            ["e", 400],
        ] as const) {
            registry.register(tool(id, { railOrder, icon: Brush }));
        }
        expect(
            railGroups(registry.railSlots()).map((group) => group.map((slot) => slot.id)),
        ).toEqual([["a", "b"], ["c"], ["e", "d"]]);
    });

    it("refuses what cannot form one set of tools, naming the module", () => {
        const registry = createToolRegistry();
        registry.register(tool("one"), "first.tools.ts");
        const refused = (spec: ToolSpec) => () => registry.register(spec, "second.tools.ts");
        expect(refused(tool("one"))).toThrow(/first\.tools\.ts and second\.tools\.ts/);
        expect(refused(tool(" "))).toThrow(ToolRegistryError);
        expect(refused(tool("x", { label: "" }))).toThrow(/no label/);
        expect(refused(tool("x", { shortcut: "Ctrl+Nope" }))).toThrow(/invalid key/);
        expect(refused(tool("x", { hold: { key: "Shift+" } }))).toThrow(/invalid key/);
        expect(refused(tool("x", { railOrder: 100 }))).toThrow(/no icon/);
        const options = (...list: ToolOptionSpec[]) => tool("x", { options: list });
        const size: ToolOptionSpec = {
            kind: "number",
            key: "size",
            label: "Size",
            min: 1,
            max: 64,
            default: 0,
        };
        expect(refused(options(size))).toThrow(/default outside 1\.\.64/);
        expect(refused(options({ ...size, default: 1 }, { ...size, default: 2 }))).toThrow(/twice/);
        expect(
            refused(
                options({
                    kind: "choice",
                    key: "ink",
                    label: "Ink",
                    choices: [{ value: "simple", label: "Simple" }],
                    default: "alpha",
                }),
            ),
        ).toThrow(/not one of its choices/);
        expect(
            refused(options({ kind: "slider", key: "k", label: "K" } as unknown as ToolOptionSpec)),
        ).toThrow(/unknown kind/);
        expect(() => registerToolModules(createToolRegistry(), { "./x.tools.ts": {} })).toThrow(
            /exports neither/,
        );
        expect(() =>
            registerToolModules(createToolRegistry(), {
                "./a.tools.ts": { plannedTools },
                "./b.tools.ts": { plannedTools },
            }),
        ).toThrow(/Planned tool id "pencil"/);
    });
});

describe("option values", () => {
    const size: ToolOptionSpec = {
        kind: "number",
        key: "size",
        label: "Size",
        min: 1,
        max: 64,
        default: 1,
    };
    const perfect: ToolOptionSpec = { kind: "toggle", key: "perfect", label: "P", default: true };
    const ink: ToolOptionSpec = {
        kind: "choice",
        key: "ink",
        label: "Ink",
        choices: [
            { value: "simple", label: "Simple" },
            { value: "alpha", label: "Alpha" },
        ],
        default: "simple",
    };

    it("reads the defaults, and what was set over them", () => {
        expect(optionValues([size, perfect, ink], undefined)).toEqual({
            size: 1,
            perfect: true,
            ink: "simple",
        });
        expect(optionValues([size, perfect, ink], { size: 8, ink: "alpha" })).toEqual({
            size: 8,
            perfect: true,
            ink: "alpha",
        });
    });

    it("reads a stored value the option cannot take as the nearest one, or the default", () => {
        expect(optionValue(size, 99)).toBe(64);
        expect(optionValue(size, -3)).toBe(1);
        expect(optionValue(size, Number.NaN)).toBe(1);
        expect(optionValue(size, "8")).toBe(1);
        expect(optionValue(perfect, "yes")).toBe(true);
        expect(optionValue(perfect, false)).toBe(false);
        expect(optionValue(ink, "lock")).toBe("simple");
    });
});

describe("the active tool", () => {
    function state() {
        const editor = createEditorStore();
        const registry = createToolRegistry();
        registry.register(tool("pencil", { hint: "Shift: line" }));
        registry.register(tool("hand"));
        registry.register(tool("zoom", { hint: "Alt: zoom out" }));
        return { editor, registry, tools: createToolState(editor, registry) };
    }

    it("is the selected tool; an unknown id is not selected", () => {
        const { editor, tools } = state();
        expect(tools.activeId()).toBe("pencil");
        expect(tools.select("zoom")).toBe(true);
        expect(editor.getState().tool).toBe("zoom");
        expect(tools.select("nothing")).toBe(false);
        expect(tools.active()?.id).toBe("zoom");
    });

    it("is a held tool while its key is down, and the selected one again after", () => {
        const { editor, tools } = state();
        const seen: string[] = [];
        tools.subscribe(() => seen.push(tools.activeId()));
        tools.hold("hand");
        expect(tools.activeId()).toBe("hand");
        // The selection itself never changes.
        expect(editor.getState().tool).toBe("pencil");
        tools.hold("zoom");
        tools.release("hand");
        expect(tools.activeId()).toBe("zoom");
        tools.release("zoom");
        expect(tools.activeId()).toBe("pencil");
        expect(seen).toEqual(["hand", "zoom", "zoom", "pencil"]);
        // A tool selected while one is held acts once it is released.
        tools.hold("hand");
        tools.select("zoom");
        expect(tools.activeId()).toBe("hand");
        tools.release("hand");
        expect(tools.activeId()).toBe("zoom");
    });

    it("keeps option values stable until they change", () => {
        const { tools } = state();
        const registered = tools.registry.get("pencil")!;
        const first = tools.options(registered);
        expect(tools.options(registered)).toBe(first);
        tools.setOption(registered, "size", 2);
        expect(tools.options(registered)).not.toBe(first);
    });

    it("puts the active tool's hint in the status bar", () => {
        const { tools } = state();
        const status = createStatusStore();
        const stop = followToolHint(tools, status);
        expect(status.getState().hint).toBe("Shift: line");
        tools.hold("hand");
        expect(status.getState().hint).toBeNull();
        tools.release("hand");
        tools.select("zoom");
        expect(status.getState().hint).toBe("Alt: zoom out");
        stop();
        tools.select("pencil");
        expect(status.getState().hint).toBe("Alt: zoom out");
    });

    it("tells its listeners of tool changes but not of colour changes", () => {
        const { editor, tools } = state();
        let calls = 0;
        tools.subscribe(() => calls++);
        editor.getState().setForeground(0x123456ff);
        expect(calls).toBe(0);
        editor.getState().setTool("hand");
        expect(calls).toBe(1);
    });
});
