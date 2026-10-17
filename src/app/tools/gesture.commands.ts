import type { CommandSpec } from "../commands/types";
import { toolPipeline } from "./appPipeline";

// The `gesture` context of SPEC §7.8 (SE-031): while a tool's gesture of several presses is
// open (the polygon lasso), Enter closes it. The context outranks `canvas`, so Enter does not
// reach play/pause then. Escape cancels it through `tool.cancel` (tools.commands.ts), as it
// cancels a stroke; a double click on the canvas closes it too (`attachToolPointer`).

export const commands: CommandSpec[] = [
    {
        id: "tool.gesture.close",
        title: "Close Gesture",
        shortcut: "Enter",
        context: "gesture",
        enabled: () => toolPipeline.gesture,
        run: () => void toolPipeline.closeGesture(),
    },
];
