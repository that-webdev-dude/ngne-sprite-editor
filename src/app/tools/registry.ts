import { normalizeChord } from "../commands/chord";
import type {
    PlannedToolSpec,
    RailSlot,
    Tool,
    ToolModule,
    ToolOptionSpec,
    ToolSpec,
} from "./types";

/** Thrown when a tool cannot be registered; the message names the tool and its module. */
export class ToolRegistryError extends Error {
    override readonly name = "ToolRegistryError";
}

/**
 * The tools of the editor (SPEC §7.1, SE-014): the rail, the context bar, the tool shortcuts
 * and the pointer pipeline read this registry.
 */
export interface ToolRegistry {
    /** Adds a tool; returns the function that removes it. Throws `ToolRegistryError`. */
    register(spec: ToolSpec, source?: string): () => void;
    /** Adds the rail slot of a tool a later ticket implements; returns its remover. */
    plan(spec: PlannedToolSpec, source?: string): () => void;
    /** The registered tool with this id. */
    get(id: string): Tool | undefined;
    /** Every registered tool, by id. */
    list(): readonly Tool[];
    /**
     * The buttons of the rail in order: registered tools and planned slots, each with its
     * variants (SE-031). A variant of a slot that does not exist is not in the rail.
     */
    railSlots(): readonly RailSlot[];
    /** Calls `listener` when a tool or a slot is added or removed. */
    subscribe(listener: () => void): () => void;
    /** Changes whenever `subscribe` listeners are called; a snapshot for React. */
    version(): number;
}

function checkOption(option: ToolOptionSpec, fail: (problem: string) => never): void {
    const { key } = option;
    if (key.trim() === "") fail("has an option without a key.");
    switch (option.kind) {
        case "number":
            if (!(option.min <= option.default && option.default <= option.max)) {
                fail(`has option "${key}" with a default outside ${option.min}..${option.max}.`);
            }
            break;
        case "toggle":
            // Checked although typed: a module may be plain JavaScript data.
            if ((option.default as unknown) !== true && (option.default as unknown) !== false) {
                fail(`has toggle "${key}" without a true or false default.`);
            }
            break;
        case "choice":
            if (!option.choices.some((choice) => choice.value === option.default)) {
                fail(`has choice "${key}" whose default is not one of its choices.`);
            }
            break;
        default:
            fail(`has option "${key}" of an unknown kind.`);
    }
}

function resolveTool(spec: ToolSpec, source: string, planned?: PlannedToolSpec): Tool {
    const fail = (problem: string): never => {
        throw new ToolRegistryError(`Tool "${spec.id}" (${source}) ${problem}`);
    };
    if (spec.id.trim() === "") throw new ToolRegistryError(`A tool of ${source} has no id.`);
    if (spec.label.trim() === "") fail("has no label.");
    const options = [...(spec.options ?? [])];
    const keys = new Set<string>();
    for (const option of options) {
        checkOption(option, fail);
        if (keys.has(option.key)) fail(`lists option "${option.key}" twice.`);
        keys.add(option.key);
    }
    for (const chord of [spec.shortcut, spec.hold?.key]) {
        if (chord === undefined) continue;
        try {
            normalizeChord(chord);
        } catch (error) {
            fail(`has an invalid key: ${error instanceof Error ? error.message : error}`);
        }
    }
    if (spec.railOrder !== undefined && !Number.isFinite(spec.railOrder)) {
        fail("has a rail position that is not a number.");
    }
    if (spec.variantOf !== undefined && spec.variantOf.trim() === "") {
        fail("is a variant of a slot without an id.");
    }
    // A variant shows its slot's icon when it has none of its own.
    const variant = spec.variantOf !== undefined && spec.variantOf !== spec.id;
    const tool: Tool = {
        ...spec,
        source,
        icon: spec.icon ?? planned?.icon,
        shortcut: spec.shortcut ?? planned?.shortcut,
        railOrder: spec.railOrder ?? planned?.railOrder,
        options,
    };
    if (tool.railOrder !== undefined && !tool.icon && !variant) {
        fail("is in the rail but has no icon.");
    }
    return tool;
}

function byId<Item extends { id: string }>(a: Item, b: Item): number {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The id of the rail slot a tool belongs to: the slot it is a variant of (`variantOf`), or
 * its own id (SE-031).
 */
export function slotOf(tool: Pick<Tool, "id" | "variantOf">): string {
    return tool.variantOf ?? tool.id;
}

/** Variants by their rail position (none last), then by id. */
function byVariantOrder(a: Tool, b: Tool): number {
    return (a.railOrder ?? Infinity) - (b.railOrder ?? Infinity) || byId(a, b);
}

export function createToolRegistry(): ToolRegistry {
    const specs = new Map<string, { spec: ToolSpec; tool: Tool }>();
    const planned = new Map<string, { spec: PlannedToolSpec; source: string }>();
    const listeners = new Set<() => void>();
    let version = 0;
    let slots: readonly RailSlot[] | null = null;
    let tools: readonly Tool[] | null = null;

    const changed = () => {
        version++;
        slots = null;
        tools = null;
        for (const listener of [...listeners]) listener();
    };

    /** A registered tool takes what the slot planned for its id supplies. */
    const resolveAgain = (id: string) => {
        const entry = specs.get(id);
        if (entry) entry.tool = resolveTool(entry.spec, entry.tool.source, planned.get(id)?.spec);
    };

    return {
        register(spec, source = "runtime") {
            const existing = specs.get(spec.id);
            if (existing) {
                throw new ToolRegistryError(
                    `Tool id "${spec.id}" is used by ${existing.tool.source} and ${source}.`,
                );
            }
            const entry = { spec, tool: resolveTool(spec, source, planned.get(spec.id)?.spec) };
            specs.set(spec.id, entry);
            changed();
            return () => {
                if (specs.get(spec.id) !== entry) return;
                specs.delete(spec.id);
                changed();
            };
        },

        plan(spec, source = "runtime") {
            const existing = planned.get(spec.id);
            if (existing) {
                throw new ToolRegistryError(
                    `Planned tool id "${spec.id}" is used by ${existing.source} and ${source}.`,
                );
            }
            if (!Number.isFinite(spec.railOrder)) {
                throw new ToolRegistryError(
                    `Planned tool "${spec.id}" (${source}) has no rail position.`,
                );
            }
            const entry = { spec, source };
            planned.set(spec.id, entry);
            resolveAgain(spec.id);
            changed();
            return () => {
                if (planned.get(spec.id) !== entry) return;
                planned.delete(spec.id);
                resolveAgain(spec.id);
                changed();
            };
        },

        get: (id) => specs.get(id)?.tool,

        list() {
            tools ??= [...specs.values()].map((entry) => entry.tool).sort(byId);
            return tools;
        },

        railSlots() {
            if (slots) return slots;
            // The variants of each slot (SE-031): the tools that name it, in their order.
            const variants = new Map<string, Tool[]>();
            for (const { tool } of specs.values()) {
                const slot = slotOf(tool);
                if (slot === tool.id) continue;
                variants.set(slot, [...(variants.get(slot) ?? []), tool]);
            }
            for (const list of variants.values()) list.sort(byVariantOrder);
            const all: RailSlot[] = [];
            const placed = new Set<string>();
            for (const { tool } of specs.values()) {
                if (slotOf(tool) !== tool.id || tool.railOrder === undefined) continue;
                placed.add(tool.id);
                all.push({
                    id: tool.id,
                    label: tool.label,
                    shortcut: tool.shortcut,
                    icon: tool.icon,
                    railOrder: tool.railOrder,
                    tool,
                    variants: [tool, ...(variants.get(tool.id) ?? [])],
                });
            }
            for (const [id, { spec }] of planned) {
                if (placed.has(id)) continue;
                const list = variants.get(id) ?? [];
                all.push({
                    id,
                    label: spec.label,
                    shortcut: spec.shortcut,
                    icon: spec.icon,
                    railOrder: spec.railOrder,
                    tool: list[0] ?? null,
                    variants: list,
                });
            }
            // Equal positions by id, so the rail does not depend on module order.
            slots = all.sort((a, b) => a.railOrder - b.railOrder || byId(a, b));
            return slots;
        },

        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        version: () => version,
    };
}

/**
 * Registers what the discovered `*.tools.ts` modules export. Plans go first, so a tool finds
 * the slot planned for it whatever the module order.
 */
export function registerToolModules(
    registry: ToolRegistry,
    modules: Record<string, ToolModule>,
): void {
    const entries = Object.entries(modules).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [path, module] of entries) {
        if (!Array.isArray(module.tools) && !Array.isArray(module.plannedTools)) {
            throw new ToolRegistryError(`${path} exports neither "tools" nor "plannedTools".`);
        }
        for (const spec of module.plannedTools ?? []) registry.plan(spec, path);
    }
    for (const [path, module] of entries) {
        for (const spec of module.tools ?? []) registry.register(spec, path);
    }
}

/** The rail's slots in groups: positions that differ in the hundreds are in different groups. */
export function railGroups(slots: readonly RailSlot[]): RailSlot[][] {
    const groups: RailSlot[][] = [];
    let group = Number.NaN;
    for (const slot of slots) {
        const hundreds = Math.floor(slot.railOrder / 100);
        if (hundreds !== group || groups.length === 0) {
            groups.push([]);
            group = hundreds;
        }
        groups[groups.length - 1]?.push(slot);
    }
    return groups;
}
