import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { settleableDocument } from "../selection/settled";
import { PLAY_PAUSE_COMMAND } from "../timeline/timelineCommandIds";
import { toolPipeline } from "../tools/appPipeline";
import { editorPlayback } from "./playback";
import { PLAYBACK_SPEEDS, playbackStore } from "./playbackState";

// Editor playback's commands (SPEC §7.5, §7.8; SE-024). Play / Pause takes the Frame menu item
// planned for it and the transport's play button, and Enter in the `canvas` and `timeline`
// contexts (a focused button of the timeline takes Enter itself; a focused cell leaves it to
// play). It is enabled while a selection floats, which starting applies, and not during a
// stroke or an open gesture. The speeds are a submenu of the Frame menu below it, as in
// Aseprite's play button menu; the speed in use is the disabled item, and Play names it when
// it is not 1×.

/** "0.25×". */
export function formatSpeed(speed: number): string {
    return `${speed}×`;
}

/** The id of the command that sets `speed`: "frame.playbackSpeed.25" for 0.25×. */
export function speedCommandId(speed: number): string {
    return `frame.playbackSpeed.${Math.round(speed * 100)}`;
}

/** Whether playback can start: a document of two frames or more, no stroke in progress. */
function canPlay(): boolean {
    const document = settleableDocument();
    return !!document && document.session.doc.frames.length > 1 && !toolPipeline.stroking;
}

function playTitle(): string {
    const { playing, speed } = playbackStore.getState();
    if (playing) return "Pause";
    return speed === 1 ? "Play" : `Play at ${formatSpeed(speed)}`;
}

export const commands: CommandSpec[] = [
    {
        id: PLAY_PAUSE_COMMAND,
        title: playTitle,
        shortcut: "Enter",
        context: ["canvas", "timeline"],
        enabled: () => playbackStore.getState().playing || canPlay(),
        run: () => editorPlayback.toggle(),
    },
    ...PLAYBACK_SPEEDS.map((speed, index): CommandSpec => ({
        id: speedCommandId(speed),
        title: formatSpeed(speed),
        menuPath: ["Frame", "Playback Speed"],
        menuOrder: 310 + index,
        enabled: () => playbackStore.getState().speed !== speed,
        run: () => editorPlayback.setSpeed(speed),
    })),
];

// Titles and states follow playback.
playbackStore.subscribe(() => appCommands.refresh());
