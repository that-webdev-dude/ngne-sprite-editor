import type { ComponentType } from "react";
import type { DialogRequestBase } from "../../app/dialogs/dialogRequests";
// Declares `import.meta.glob` wherever this module is compiled.
import type {} from "../../import-meta";

/**
 * Registry of the dialogs commands ask for (app/dialogs/dialogRequests.ts). A feature adds a
 * dialog by creating a module named `*.dialog.tsx` anywhere under `src/ui` that exports
 * `commandDialogs`; this file finds it with a glob import, so no shared file is edited
 * (AGENTS.md, Parallel work). The dialog host shows the dialog of the open request's kind.
 *
 *     // src/ui/sprite/sprite.dialog.tsx
 *     export const commandDialogs = [
 *         commandDialog<NewSpriteRequest>("new-sprite", "New sprite", NewSpriteDialog),
 *     ];
 */
export interface CommandDialog {
    /** The request kind it shows; unique. */
    kind: string;
    /** Name of the dialog, for the message when it fails. */
    name: string;
    /** The dialog, given the open request; it answers it. */
    Component: ComponentType<{ request: DialogRequestBase }>;
}

/** What a `*.dialog.tsx` module exports. */
export interface CommandDialogModule {
    commandDialogs?: readonly CommandDialog[];
}

/** A registry entry for the requests of one kind, typed by its request. */
export function commandDialog<Request extends DialogRequestBase>(
    kind: Request["kind"],
    name: string,
    Component: ComponentType<{ request: Request }>,
): CommandDialog {
    // The host gives a component only requests of its own kind.
    return { kind, name, Component: Component as ComponentType<{ request: DialogRequestBase }> };
}

/** Validates the discovered modules and returns their dialogs by kind. */
export function collectCommandDialogs(
    modules: Record<string, CommandDialogModule>,
): ReadonlyMap<string, CommandDialog> {
    const dialogs = new Map<string, CommandDialog>();
    const seen = new Map<string, string>();
    for (const [path, module] of Object.entries(modules)) {
        if (!module.commandDialogs) throw new Error(`${path} does not export "commandDialogs".`);
        for (const dialog of module.commandDialogs) {
            const first = seen.get(dialog.kind);
            if (first) {
                throw new Error(`Dialog kind "${dialog.kind}" is used by ${first} and ${path}.`);
            }
            seen.set(dialog.kind, path);
            dialogs.set(dialog.kind, dialog);
        }
    }
    return dialogs;
}

/** Every dialog of the app, by the request kind it shows. */
export const registeredDialogs: ReadonlyMap<string, CommandDialog> = collectCommandDialogs(
    import.meta.glob<CommandDialogModule>("../**/*.dialog.tsx", { eager: true }),
);
