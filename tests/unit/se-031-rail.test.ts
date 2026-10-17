import { Brush } from "lucide-react";
import { describe, expect, it } from "vitest";
import { createEditorStore } from "../../src/app/state/editor";
import { createToolState } from "../../src/app/tools/activeTool";
import { plannedTools } from "../../src/app/tools/planned.tools";
import {
    createToolRegistry,
    railGroups,
    registerToolModules,
    slotOf,
} from "../../src/app/tools/registry";
import { toolRegistry } from "../../src/app/tools/toolRegistry";
import type { ToolSpec } from "../../src/app/tools/types";
import { readSpecKeyTable } from "../e2e/se-007-spec-keys";

// SE-031: rail variants (DESIGN §5.1). A tool names the slot it shares (`variantOf`); the slot
// lists its tools, its own first; its button shows the variant selected last; a tool's key
// pressed again while that tool is selected selects the next variant of its slot. The app's
// marquee and lasso slots hold the elliptical marquee and the polygon lasso.

const tool = (id: string, extra: Partial<ToolSpec> = {}): ToolSpec => ({ id, label: id, ...extra });

/** A registry with the planned rail, the tools given, and a tool state on it. */
function rail(...tools: ToolSpec[]) {
    const registry = createToolRegistry();
    registerToolModules(registry, { "./planned.tools.ts": { plannedTools } });
    for (const spec of tools) registry.register(spec);
    const editor = createEditorStore();
    return { registry, editor, state: createToolState(editor, registry) };
}

const slotIn = (registry: ReturnType<typeof createToolRegistry>, id: string) => {
    const found = registry.railSlots().find((slot) => slot.id === id);
    if (!found) throw new Error(`no slot ${id}`);
    return found;
};

describe("slots with variants", () => {
    it("lists a slot's own tool first, then its variants by position and id; variants take no slot", () => {
        const { registry } = rail(
            tool("marquee"),
            tool("c", { variantOf: "marquee" }),
            tool("b", { variantOf: "marquee", railOrder: 302 }),
            tool("a", { variantOf: "marquee", railOrder: 302 }),
        );
        const marquee = slotIn(registry, "marquee");
        expect(marquee.tool?.id).toBe("marquee");
        expect(marquee.variants.map((variant) => variant.id)).toEqual(["marquee", "a", "b", "c"]);
        const ids = registry.railSlots().map((slot) => slot.id);
        expect(ids).toEqual(plannedTools.map((plan) => plan.id));
        expect(railGroups(registry.railSlots()).map((group) => group.length)).toEqual(
            railGroups(rail().registry.railSlots()).map((group) => group.length),
        );
        expect(slotOf(registry.get("a")!)).toBe("marquee");
        expect(slotOf(registry.get("marquee")!)).toBe("marquee");
    });

    it("gives a planned slot its first variant when the slot's own tool is not registered", () => {
        const { registry } = rail(tool("polygon", { variantOf: "lasso", icon: Brush }));
        const lasso = slotIn(registry, "lasso");
        expect(lasso.tool?.id).toBe("polygon");
        expect(lasso.variants.map((variant) => variant.id)).toEqual(["polygon"]);
        // A slot alone: the tool of its id, or none.
        const move = slotIn(registry, "move");
        expect(move.tool).toBeNull();
        expect(move.variants).toEqual([]);
    });

    it("leaves out a variant of a slot that does not exist, and lets a variant go without an icon", () => {
        const { registry } = rail(
            tool("orphan", { variantOf: "nowhere", railOrder: 999 }),
            tool("lasso"),
            tool("bare", { variantOf: "lasso", railOrder: 311 }),
        );
        expect(
            registry.railSlots().flatMap((slot) => slot.variants.map((v) => v.id)),
        ).not.toContain("orphan");
        expect(slotIn(registry, "lasso").variants.map((variant) => variant.id)).toEqual([
            "lasso",
            "bare",
        ]);
        expect(() => registry.register(tool("x", { variantOf: " " }))).toThrow(
            /slot without an id/,
        );
    });
});

describe("the variant a slot shows and the keys", () => {
    function marquees() {
        return rail(
            tool("pencil"),
            tool("marquee"),
            tool("ellipse", { variantOf: "marquee", railOrder: 301 }),
            tool("third", { variantOf: "marquee", railOrder: 302 }),
            tool("hand"),
        );
    }

    it("shows the slot's own tool, then the variant selected last, and a held variant while it is held", () => {
        const { registry, state } = marquees();
        const slot = () => slotIn(registry, "marquee");
        expect(state.shownInSlot(slot())?.id).toBe("marquee");
        state.select("ellipse");
        expect(state.shownInSlot(slot())?.id).toBe("ellipse");
        state.select("pencil");
        expect(state.shownInSlot(slot())?.id).toBe("ellipse");
        state.hold("third");
        expect(state.shownInSlot(slot())?.id).toBe("third");
        state.release("third");
        expect(state.shownInSlot(slot())?.id).toBe("ellipse");
        expect(state.shownInSlot(slotIn(registry, "move"))).toBeNull();
    });

    it("switches a key pressed again among the slot's variants of the same letter only, in order", () => {
        // One slot mixing letters, as later variants may: M, Shift+M, Alt+M (if one were
        // bound) on one letter, B and Shift+B on another.
        const { state } = rail(
            tool("marquee", { shortcut: "M" }),
            tool("ellipse", { variantOf: "marquee", railOrder: 301, shortcut: "Shift+M" }),
            tool("brushy", { variantOf: "marquee", railOrder: 302, shortcut: "B" }),
            tool("third", { variantOf: "marquee", railOrder: 303, shortcut: "Ctrl+Shift+M" }),
            tool("brushier", { variantOf: "marquee", railOrder: 304, shortcut: "Shift+B" }),
            tool("keyless", { variantOf: "marquee", railOrder: 305 }),
            tool("hand"),
        );
        const next = (id: string) => state.nextVariant(id)?.id ?? null;
        // M's letter: marquee → ellipse → third → marquee.
        expect(next("marquee")).toBe("ellipse");
        expect(next("ellipse")).toBe("third");
        expect(next("third")).toBe("marquee");
        // B's letter on its own: brushy ↔ brushier, never across to M.
        expect(next("brushy")).toBe("brushier");
        expect(next("brushier")).toBe("brushy");
        // No key, a slot of one tool, an unknown id: nothing to switch to.
        expect(next("keyless")).toBeNull();
        expect(next("hand")).toBeNull();
        expect(next("unknown")).toBeNull();
        // It depends on the tool alone, not on what is selected.
        state.select("hand");
        expect(next("marquee")).toBe("ellipse");
    });

    it("has no next variant for a letter alone in its slot", () => {
        const { state } = rail(
            tool("line", { shortcut: "L" }),
            tool("curve", { variantOf: "line", railOrder: 201, shortcut: "Shift+C" }),
        );
        expect(state.nextVariant("line")).toBeNull();
        expect(state.nextVariant("curve")).toBeNull();
    });
});

describe("the app's rail", () => {
    const canvasKeys = readSpecKeyTable()
        .bindings.filter((binding) => binding.context === "canvas")
        .map((binding) => binding.chord);

    for (const [slot, own, variant] of [
        ["marquee", "M", "Shift+M"],
        ["lasso", "Q", "Shift+Q"],
    ] as const) {
        it(`holds the ${slot} slot's own tool (${own}) and a variant (${variant}), with the keys of SPEC §7.8`, () => {
            const found = slotIn(toolRegistry, slot);
            expect(found.tool?.id).toBe(slot);
            expect(found.variants[0]).toBe(found.tool);
            expect(found.variants.length).toBeGreaterThan(1);
            expect(found.tool?.shortcut).toBe(own);
            const keys = found.variants.map((entry) => entry.shortcut);
            expect(keys).toContain(variant);
            for (const key of keys) expect(canvasKeys).toContain(key);
            for (const entry of found.variants.slice(1)) expect(entry.variantOf).toBe(slot);
        });
    }

    it("puts the wand in its planned slot with its key", () => {
        const wand = slotIn(toolRegistry, "wand");
        expect(wand.tool?.id).toBe("wand");
        expect(wand.tool?.shortcut).toBe("W");
        expect(canvasKeys).toContain("W");
    });
});
