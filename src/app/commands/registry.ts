import { isBrowserChord, isTextEditingChord } from "../keymap/keyClasses";
import { normalizeChord } from "./chord";
import { DEFAULT_MENU_ORDER, KEY_CONTEXTS, MENU_BAR } from "./types";
import type {
    Command,
    CommandModule,
    CommandSpec,
    ContextMenuPlacement,
    KeyContext,
    PlannedCommandSpec,
} from "./types";

/** Thrown when a command cannot be registered; the message names the command and its module. */
export class CommandRegistryError extends Error {
    override readonly name = "CommandRegistryError";
}

/**
 * The commands of the editor (SPEC §5, §7.8). Menus, context menus, shortcuts, the command
 * palette and the shortcut sheet read this registry; nothing else lists commands.
 */
export interface CommandRegistry {
    /** Adds a command; returns the function that removes it. Throws `CommandRegistryError`. */
    register(spec: CommandSpec, source?: string): () => void;
    /** Adds the menu item of a command a later ticket implements; returns its remover. */
    plan(spec: PlannedCommandSpec, source?: string): () => void;
    /** The command with this id: registered, or planned and not yet implemented. */
    get(id: string): Command | undefined;
    /** Every command, ordered by id. Planned commands that were replaced are left out. */
    list(): readonly Command[];
    /** The commands that bind `chord` (canonical) in `context`, enabled or not, by id. */
    bindings(context: KeyContext, chord: string): readonly Command[];
    /** Whether any command binds `chord` (canonical) in any context. */
    isBound(chord: string): boolean;
    /** Calls `listener` when a command is added or removed and on `refresh`. */
    subscribe(listener: () => void): () => void;
    /** Changes whenever `subscribe` listeners are called; a snapshot for React. */
    version(): number;
    /** Tells subscribers that state read by `enabled` or `title` functions has changed. */
    refresh(): void;
}

interface Entry {
    spec: CommandSpec;
    command: Command;
}

function asList<Item>(value: Item | readonly Item[] | undefined): readonly Item[] {
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : [value]) as readonly Item[];
}

function checkMenuPath(path: readonly string[], id: string, source: string): void {
    const names: readonly string[] = MENU_BAR;
    if (path.length === 0 || path.some((name) => name.trim() === "")) {
        throw new CommandRegistryError(`Command "${id}" (${source}) has an empty menu path.`);
    }
    if (!names.includes(path[0] ?? "")) {
        throw new CommandRegistryError(
            `Command "${id}" (${source}) names the menu "${path[0]}"; the menu bar has ` +
                `${MENU_BAR.join(", ")}.`,
        );
    }
}

function resolveSpec(spec: CommandSpec, source: string, planned?: PlannedCommandSpec): Command {
    const { id } = spec;
    const fail = (problem: string): never => {
        throw new CommandRegistryError(`Command "${id}" (${source}) ${problem}`);
    };
    if (id.trim() === "") throw new CommandRegistryError(`A command of ${source} has no id.`);

    let shortcuts: string[];
    try {
        shortcuts = asList(spec.shortcut).map(normalizeChord);
    } catch (error) {
        return fail(`has an invalid shortcut: ${error instanceof Error ? error.message : error}`);
    }
    if (new Set(shortcuts).size !== shortcuts.length) fail("lists a shortcut twice.");

    const contexts: KeyContext[] =
        spec.context === undefined ? ["global"] : [...asList(spec.context)];
    for (const context of contexts) {
        if (!KEY_CONTEXTS.includes(context)) fail(`names the unknown context "${context}".`);
    }
    if (contexts.length === 0 || new Set(contexts).size !== contexts.length) {
        fail("needs each of its contexts once.");
    }
    // SPEC §7.8: in a text field only Ctrl/Alt/F-key chords act, and the field keeps its own.
    if (contexts.includes("text")) {
        for (const chord of shortcuts) {
            if (!isBrowserChord(chord) || isTextEditingChord(chord)) {
                fail(`binds "${chord}" in the text context, where the field handles that key.`);
            }
        }
    }

    // A command takes the menu position planned for its id unless it names another menu.
    const menuPath = spec.menuPath ?? planned?.menuPath ?? null;
    if (menuPath) checkMenuPath(menuPath, id, source);
    const atPlannedPath =
        planned !== undefined && menuPath?.join("\n") === planned.menuPath.join("\n");
    const plannedOrder = atPlannedPath ? planned.menuOrder : undefined;

    const contextMenus = (spec.contextMenus ?? []).map(
        (placement): Required<ContextMenuPlacement> => {
            if (placement.menu.trim() === "") fail("names an empty context menu.");
            return { menu: placement.menu, order: placement.order ?? DEFAULT_MENU_ORDER };
        },
    );

    const { title, enabled } = spec;
    return {
        id,
        source,
        planned: false,
        title: typeof title === "function" ? title : () => title,
        enabled: enabled ? () => enabled() : () => true,
        run: () => spec.run(),
        release: spec.release ? () => spec.release?.() : null,
        shortcuts,
        contexts,
        menuPath,
        menuOrder: spec.menuOrder ?? plannedOrder ?? DEFAULT_MENU_ORDER,
        contextMenus,
    };
}

function resolvePlanned(spec: PlannedCommandSpec, source: string): Command {
    if (spec.id.trim() === "") throw new CommandRegistryError(`A command of ${source} has no id.`);
    checkMenuPath(spec.menuPath, spec.id, source);
    return {
        id: spec.id,
        source,
        planned: true,
        title: () => spec.title,
        enabled: () => false,
        run: () => {},
        release: null,
        shortcuts: [],
        contexts: [],
        menuPath: spec.menuPath,
        menuOrder: spec.menuOrder ?? DEFAULT_MENU_ORDER,
        contextMenus: [],
    };
}

export function createCommandRegistry(): CommandRegistry {
    const registered = new Map<string, Entry>();
    const planned = new Map<string, { spec: PlannedCommandSpec; command: Command }>();
    const listeners = new Set<() => void>();
    let version = 0;
    let listed: readonly Command[] | null = null;

    const changed = () => {
        version++;
        listed = null;
        for (const listener of [...listeners]) listener();
    };

    /** A registered command takes the menu position planned for its id, when there is one. */
    const resolveAgain = (id: string) => {
        const entry = registered.get(id);
        if (!entry) return;
        entry.command = resolveSpec(entry.spec, entry.command.source, planned.get(id)?.spec);
    };

    const all = (): readonly Command[] => {
        if (listed) return listed;
        const replaced = new Set<string>();
        for (const { spec } of registered.values()) {
            for (const id of spec.replaces ?? []) replaced.add(id);
        }
        const commands = [...registered.values()].map((entry) => entry.command);
        for (const [id, { command }] of planned) {
            if (!registered.has(id) && !replaced.has(id)) commands.push(command);
        }
        listed = commands.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        return listed;
    };

    return {
        register(spec, source = "runtime") {
            const existing = registered.get(spec.id);
            if (existing) {
                throw new CommandRegistryError(
                    `Command id "${spec.id}" is used by ${existing.command.source} and ${source}.`,
                );
            }
            const entry: Entry = {
                spec,
                command: resolveSpec(spec, source, planned.get(spec.id)?.spec),
            };
            registered.set(spec.id, entry);
            changed();
            return () => {
                if (registered.get(spec.id) !== entry) return;
                registered.delete(spec.id);
                changed();
            };
        },

        plan(spec, source = "runtime") {
            const existing = planned.get(spec.id);
            if (existing) {
                throw new CommandRegistryError(
                    `Planned command id "${spec.id}" is used by ${existing.command.source} ` +
                        `and ${source}.`,
                );
            }
            const entry = { spec, command: resolvePlanned(spec, source) };
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

        get: (id) => all().find((command) => command.id === id),
        list: all,

        bindings: (context, chord) =>
            all().filter(
                (command) =>
                    command.contexts.includes(context) && command.shortcuts.includes(chord),
            ),
        isBound: (chord) => all().some((command) => command.shortcuts.includes(chord)),

        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        version: () => version,
        refresh: changed,
    };
}

/**
 * Registers what the discovered `*.commands.ts` modules export. Plans go first, so a command
 * finds the menu position planned for it whatever the module order.
 */
export function registerCommandModules(
    registry: CommandRegistry,
    modules: Record<string, CommandModule>,
): void {
    const entries = Object.entries(modules).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [path, module] of entries) {
        if (!module.commands && !module.plannedCommands) {
            throw new CommandRegistryError(
                `${path} exports neither "commands" nor "plannedCommands".`,
            );
        }
        for (const spec of module.plannedCommands ?? []) registry.plan(spec, path);
    }
    for (const [path, module] of entries) {
        for (const spec of module.commands ?? []) registry.register(spec, path);
    }
}

/** A chord that more than one enabled command binds in one context. */
export interface ChordConflict {
    context: KeyContext;
    chord: string;
    /** Ids of the enabled commands that share the chord. */
    commands: string[];
}

/**
 * Every chord that two or more commands enabled right now bind in the same context. Commands
 * may share a chord in a context only when their `enabled` conditions exclude each other
 * (arrows nudge with a selection and change the frame without one).
 */
export function findChordConflicts(registry: CommandRegistry): ChordConflict[] {
    const enabled = registry.list().filter((command) => command.enabled());
    const conflicts: ChordConflict[] = [];
    for (const context of KEY_CONTEXTS) {
        const byChord = new Map<string, string[]>();
        for (const command of enabled) {
            if (!command.contexts.includes(context)) continue;
            for (const chord of command.shortcuts) {
                byChord.set(chord, [...(byChord.get(chord) ?? []), command.id]);
            }
        }
        for (const [chord, commands] of byChord) {
            if (commands.length > 1) conflicts.push({ context, chord, commands });
        }
    }
    return conflicts;
}
