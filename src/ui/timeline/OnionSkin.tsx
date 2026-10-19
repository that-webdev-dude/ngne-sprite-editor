import { Blend, SlidersHorizontal } from "lucide-react";
import { memo, useMemo, useSyncExternalStore } from "react";
import { appCommands } from "../../app/commands/appCommands";
import { formatChord } from "../../app/commands/chord";
import { ONION_SETTINGS_COMMAND, ONION_SKIN_COMMAND } from "../../app/onion/onion.commands";
import { withOnionPatch } from "../../app/onion/onion";
import { activeDocument, sessionsStore } from "../../app/state/sessions";
import type { OnionSettings } from "../../core/model";
import { runCommand } from "../commands/runCommand";
import { Icon } from "../primitives/Icon";
import { IconButton } from "../primitives/IconButton";
import { NumberField } from "../primitives/NumberField";
import { Popover } from "../primitives/Popover";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { Slider } from "../primitives/Slider";
import { Toggle } from "../primitives/Toggle";
import "../primitives/field.css";

// The onion skin controls of the transport (DESIGN §5.6, §7; SE-025): the toggle, which runs
// View → Show/Hide Onion Skin (F3), and the button of the settings popover beside it. The
// settings are the active document's `DocSettings.onion`: a change applies at once, through the
// command Apply Onion Skin Settings, makes no history entry and leaves the document clean
// (SPEC §5.2), so the popover has no Apply button.

/** Arrow keys change the falloff, a fraction, by a twentieth (as the Preferences dialog). */
const FALLOFF_STEP = 0.05;

/** The active document's onion settings as JSON, or "" while none is open. */
function snapshot(): string {
    const document = activeDocument(sessionsStore.getState());
    return document ? JSON.stringify(document.session.doc.settings.onion) : "";
}

/** The onion settings of the active document; null while none is open. */
function useOnion(): OnionSettings | null {
    const json = useSyncExternalStore(sessionsStore.subscribe, snapshot);
    return useMemo(() => (json === "" ? null : (JSON.parse(json) as OnionSettings)), [json]);
}

/** The shortcut of the toggle, as menus show it. */
function useToggleShortcut(): string | undefined {
    const chord = useSyncExternalStore(
        appCommands.subscribe,
        () => appCommands.get(ONION_SKIN_COMMAND)?.shortcuts[0] ?? null,
    );
    return chord ? formatChord(chord) : undefined;
}

/** The fields of the popover (DESIGN §7): frames before and after, opacity, falloff, tint, placement, within tag. */
function OnionFields({ onion }: { onion: OnionSettings }) {
    // Through the registry (SPEC §5): Apply Onion Skin Settings, the change handed to it.
    const set = (patch: Partial<OnionSettings>) =>
        withOnionPatch(patch, () => void runCommand(ONION_SETTINGS_COMMAND));
    return (
        <div className="timeline-onion">
            <NumberField
                label="Before"
                value={onion.before}
                min={0}
                max={3}
                step={1}
                onChange={(before) => set({ before })}
            />
            <NumberField
                label="After"
                value={onion.after}
                min={0}
                max={3}
                step={1}
                onChange={(after) => set({ after })}
            />
            <Slider
                className="timeline-onion__wide"
                label="Opacity"
                value={onion.opacity}
                min={0}
                max={255}
                onChange={(opacity) => set({ opacity })}
            />
            <NumberField
                className="timeline-onion__wide"
                label="Falloff"
                value={onion.falloff}
                min={0}
                max={1}
                step={FALLOFF_STEP}
                precision={2}
                onChange={(falloff) => set({ falloff })}
            />
            <SegmentedControl
                className="timeline-onion__wide"
                label="Placement"
                value={onion.placement}
                onChange={(placement) => set({ placement })}
                options={[
                    { value: "behind", label: "Behind" },
                    { value: "front", label: "In front" },
                ]}
            />
            <Toggle
                label="Tint"
                showLabel
                pressed={onion.tint}
                onPressedChange={(tint) => set({ tint })}
            />
            <Toggle
                label="Within tag"
                showLabel
                pressed={onion.withinTag}
                onPressedChange={(withinTag) => set({ withinTag })}
            />
        </div>
    );
}

/**
 * The onion skin toggle and its settings button, after Last Frame in the transport. Both are
 * disabled while no document is open.
 */
export const OnionSkinControls = memo(function OnionSkinControls() {
    const onion = useOnion();
    const shortcut = useToggleShortcut();
    return (
        <>
            <Toggle
                label="Onion skin"
                shortcut={shortcut}
                pressed={onion?.enabled ?? false}
                disabled={!onion}
                data-command={ONION_SKIN_COMMAND}
                onPressedChange={() => runCommand(ONION_SKIN_COMMAND)}
            >
                <Icon icon={Blend} />
            </Toggle>
            <Popover
                label="Onion skin settings"
                side="top"
                trigger={
                    <IconButton label="Onion skin settings" disabled={!onion}>
                        <Icon icon={SlidersHorizontal} />
                    </IconButton>
                }
            >
                {onion ? <OnionFields onion={onion} /> : null}
            </Popover>
        </>
    );
});
