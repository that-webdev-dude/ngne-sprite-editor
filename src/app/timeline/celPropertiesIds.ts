// Ids of the commands of the cel properties popover (SE-061). The panel takes them from here,
// so it never loads a `*.commands.ts` module before the registry does (appCommands.ts).

export const CEL_PROPERTIES_COMMANDS = {
    /** Planned in the Frame menu (planned.commands.ts); also in the cel context menu. */
    open: "frame.celProperties",
    /** Outside the menus: the popover closes and its opacity is applied. */
    apply: "cel.applyProperties",
    /** Outside the menus: the popover's Unlink button. */
    unlink: "cel.unlinkProperties",
} as const;
