import { useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { PREFERENCE_RANGES, preferences, usePreference } from "../../app/preferences/preferences";
import type {
    CheckerboardPreference,
    GridPreference,
    ImportPreference,
    OnionPreference,
} from "../../app/preferences/preferences";
import { surfaces } from "../../app/surfaces/surfaces";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";
import type { SegmentedControlProps, SegmentedOption } from "../primitives/SegmentedControl";
import { Select } from "../primitives/Select";
import type { SelectOption } from "../primitives/Select";
import { Toggle } from "../primitives/Toggle";
import { DEFAULT_THEME, setTheme, useTheme } from "../theme/theme";
import type { Theme } from "../theme/theme";
import { formatHexColour, parseHexColour } from "./hexColour";
import "../primitives/field.css";
import "./preferences.css";

type CheckerColours = Exclude<CheckerboardPreference["colors"], "theme">;

const THEMES: readonly SegmentedOption<Theme>[] = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
];
const CHECKER_SOURCES: readonly SegmentedOption<"theme" | "custom">[] = [
    { value: "theme", label: "Theme" },
    { value: "custom", label: "Custom" },
];
const PLACEMENTS: readonly SegmentedOption<OnionPreference["placement"]>[] = [
    { value: "behind", label: "Behind" },
    { value: "front", label: "In front" },
];
// The names of SPEC §8, steps 5 and 8.
const RESAMPLING: readonly SelectOption<ImportPreference["resample"]>[] = [
    { value: "nearest", label: "Nearest" },
    { value: "area", label: "Area average" },
    { value: "dominant", label: "Dominant colour" },
];
const DITHERING: readonly SelectOption<ImportPreference["dither"]>[] = [
    { value: "none", label: "None" },
    { value: "ordered", label: "Ordered (Bayer 4×4)" },
    { value: "floyd-steinberg", label: "Floyd–Steinberg" },
];
/** Arrow keys change the falloff, a fraction, by a twentieth. */
const FALLOFF_STEP = 0.05;

const close = () => surfaces.close("preferences");

/** The checkerboard of the current theme (DESIGN §3.1), read from its tokens. */
function themeCheckerColours(): CheckerColours {
    const style = getComputedStyle(document.documentElement);
    const token = (name: string) => parseHexColour(style.getPropertyValue(name)) ?? 0;
    return { a: token("--check-a"), b: token("--check-b") };
}

/** One preference: its name in the label column, its controls as a named group. */
function Section({ label, children }: { label: string; children: ReactNode }) {
    const labelId = useId();
    return (
        <>
            <span className="ui-field__label preferences__label" id={labelId}>
                {label}
            </span>
            <div className="preferences__group" role="group" aria-labelledby={labelId}>
                {children}
            </div>
        </>
    );
}

function Row({ children }: { children: ReactNode }) {
    return <div className="preferences__row">{children}</div>;
}

/** A segmented control with its name shown before it, as the fields show theirs. */
function LabelledSegments<Value extends string>(props: SegmentedControlProps<Value>) {
    return (
        <span className="ui-field">
            <span className="ui-field__label" aria-hidden="true">
                {props.label}
            </span>
            <SegmentedControl {...props} />
        </span>
    );
}

interface HexFieldProps {
    label: string;
    /** 0xRRGGBB. */
    value: number;
    onChange(value: number): void;
}

/**
 * A colour as hex text. Like the number field, what is typed applies on Enter or when the
 * field is left, and text that is not a colour is dropped.
 */
function HexField({ label, value, onChange }: HexFieldProps) {
    const inputId = useId();
    const [draft, setDraft] = useState<string | null>(null);
    const commit = () => {
        if (draft === null) return;
        const colour = parseHexColour(draft);
        setDraft(null);
        if (colour !== null && colour !== value) onChange(colour);
    };
    return (
        <span className="ui-field">
            <label className="ui-field__label" htmlFor={inputId}>
                {label}
            </label>
            <input
                id={inputId}
                className="preferences__hex"
                type="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={7}
                value={draft ?? formatHexColour(value)}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === "Enter") commit();
                    else if (event.key === "Escape") setDraft(null);
                }}
            />
        </span>
    );
}

function CheckerboardSection() {
    const checkerboard = usePreference("checkerboard");
    const { colors } = checkerboard;
    // The colours last chosen, so that Theme and back to Custom does not lose them.
    const lastCustom = useRef<CheckerColours | null>(null);
    const set = (patch: Partial<CheckerboardPreference>) =>
        preferences.set("checkerboard", { ...checkerboard, ...patch });
    const setSource = (source: "theme" | "custom") => {
        if (source === "theme") {
            if (colors !== "theme") lastCustom.current = colors;
            set({ colors: "theme" });
        } else if (colors === "theme") {
            set({ colors: lastCustom.current ?? themeCheckerColours() });
        }
    };
    // Custom colours replace the tokens for the preview; without them it shows the theme's.
    const preview =
        colors === "theme"
            ? undefined
            : ({
                  "--check-a": formatHexColour(colors.a),
                  "--check-b": formatHexColour(colors.b),
              } as CSSProperties);

    return (
        <Section label="Checkerboard">
            <Row>
                <LabelledSegments
                    label="Colours"
                    value={colors === "theme" ? "theme" : "custom"}
                    onChange={setSource}
                    options={CHECKER_SOURCES}
                />
                <NumberField
                    label="Size"
                    value={checkerboard.size}
                    onChange={(size) => set({ size })}
                    unit="px"
                    {...PREFERENCE_RANGES.checkerboardSize}
                />
                <span className="preferences__checker" style={preview} aria-hidden="true" />
            </Row>
            {colors === "theme" ? null : (
                <Row>
                    <HexField
                        label="Colour A"
                        value={colors.a}
                        onChange={(a) => set({ colors: { ...colors, a } })}
                    />
                    <HexField
                        label="Colour B"
                        value={colors.b}
                        onChange={(b) => set({ colors: { ...colors, b } })}
                    />
                </Row>
            )}
        </Section>
    );
}

function GridSection() {
    const grid = usePreference("grid");
    const set = (patch: Partial<GridPreference>) => preferences.set("grid", { ...grid, ...patch });
    return (
        <Section label="Default grid">
            <Row>
                <NumberField
                    label="Width"
                    value={grid.width}
                    onChange={(width) => set({ width })}
                    unit="px"
                    {...PREFERENCE_RANGES.side}
                />
                <NumberField
                    label="Height"
                    value={grid.height}
                    onChange={(height) => set({ height })}
                    unit="px"
                    {...PREFERENCE_RANGES.side}
                />
            </Row>
        </Section>
    );
}

function OnionSection() {
    const onion = usePreference("onion");
    const set = (patch: Partial<OnionPreference>) =>
        preferences.set("onion", { ...onion, ...patch });
    return (
        <Section label="Onion skin defaults">
            <Row>
                <Toggle
                    label="Onion skin"
                    showLabel
                    pressed={onion.enabled}
                    onPressedChange={(enabled) => set({ enabled })}
                />
                <NumberField
                    label="Before"
                    value={onion.before}
                    onChange={(before) => set({ before })}
                    {...PREFERENCE_RANGES.onionFrames}
                />
                <NumberField
                    label="After"
                    value={onion.after}
                    onChange={(after) => set({ after })}
                    {...PREFERENCE_RANGES.onionFrames}
                />
            </Row>
            <Row>
                <NumberField
                    label="Opacity"
                    value={onion.opacity}
                    onChange={(opacity) => set({ opacity })}
                    {...PREFERENCE_RANGES.onionOpacity}
                />
                <NumberField
                    label="Falloff"
                    value={onion.falloff}
                    onChange={(falloff) => set({ falloff })}
                    step={FALLOFF_STEP}
                    {...PREFERENCE_RANGES.onionFalloff}
                />
            </Row>
            <Row>
                <LabelledSegments
                    label="Placement"
                    value={onion.placement}
                    onChange={(placement) => set({ placement })}
                    options={PLACEMENTS}
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
            </Row>
        </Section>
    );
}

function ImportSection() {
    const defaults = usePreference("import");
    const set = (patch: Partial<ImportPreference>) =>
        preferences.set("import", { ...defaults, ...patch });
    return (
        <Section label="Import defaults">
            <Row>
                <NumberField
                    label="Target width"
                    value={defaults.targetWidth}
                    onChange={(targetWidth) => set({ targetWidth })}
                    unit="px"
                    {...PREFERENCE_RANGES.side}
                />
                <NumberField
                    label="Target height"
                    value={defaults.targetHeight}
                    onChange={(targetHeight) => set({ targetHeight })}
                    unit="px"
                    {...PREFERENCE_RANGES.side}
                />
            </Row>
            <Row>
                <Select
                    label="Resample"
                    value={defaults.resample}
                    onChange={(resample) => set({ resample })}
                    options={RESAMPLING}
                />
                <NumberField
                    label="Alpha threshold"
                    value={defaults.alphaThreshold}
                    onChange={(alphaThreshold) => set({ alphaThreshold })}
                    {...PREFERENCE_RANGES.alphaThreshold}
                />
            </Row>
            <Row>
                <NumberField
                    label="Colours"
                    value={defaults.colors}
                    onChange={(colors) => set({ colors })}
                    {...PREFERENCE_RANGES.importColors}
                />
                <Select
                    label="Dither"
                    value={defaults.dither}
                    onChange={(dither) => set({ dither })}
                    options={DITHERING}
                />
            </Row>
        </Section>
    );
}

function AutosaveSection() {
    const autosave = usePreference("autosave");
    return (
        <Section label="Autosave">
            <Row>
                <Toggle
                    label="Autosave"
                    showLabel
                    pressed={autosave.enabled}
                    onPressedChange={(enabled) => preferences.set("autosave", { enabled })}
                />
            </Row>
        </Section>
    );
}

/**
 * Preferences dialog (DESIGN §7): the theme and every value of the preference store. A change
 * applies at once: it is written to its store, which tells its subscribers and persists it.
 * There is nothing to confirm, so the dialog has Close, and Restore defaults to go back. The
 * theme belongs to the theme store (ui/theme), the rest to the preference store. Every on/off
 * setting is a text toggle (`aria-pressed`), the one idiom of DESIGN §4 (SE-071).
 */
export function PreferencesDialog() {
    const theme = useTheme();
    const restoreDefaults = () => {
        preferences.reset();
        setTheme(DEFAULT_THEME);
    };
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) close();
            }}
            title="Preferences"
            actions={
                <>
                    <Button onClick={restoreDefaults}>Restore defaults</Button>
                    <Button variant="primary" onClick={close}>
                        Close
                    </Button>
                </>
            }
        >
            <div className="preferences">
                <Section label="Theme">
                    <Row>
                        <SegmentedControl
                            label="Theme"
                            value={theme}
                            onChange={setTheme}
                            options={THEMES}
                        />
                    </Row>
                </Section>
                <CheckerboardSection />
                <GridSection />
                <OnionSection />
                <ImportSection />
                <AutosaveSection />
            </div>
        </Dialog>
    );
}
