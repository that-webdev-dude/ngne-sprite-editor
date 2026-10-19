import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import type { ImportRequest } from "../../app/import/importDialog";
import {
    gridOf,
    placeProblem,
    referenceProblem,
    settingsOf,
    slices,
} from "../../app/import/importForm";
import type {
    AlphaChoice,
    ColorsChoice,
    DitherChoice,
    ImportForm,
    ImportPlace,
} from "../../app/import/importForm";
import { formatHex, parseHex } from "../../core/color";
import type { ImportPaletteMode, ResampleFit, ResampleMethod } from "../../core/import";
import { PRESET_PALETTES } from "../../core/palettes";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";
import type { SegmentedOption } from "../primitives/SegmentedControl";
import { Select } from "../primitives/Select";
import type { SelectOption } from "../primitives/Select";
import { Toggle } from "../primitives/Toggle";
import { ResultPane, defaultZoom } from "./ResultPane";
import type { ResultZoom } from "./ResultPane";
import { SourcePane } from "./SourcePane";
import "../primitives/field.css";
import "./import.css";

const FITS: readonly SegmentedOption<ResampleFit>[] = [
    { value: "stretch", label: "Stretch" },
    { value: "contain", label: "Contain" },
    { value: "cover", label: "Cover" },
];
const RESAMPLES: readonly SelectOption<ResampleMethod>[] = [
    { value: "nearest", label: "Nearest" },
    { value: "area", label: "Area average" },
    { value: "dominant", label: "Dominant colour" },
];
const DITHERS: readonly SegmentedOption<DitherChoice>[] = [
    { value: "none", label: "None" },
    { value: "ordered", label: "Ordered" },
    { value: "floyd-steinberg", label: "Floyd–Steinberg" },
];
const PALETTE_MODES: readonly SegmentedOption<ImportPaletteMode>[] = [
    { value: "replace", label: "Replace" },
    { value: "append", label: "Append new colours" },
    { value: "keep", label: "Leave unchanged" },
];
const SIDE = { min: 1, max: 1024 };

/** One step of the form: its name in the label column, its controls as a named group. */
function Step({ label, children }: { label: string; children: ReactNode }) {
    const labelId = useId();
    return (
        <>
            <span className="ui-field__label import-dialog__label" id={labelId}>
                {label}
            </span>
            <div className="import-dialog__group" role="group" aria-labelledby={labelId}>
                {children}
            </div>
        </>
    );
}

function Row({ children }: { children: ReactNode }) {
    return <div className="import-dialog__row">{children}</div>;
}

/** A colour key as hex text: applied when it parses, kept as typed until then. */
function KeyColourField({
    colour,
    onChange,
    disabled,
}: {
    colour: number;
    onChange(colour: number): void;
    disabled: boolean;
}) {
    const id = useId();
    const [text, setText] = useState(() => formatHex(colour | 0xff));
    const parsed = parseHex(text);
    return (
        <span className="ui-field">
            <label className="ui-field__label" htmlFor={id}>
                Key colour
            </label>
            <input
                id={id}
                className="import-dialog__hex"
                type="text"
                autoComplete="off"
                spellCheck={false}
                disabled={disabled}
                aria-invalid={parsed === null || undefined}
                value={text}
                onChange={(event) => {
                    setText(event.target.value);
                    const next = parseHex(event.target.value);
                    if (next !== null) onChange(next);
                }}
                onBlur={() => {
                    if (parsed !== null) setText(formatHex(parsed | 0xff));
                }}
            />
        </span>
    );
}

/** "4 frames · 32 × 32 · 8 colours". */
export function summaryOf(frames: number, width: number, height: number, colours: number): string {
    const plural = (count: number, one: string, many: string) =>
        `${count} ${count === 1 ? one : many}`;
    return `${plural(frames, "frame", "frames")} · ${width} × ${height} · ${plural(colours, "colour", "colours")}`;
}

/** Resolves after the next frame is painted: "Importing…" shows before the work begins. */
function painted(): Promise<void> {
    return new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
}

/**
 * Import PNG (DESIGN §7; SPEC §8; SE-044): the source with its crop rectangle and grid on the
 * left, the frames at the target size on the right, the steps of SPEC §8 below as one compact
 * form, then the result line and any message. Every change asks the live preview again; the
 * smart steps 6 and 7 show what the preview decided for them. Import is disabled while there is
 * nothing to import, the preview computes or failed, or the frames cannot go where the form
 * says. Import waits for the preview's answer to the form as it is, and places the frames while
 * the dialog stays open ("Importing…"); it closes once they are placed, and otherwise shows
 * why not and stays (SE-044 review B).
 */

export function ImportDialog({ request }: { request: ImportRequest }) {
    const { sources, errors, reading, generation } = useStore(request.sources);
    const preview = useStore(request.preview.store);
    const [form, setForm] = useState<ImportForm>(request.initial);
    const changed = useRef(new Set<keyof ImportForm>());
    /** What Import is doing: waiting for the preview's answer, or placing the frames. */
    const [phase, setPhase] = useState<"checking" | "importing" | null>(null);
    /** Why the last Import placed nothing; cleared by the next change. */
    const [failure, setFailure] = useState<string | null>(null);
    const [shownSource, setShownSource] = useState(0);
    const referenceNoteId = useId();
    const [zoom, setZoom] = useState<ResultZoom>(() =>
        defaultZoom(request.initial.width, request.initial.height),
    );

    const set = <Key extends keyof ImportForm>(key: Key, value: ImportForm[Key]) => {
        changed.current.add(key);
        setFailure(null);
        setForm((current) => ({ ...current, [key]: value }));
    };
    const setMany = (patch: Partial<ImportForm>) => {
        for (const key of Object.keys(patch) as (keyof ImportForm)[]) changed.current.add(key);
        setFailure(null);
        setForm((current) => ({ ...current, ...patch }));
    };

    // Other sources: the crop of the earlier ones means nothing for them (state adjusted
    // while rendering, as React advises for a change of props).
    const [seenGeneration, setSeenGeneration] = useState(generation);
    if (seenGeneration !== generation) {
        setSeenGeneration(generation);
        if (seenGeneration !== 0) {
            setForm((current) => (current.crop ? { ...current, crop: null } : current));
            setShownSource(0);
        }
    }

    const sourceCount = sources.length;
    const target = request.target;
    const computed = useMemo(
        () => settingsOf(form, sourceCount, target?.palette ?? null),
        [form, sourceCount, target],
    );
    useEffect(() => {
        if (sourceCount === 0) return;
        request.preview.request(computed.settings, computed.smart);
    }, [computed, sourceCount, generation, request.preview]);

    // An answer for sources that were replaced by none is not shown.
    const result = sources.length > 0 ? preview.result : null;
    const decided = result?.settings ?? null;
    const alphaShown: Exclude<AlphaChoice, "smart"> =
        form.alpha !== "smart"
            ? form.alpha
            : decided?.alpha.threshold !== undefined
              ? "threshold"
              : "keep";
    const colorsShown: Exclude<ColorsChoice, "smart"> =
        form.colors !== "smart"
            ? form.colors
            : decided?.colors.mode === "reduce"
              ? "reduce"
              : "keep";
    const thresholdShown =
        form.alpha === "smart" ? (decided?.alpha.threshold ?? form.threshold) : form.threshold;

    const first = sources[Math.min(shownSource, sourceCount - 1)] ?? null;
    const notKept = referenceProblem(form, sourceCount, target);
    const referenceAvailable = notKept === null;
    const problem = placeProblem(form, target);
    const error = sourceCount === 0 ? null : preview.error;
    /** The preview shows the answer to the newest request, and nothing is being computed. */
    const current = !preview.computing && result !== null && result.id === preview.requested;
    const canImport =
        !reading &&
        sourceCount > 0 &&
        current &&
        error === null &&
        problem === null &&
        phase === null;

    const confirm = async () => {
        if (phase !== null) return;
        setPhase("checking");
        setFailure(null);
        // The answer for the form as it is now: asked again if the preview has not been yet
        // (an equal request asks nothing), and waited for.
        request.preview.request(computed.settings, computed.smart);
        const settled = await request.preview.settled();
        const state = request.preview.store.getState();
        if (
            !settled ||
            state.error !== null ||
            settled.id !== state.requested ||
            placeProblem(form, target) !== null
        ) {
            // The error shows in the result pane, the problem in the message line.
            setPhase(null);
            return;
        }
        setPhase("importing");
        await painted();
        const answer = {
            form: { ...form, keepReference: form.keepReference && referenceAvailable },
            changed: [...changed.current],
            frames: settled.frames.length,
        };
        const why = await request.place(answer, settled);
        if (why !== null) {
            setPhase(null);
            setFailure(why);
            return;
        }
        request.answer(answer);
    };
    const several = sourceCount > 1;
    const sliced = slices(form, sourceCount);

    const resultSize = result?.settings.size;
    const summary =
        result && resultSize && !error
            ? summaryOf(
                  result.frames.length,
                  resultSize.width,
                  resultSize.height,
                  result.palette.colors.length,
              )
            : preview.computing || reading
              ? "Computing…"
              : "";
    const status = phase === "importing" ? "Importing…" : summary;

    const colorOptions: SelectOption<string>[] = [
        { value: "keep", label: "Keep" },
        { value: "reduce", label: "Reduce" },
        ...(target ? [{ value: "document", label: "Map to the sprite palette" }] : []),
        ...PRESET_PALETTES.map((preset) => ({
            value: `preset:${preset.id}`,
            label: `Map to ${preset.name}`,
        })),
    ];
    const placeOptions: SegmentedOption<ImportPlace>[] = [
        { value: "new", label: "New sprite" },
        { value: "frames", label: "New frames", disabled: !target },
        { value: "layer", label: "New layer", disabled: !target },
    ];
    const cropOf = (patch: Partial<NonNullable<ImportForm["crop"]>>) => {
        const base = form.crop ?? {
            x: 0,
            y: 0,
            width: first?.pixels.width ?? 1,
            height: first?.pixels.height ?? 1,
        };
        set("crop", { ...base, ...patch });
    };
    const maxX = first ? first.pixels.width : 8192;
    const maxY = first ? first.pixels.height : 8192;

    return (
        <Dialog
            open
            size="large"
            onOpenChange={(open) => {
                // Not while the frames are being placed: they would be placed after all.
                if (!open && phase !== "importing") request.answer(null);
            }}
            title="Import PNG"
            className="import-dialog"
            actions={
                <>
                    <div className="import-dialog__status">
                        <p
                            className="import-dialog__summary"
                            aria-live="polite"
                            data-import-summary=""
                        >
                            {status}
                        </p>
                        {problem ? (
                            <p
                                className="import-dialog__message"
                                role="alert"
                                data-import-message=""
                            >
                                {problem}
                            </p>
                        ) : null}
                        {failure ? (
                            <p
                                className="import-dialog__message"
                                role="alert"
                                data-import-failure=""
                            >
                                Could not import. {failure}
                            </p>
                        ) : null}
                    </div>
                    <Button disabled={phase === "importing"} onClick={() => request.answer(null)}>
                        Cancel
                    </Button>
                    <Button variant="primary" disabled={!canImport} onClick={() => void confirm()}>
                        Import
                    </Button>
                </>
            }
        >
            <div className="import-dialog__panes">
                <div className="import-dialog__source">
                    {first ? (
                        <SourcePane
                            pixels={first.pixels}
                            crop={form.crop}
                            grid={sliced ? gridOf(form) : null}
                            onCrop={(crop) => set("crop", crop)}
                        />
                    ) : (
                        <div className="import-source import-source--empty">
                            {reading ? "Reading…" : "No image"}
                        </div>
                    )}
                    <div className="import-dialog__row">
                        {several ? (
                            <Select
                                label="File"
                                value={String(Math.min(shownSource, sourceCount - 1))}
                                onChange={(value) => setShownSource(Number(value))}
                                options={sources.map((source, index) => ({
                                    value: String(index),
                                    label: source.name,
                                }))}
                            />
                        ) : (
                            <span className="import-dialog__file" data-import-file="">
                                {first
                                    ? `${first.name} · ${first.pixels.width} × ${first.pixels.height}`
                                    : ""}
                            </span>
                        )}
                        <Button onClick={() => request.chooseFiles()}>Choose files…</Button>
                    </div>
                    {errors.length > 0 ? (
                        <div role="alert">
                            <ul className="import-dialog__errors" data-import-file-errors="">
                                {errors.map((line) => (
                                    <li key={line}>{line}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                </div>
                <ResultPane
                    frames={result?.frames ?? null}
                    error={error}
                    computing={preview.computing}
                    zoom={zoom}
                    onZoom={setZoom}
                />
            </div>

            <div className="import-dialog__form">
                <Step label="Region">
                    <Row>
                        <SegmentedControl
                            label="Region"
                            value={form.crop ? "crop" : "whole"}
                            onChange={(value) =>
                                value === "whole" ? set("crop", null) : cropOf({})
                            }
                            options={[
                                { value: "whole", label: "Whole image" },
                                { value: "crop", label: "Crop" },
                            ]}
                        />
                        {form.crop ? (
                            <>
                                <NumberField
                                    label="X"
                                    value={form.crop.x}
                                    onChange={(x) => cropOf({ x })}
                                    min={0}
                                    max={maxX - 1}
                                />
                                <NumberField
                                    label="Y"
                                    value={form.crop.y}
                                    onChange={(y) => cropOf({ y })}
                                    min={0}
                                    max={maxY - 1}
                                />
                                <NumberField
                                    label="W"
                                    value={form.crop.width}
                                    onChange={(width) => cropOf({ width })}
                                    min={1}
                                    max={maxX}
                                />
                                <NumberField
                                    label="H"
                                    value={form.crop.height}
                                    onChange={(height) => cropOf({ height })}
                                    min={1}
                                    max={maxY}
                                />
                            </>
                        ) : null}
                    </Row>
                </Step>
                <Step label="Cells">
                    <Row>
                        {several ? (
                            <span className="import-dialog__note">
                                One frame per file, in name order
                            </span>
                        ) : (
                            <SegmentedControl
                                label="Cells"
                                value={form.cells}
                                onChange={(cells) => set("cells", cells)}
                                options={[
                                    { value: "single", label: "Single sprite" },
                                    { value: "grid", label: "Grid" },
                                ]}
                            />
                        )}
                    </Row>
                    {sliced ? (
                        <>
                            <Row>
                                <SegmentedControl
                                    label="Grid by"
                                    value={form.gridBy}
                                    onChange={(gridBy) => set("gridBy", gridBy)}
                                    options={[
                                        { value: "size", label: "Cell size" },
                                        { value: "count", label: "Columns × rows" },
                                    ]}
                                />
                                {form.gridBy === "size" ? (
                                    <>
                                        <NumberField
                                            label="Cell W"
                                            value={form.cellWidth}
                                            onChange={(value) => set("cellWidth", value)}
                                            min={1}
                                            max={8192}
                                            unit="px"
                                        />
                                        <NumberField
                                            label="Cell H"
                                            value={form.cellHeight}
                                            onChange={(value) => set("cellHeight", value)}
                                            min={1}
                                            max={8192}
                                            unit="px"
                                        />
                                    </>
                                ) : (
                                    <>
                                        <NumberField
                                            label="Columns"
                                            value={form.columns}
                                            onChange={(value) => set("columns", value)}
                                            min={1}
                                            max={1024}
                                        />
                                        <NumberField
                                            label="Rows"
                                            value={form.rows}
                                            onChange={(value) => set("rows", value)}
                                            min={1}
                                            max={1024}
                                        />
                                    </>
                                )}
                            </Row>
                            <Row>
                                <NumberField
                                    label="Offset X"
                                    value={form.offsetX}
                                    onChange={(value) => set("offsetX", value)}
                                    min={0}
                                    max={8191}
                                    unit="px"
                                />
                                <NumberField
                                    label="Offset Y"
                                    value={form.offsetY}
                                    onChange={(value) => set("offsetY", value)}
                                    min={0}
                                    max={8191}
                                    unit="px"
                                />
                                <NumberField
                                    label="Spacing X"
                                    value={form.spacingX}
                                    onChange={(value) => set("spacingX", value)}
                                    min={0}
                                    max={8191}
                                    unit="px"
                                />
                                <NumberField
                                    label="Spacing Y"
                                    value={form.spacingY}
                                    onChange={(value) => set("spacingY", value)}
                                    min={0}
                                    max={8191}
                                    unit="px"
                                />
                                <Toggle
                                    label="Skip empty"
                                    showLabel
                                    pressed={form.skipEmpty}
                                    onPressedChange={(on) => set("skipEmpty", on)}
                                />
                            </Row>
                        </>
                    ) : null}
                </Step>
                <Step label="Size">
                    <Row>
                        <NumberField
                            label="Width"
                            value={form.width}
                            onChange={(width) => set("width", width)}
                            unit="px"
                            {...SIDE}
                        />
                        <NumberField
                            label="Height"
                            value={form.height}
                            onChange={(height) => set("height", height)}
                            unit="px"
                            {...SIDE}
                        />
                        <SegmentedControl
                            label="Fit"
                            value={form.fit}
                            onChange={(fit) => set("fit", fit)}
                            options={FITS}
                        />
                    </Row>
                </Step>
                <Step label="Resample">
                    <Row>
                        <Select
                            label="Resample"
                            hideLabel
                            value={form.resample}
                            onChange={(value) => set("resample", value)}
                            options={RESAMPLES}
                        />
                    </Row>
                </Step>
                <Step label="Alpha">
                    <Row>
                        <SegmentedControl
                            label="Alpha"
                            value={alphaShown}
                            onChange={(alpha) => set("alpha", alpha)}
                            options={[
                                { value: "keep", label: "Keep" },
                                { value: "threshold", label: "Threshold" },
                            ]}
                        />
                        <NumberField
                            label="Threshold"
                            value={thresholdShown}
                            onChange={(threshold) => setMany({ threshold, alpha: "threshold" })}
                            min={1}
                            max={255}
                            disabled={alphaShown !== "threshold"}
                        />
                    </Row>
                    <Row>
                        <Toggle
                            label="Colour key"
                            showLabel
                            pressed={form.colorKey}
                            onPressedChange={(on) => set("colorKey", on)}
                        />
                        <KeyColourField
                            colour={form.keyColor}
                            onChange={(colour) => set("keyColor", colour)}
                            disabled={!form.colorKey}
                        />
                        <NumberField
                            label="Tolerance"
                            value={form.keyTolerance}
                            onChange={(value) => set("keyTolerance", value)}
                            min={0}
                            max={255}
                            disabled={!form.colorKey}
                        />
                    </Row>
                </Step>
                <Step label="Colours">
                    <Row>
                        <Select
                            label="Colours"
                            hideLabel
                            value={colorsShown}
                            onChange={(value) => set("colors", value as ColorsChoice)}
                            options={colorOptions}
                        />
                        {colorsShown === "reduce" ? (
                            <NumberField
                                label="Count"
                                value={form.count}
                                onChange={(count) => setMany({ count, colors: "reduce" })}
                                min={2}
                                max={256}
                            />
                        ) : null}
                        <SegmentedControl
                            label="Dither"
                            value={form.dither}
                            onChange={(dither) => set("dither", dither)}
                            options={DITHERS}
                            disabled={colorsShown === "keep"}
                        />
                    </Row>
                </Step>
                <Step label="Place">
                    <Row>
                        <SegmentedControl
                            label="Place"
                            value={form.place}
                            onChange={(place) => set("place", place)}
                            options={placeOptions}
                        />
                        <Toggle
                            label="Keep source as reference"
                            showLabel
                            pressed={form.keepReference && referenceAvailable}
                            disabled={!referenceAvailable}
                            aria-describedby={notKept ? referenceNoteId : undefined}
                            onPressedChange={(on) => set("keepReference", on)}
                        />
                        {notKept ? (
                            <span
                                className="import-dialog__note"
                                id={referenceNoteId}
                                data-import-reference-note=""
                            >
                                {notKept}
                            </span>
                        ) : null}
                    </Row>
                    <Row>
                        <span className="ui-field">
                            <span className="ui-field__label" aria-hidden="true">
                                Palette
                            </span>
                            <SegmentedControl
                                label="Palette"
                                value={form.paletteMode}
                                onChange={(mode) => set("paletteMode", mode)}
                                options={PALETTE_MODES}
                            />
                        </span>
                    </Row>
                </Step>
            </div>
        </Dialog>
    );
}
