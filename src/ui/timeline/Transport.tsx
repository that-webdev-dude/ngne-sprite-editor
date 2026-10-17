import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Play, Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { memo, useMemo, useSyncExternalStore } from "react";
import { appCommands } from "../../app/commands/appCommands";
import { formatChord } from "../../app/commands/chord";
import { PLAY_PAUSE_COMMAND, TIMELINE_COMMANDS } from "../../app/timeline/timelineCommandIds";
import { withArguments } from "../../app/timeline/timelineState";
import { runCommand } from "../commands/runCommand";
import { Icon } from "../primitives/Icon";
import { IconButton } from "../primitives/IconButton";
import { NumberField } from "../primitives/NumberField";

/**
 * The transport buttons of DESIGN §5.6, left to right, each the registry's command: shown
 * disabled while the command is disabled or not implemented yet (play / pause is SE-024's).
 * The onion-skin toggle follows the last of them (SE-025).
 */
const TRANSPORT: readonly (readonly [id: string, icon: LucideIcon])[] = [
    [TIMELINE_COMMANDS.firstFrame, ChevronFirst],
    [TIMELINE_COMMANDS.previousFrame, ChevronLeft],
    [PLAY_PAUSE_COMMAND, Play],
    [TIMELINE_COMMANDS.nextFrame, ChevronRight],
    [TIMELINE_COMMANDS.lastFrame, ChevronLast],
];
const TRANSPORT_IDS = TRANSPORT.map(([id]) => id);
const CORNER_IDS = [TIMELINE_COMMANDS.newLayer];

/** What a button shows of its command. */
interface CommandView {
    id: string;
    title: string;
    enabled: boolean;
    /** The first chord, as menus show it. */
    shortcut: string | null;
}

/**
 * The commands' titles, states and keys. The registry tells of every change of the session
 * store; the buttons render again only when what they show has changed.
 */
function useCommandViews(ids: readonly string[]): readonly (CommandView | null)[] {
    const snapshot = useSyncExternalStore(appCommands.subscribe, () =>
        JSON.stringify(
            ids.map((id): CommandView | null => {
                const command = appCommands.get(id);
                if (!command) return null;
                const [chord] = command.shortcuts;
                return {
                    id,
                    title: command.title(),
                    enabled: command.enabled(),
                    shortcut: chord ? formatChord(chord) : null,
                };
            }),
        ),
    );
    return useMemo(() => JSON.parse(snapshot) as (CommandView | null)[], [snapshot]);
}

function CommandButton({ view, icon }: { view: CommandView | null; icon: LucideIcon }) {
    if (!view) return null;
    return (
        <IconButton
            label={view.title}
            shortcut={view.shortcut ?? undefined}
            disabled={!view.enabled}
            data-command={view.id}
            onClick={() => runCommand(view.id)}
        >
            <Icon icon={icon} />
        </IconButton>
    );
}

/** The transport, at the left of the tag bar. */
export const Transport = memo(function Transport() {
    const views = useCommandViews(TRANSPORT_IDS);
    return (
        <div className="timeline__transport" role="group" aria-label="Transport">
            {TRANSPORT.map(([id, icon], index) => (
                <CommandButton key={id} view={views[index] ?? null} icon={icon} />
            ))}
        </div>
    );
});

/**
 * The head of the layer column, beside the frame numbers: the duration of the selected frames
 * (of the active frame when none is selected), and New Layer. The duration field sits here and
 * not in the transport, where the six buttons of DESIGN §5.6 leave it no room in 200 px.
 */
export const TimelineCorner = memo(function TimelineCorner({
    durationMs,
}: {
    durationMs: number | null;
}) {
    const [newLayer] = useCommandViews(CORNER_IDS);
    return (
        <div className="timeline__corner" role="columnheader" aria-label="Layers">
            {durationMs === null ? null : (
                // No scrub handle: each change of the field is a step of the history.
                <NumberField
                    className="timeline__duration"
                    label="Frame duration"
                    hideLabel
                    unit="ms"
                    min={1}
                    max={65535}
                    step={1}
                    value={durationMs}
                    onChange={(duration) =>
                        withArguments(
                            { duration },
                            () => void runCommand(TIMELINE_COMMANDS.setDuration),
                        )
                    }
                />
            )}
            <CommandButton view={newLayer ?? null} icon={Plus} />
        </div>
    );
});
