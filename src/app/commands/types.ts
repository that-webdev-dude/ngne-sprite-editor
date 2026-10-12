/**
 * Keymap contexts of SPEC §7.8, highest priority first. A key is resolved in the first context
 * that both applies and binds it.
 */
export const KEY_CONTEXTS = [
    "text",
    "gesture",
    "floating",
    "timeline",
    "canvas",
    "global",
] as const;
export type KeyContext = (typeof KEY_CONTEXTS)[number];

/** The menus of the menu bar, in order (DESIGN §2). */
export const MENU_BAR = ["File", "Edit", "Sprite", "Layer", "Frame", "Select", "View"] as const;
export type MenuBarMenu = (typeof MENU_BAR)[number];

/** Where a command appears in a context menu (right-click on a layer, frame, cel or tag). */
export interface ContextMenuPlacement {
    /** Name of the context menu, chosen by the feature that shows it: "layer", "cel", … */
    menu: string;
    /** Position in that menu; see `CommandSpec.menuOrder`. The default is 1000. */
    order?: number;
}

/**
 * One command of the editor. Menus, context menus, shortcuts, the command palette and the
 * shortcut sheet are generated from the registry; the interface runs a command, it never
 * changes a document itself (SPEC §5).
 *
 * A feature registers its commands from a module named `*.commands.ts` (or `.tsx`) anywhere
 * under `src`, which exports `commands`:
 *
 *     // src/app/layers/layers.commands.ts
 *     export const commands: CommandSpec[] = [
 *         { id: "layer.new", title: "New Layer", shortcut: "Shift+N", run: newLayer },
 *     ];
 *
 * `appCommands.ts` finds the module with a glob import, so no shared file is edited
 * (AGENTS.md, Parallel work).
 */
export interface CommandSpec {
    /** Stable and unique: "edit.undo". The id of a planned command implements it. */
    id: string;
    /** Menu text; a function when the text follows the state ("Undo Pencil"). */
    title: string | (() => string);
    /** Performs the command. Called only while `enabled` holds. */
    run(): void | Promise<void>;
    /** Whether the command can run now; the default is always. Must not throw. */
    enabled?(): boolean;
    /** One chord or several, in the notation of chord.ts: "Ctrl+Y" or ["Ctrl+Y", "Ctrl+Shift+Z"]. */
    shortcut?: string | readonly string[];
    /**
     * Contexts the shortcut is bound in; the default is "global". A chord marked † in SPEC
     * §7.8 also lists "text": `context: ["global", "text"]`.
     */
    context?: KeyContext | readonly KeyContext[];
    /**
     * Place in the menu bar: the menu, then any submenus, for example ["Layer"] or
     * ["File", "Open Recent"]. The first name is one of `MENU_BAR`.
     */
    menuPath?: readonly string[];
    /**
     * Position in its menu, ascending; the default is 1000. Items whose orders differ in the
     * hundreds are separated by a line: 100 and 110 form one group, 200 starts the next.
     */
    menuOrder?: number;
    /** Context menus that list the command. */
    contextMenus?: readonly ContextMenuPlacement[];
    /**
     * Makes the shortcut a hold binding ("Space (hold)"): `run` is called once when the key
     * goes down, `release` when it comes up or the window loses focus.
     */
    release?(): void;
    /** Ids of planned commands this command takes the place of (their menu items disappear). */
    replaces?: readonly string[];
}

/**
 * A command of a later ticket that already has its menu item: shown disabled until a
 * `CommandSpec` with the same id is registered. That command takes over the menu position
 * unless it names its own. Exported as `plannedCommands` from a `*.commands.ts` module.
 */
export interface PlannedCommandSpec {
    id: string;
    title: string;
    menuPath: readonly string[];
    menuOrder?: number;
}

/** What a `*.commands.ts` module exports (at least one of the two). */
export interface CommandModule {
    commands?: readonly CommandSpec[];
    plannedCommands?: readonly PlannedCommandSpec[];
}

/** A command as the registry holds it: every optional field of the spec resolved. */
export interface Command {
    readonly id: string;
    /** The module (or "runtime") that registered the command; used in error messages. */
    readonly source: string;
    /** True for a planned command no ticket has implemented yet; it is never enabled. */
    readonly planned: boolean;
    title(): string;
    enabled(): boolean;
    run(): void | Promise<void>;
    readonly release: (() => void) | null;
    /** Canonical chords, in the order given. */
    readonly shortcuts: readonly string[];
    readonly contexts: readonly KeyContext[];
    readonly menuPath: readonly string[] | null;
    readonly menuOrder: number;
    readonly contextMenus: readonly Required<ContextMenuPlacement>[];
}

export const DEFAULT_MENU_ORDER = 1000;
