import type { CommandSpec } from "../commands/types";
import { TIMELINE_COMMANDS as IDS } from "./timelineCommandIds";
import { setTimelineVisible, timelineStore } from "./timelineState";

// SPEC §7.8: Tab toggles the timeline while the viewport itself has focus (a native key acts
// in `canvas` only there; elsewhere Tab moves the focus). It takes the View menu item planned
// for it. As the other View toggles, it is titled by what it will do (REVIEW E37). The panel
// is shown again at every start: the state is not persisted.

export const commands: CommandSpec[] = [
    {
        id: IDS.toggleTimeline,
        title: () => (timelineStore.getState().visible ? "Hide Timeline" : "Show Timeline"),
        shortcut: "Tab",
        context: "canvas",
        run: () => setTimelineVisible(!timelineStore.getState().visible),
    },
];
