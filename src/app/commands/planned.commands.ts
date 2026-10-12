import type { MenuBarMenu, PlannedCommandSpec } from "./types";

/**
 * Menu items of commands that later tickets implement. Each is shown disabled until a
 * `CommandSpec` with the same id is registered from that ticket's own `*.commands.ts` module;
 * the command then takes over the item, its position included, and adds its shortcut. A
 * ticket that shapes a feature differently lists the ids it supersedes in `replaces`.
 *
 * The list follows the v1 features of SPEC §2.3 and the menus of Aseprite (DESIGN §1, principle 4).
 * Orders are spaced by 10; the hundreds are the separator groups.
 */
function menu(
    name: MenuBarMenu,
    groups: readonly (readonly [id: string, title: string])[][],
): PlannedCommandSpec[] {
    return groups.flatMap((group, groupIndex) =>
        group.map(([id, title], index) => ({
            id,
            title,
            menuPath: [name],
            menuOrder: (groupIndex + 1) * 100 + index * 10,
        })),
    );
}

export const plannedCommands: PlannedCommandSpec[] = [
    ...menu("File", [
        [
            ["file.new", "New Sprite…"],
            ["file.open", "Open…"],
        ],
        [
            ["file.save", "Save"],
            ["file.saveAs", "Save As…"],
            ["file.revert", "Revert"],
        ],
        [["file.importPng", "Import PNG…"]],
        [
            ["file.export", "Export…"],
            ["file.exportAgain", "Export Again"],
        ],
        [["file.close", "Close"]],
    ]),
    // Group 1 of Edit is Undo and Redo (state/history.commands.ts).
    ...menu("Edit", [
        [],
        [
            ["edit.cut", "Cut"],
            ["edit.copy", "Copy"],
            ["edit.paste", "Paste"],
            ["edit.delete", "Delete"],
            ["edit.fill", "Fill"],
        ],
        [
            ["edit.flipHorizontal", "Flip Horizontal"],
            ["edit.flipVertical", "Flip Vertical"],
            ["edit.rotate90cw", "Rotate 90° CW"],
            ["edit.rotate90ccw", "Rotate 90° CCW"],
            ["edit.rotate180", "Rotate 180°"],
        ],
        [["edit.replaceColour", "Replace Colour…"]],
        [
            ["edit.commandPalette", "Command Palette…"],
            ["edit.shortcuts", "Keyboard Shortcuts…"],
            ["edit.preferences", "Preferences…"],
        ],
    ]),
    ...menu("Sprite", [
        [["sprite.properties", "Properties…"]],
        [
            ["sprite.canvasSize", "Canvas Size…"],
            ["sprite.spriteSize", "Sprite Size…"],
            ["sprite.crop", "Crop to Selection"],
            ["sprite.trim", "Trim"],
        ],
        [
            ["sprite.rotate90", "Rotate Canvas 90°"],
            ["sprite.rotate180", "Rotate Canvas 180°"],
            ["sprite.flipHorizontal", "Flip Canvas Horizontal"],
            ["sprite.flipVertical", "Flip Canvas Vertical"],
        ],
    ]),
    ...menu("Layer", [
        [
            ["layer.new", "New Layer"],
            ["layer.newReference", "New Reference Layer from File…"],
        ],
        [
            ["layer.duplicate", "Duplicate Layer"],
            ["layer.delete", "Delete Layer"],
        ],
        [
            ["layer.mergeDown", "Merge Down"],
            ["layer.flatten", "Flatten"],
        ],
        [["layer.properties", "Layer Properties…"]],
    ]),
    ...menu("Frame", [
        [
            ["frame.new", "New Frame"],
            ["frame.newEmpty", "New Empty Frame"],
            ["frame.delete", "Delete Frame"],
            ["frame.reverse", "Reverse Frames"],
        ],
        [
            ["frame.first", "First Frame"],
            ["frame.previous", "Previous Frame"],
            ["frame.next", "Next Frame"],
            ["frame.last", "Last Frame"],
        ],
        [["frame.playPause", "Play / Pause"]],
        [["frame.newTag", "New Tag…"]],
        [["frame.celProperties", "Cel Properties…"]],
    ]),
    ...menu("Select", [
        [
            ["select.all", "Select All"],
            ["select.none", "Deselect"],
            ["select.invert", "Invert Selection"],
        ],
    ]),
    ...menu("View", [
        [
            ["view.zoomIn", "Zoom In"],
            ["view.zoomOut", "Zoom Out"],
            ["view.fit", "Fit"],
            ["view.zoom100", "100%"],
        ],
        [
            ["view.grid", "Grid"],
            ["view.pixelGrid", "Pixel Grid"],
        ],
        [["view.onionSkin", "Onion Skin"]],
        [
            ["view.symmetry", "Symmetry"],
            ["view.tiled", "Tiled Mode"],
        ],
        [["view.timeline", "Timeline"]],
    ]),
];
