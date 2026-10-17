import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Play, Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { memo, useMemo, useSyncExternalStore } from "react";
import { appCommands } from "../../app/commands/appCommands";
import { formatChord } from "../../app/commands/chord";
import { activeDocument, sessionsStore } from "../../app/state/sessions";
import { beginDurationEdit, shownDuration } from "../../app/timeline/frameDuration";
import type { ShownDuration } from "../../app/timeline/frameDuration";
import { PLAY_PAUSE_COMMAND, TIMELINE_COMMANDS } from "../../app/timeline/timelineCommandIds";
import { endDurationEdit, timelineStore, withArguments } from "../../app/timeline/timelineState";
import { runCommand } from "../commands/runCommand";
import { Icon } from "../primitives/Icon";
import { IconButton } from "../primitives/IconButton";
import { NumberField } from "../primitives/NumberField";
import { TIMELINE_FIELD_ATTRIBUTE } from "./timelineDom";

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

function subscribeDuration(listener: () => void): () => void {
    const stopSessions = sessionsStore.subscribe(listener);
    const stopTimeline = timelineStore.subscribe(listener);
    return () => {
        stopSessions();
        stopTimeline();
    };
}

/**
 * What the duration field shows (`shownDuration`), read from the stores as they are now: a
 * second arrow key right after the first steps from the value the first set.
 */
function useShownDuration(): ShownDuration | null {
    const snapshot = useSyncExternalStore(subscribeDuration, () => {
        const document = activeDocument(sessionsStore.getState());
        const shown = document ? shownDuration(document, timelineStore.getState()) : null;
        return shown ? `${shown.durationMs}${shown.mixed ? " mixed" : ""}` : "";
    });
    return useMemo(() => {
        if (snapshot === "") return null;
        const [durationMs = "", mixed] = snapshot.split(" ");
        return { durationMs: Number(durationMs), mixed: mixed !== undefined };
    }, [snapshot]);
}

/**
 * The head of the layer column, beside the frame numbers: the duration of the selected frames
 * (of the active frame when none is selected), and New Layer. The duration field sits here and
 * not in the transport, where the six buttons of DESIGN §5.6 leave it no room in 200 px. While
 * it has the focus it acts on the frames it acted on when it took it (`beginDurationEdit`);
 * when their durations differ it shows "—".
 */
export const TimelineCorner = memo(function TimelineCorner() {
    const [newLayer] = useCommandViews(CORNER_IDS);
    const shown = useShownDuration();
    return (
        <div className="timeline__corner" role="columnheader" aria-label="Layers">
            {shown === null ? null : (
                <span
                    className="timeline__duration-box"
                    {...{ [TIMELINE_FIELD_ATTRIBUTE]: "" }}
                    onFocus={beginDurationEdit}
                    // After the field's own blur, which applies what it holds.
                    onBlur={endDurationEdit}
                >
                    {/* No scrub handle: each change of the field is a step of the history. */}
                    <NumberField
                        className="timeline__duration"
                        label="Frame duration"
                        hideLabel
                        unit="ms"
                        min={1}
                        max={65535}
                        step={1}
                        value={shown.durationMs}
                        mixed={shown.mixed}
                        onChange={(duration) =>
                            withArguments(
                                { duration },
                                () => void runCommand(TIMELINE_COMMANDS.setDuration),
                            )
                        }
                    />
                </span>
            )}
            <CommandButton view={newLayer ?? null} icon={Plus} />
        </div>
    );
});
