// Ids of the timeline's editing commands and context menus (SE-026). The panel takes them from
// here, so it never loads a `*.commands.ts` module before the registry does (appCommands.ts).

export const TIMELINE_EDIT_COMMANDS = {
    /** Cel commands of the cel context menu, on the cels the timeline targets (`celTargets`). */
    linkCels: "cel.link",
    unlinkCels: "cel.unlink",
    clearCels: "cel.clear",
    /** Outside the menus: the drops of a drag (`timelineDrop`), one undo step each. */
    moveCels: "cel.move",
    copyCels: "cel.copy",
    moveFrames: "frame.move",
    moveLayers: "layer.move",
    /** Planned in the Frame and Layer menus (planned.commands.ts); SE-026 implements them. */
    reverseFrames: "frame.reverse",
    mergeDown: "layer.mergeDown",
    flatten: "layer.flatten",
} as const;

/**
 * The names of the timeline's context menus (DESIGN §4): a command lists the menus it appears
 * in (`CommandSpec.contextMenus`), and the panel shows the menu of what was right-clicked.
 */
export const TIMELINE_MENUS = {
    layer: "timeline.layer",
    frame: "timeline.frame",
    cel: "timeline.cel",
    tag: "timeline.tag",
} as const;

export type TimelineMenu = (typeof TIMELINE_MENUS)[keyof typeof TIMELINE_MENUS];
