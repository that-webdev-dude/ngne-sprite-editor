// Ids of the tag commands (SE-023). The tag bar takes them from here, so it never loads a
// `*.commands.ts` module before the registry does (appCommands.ts).

export const TAG_COMMANDS = {
    /** New Tag…: planned in the Frame menu. */
    newTag: "frame.newTag",
    tagProperties: "frame.tagProperties",
    deleteTag: "frame.deleteTag",
    /** Outside the menus: the range a drag of a span's end gives (`tagStore.range`). */
    applyTagRange: "frame.applyTagRange",
} as const;
