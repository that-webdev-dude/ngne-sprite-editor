import { useEffect, useId, useMemo } from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import type { ExportDialogRequest } from "../../app/export/dialogs";
import { previewOf } from "../../app/export/exportPreview";
import { useSessions } from "../../app/state/sessions";
import { MAX_ATLAS_EXTRUDE, MAX_ATLAS_PADDING } from "../../core/export/packErrors";
import type { ExportSettings } from "../../core/model";
import type { Pivot } from "../../core/sprite";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";
import type { SegmentedOption } from "../primitives/SegmentedControl";
import { Select } from "../primitives/Select";
import type { SelectOption } from "../primitives/Select";
import { Toggle } from "../primitives/Toggle";
import { PivotGrid } from "../sprite/PivotGrid";
import { AtlasThumbnail } from "./AtlasThumbnail";
import "../primitives/field.css";
import "./export.css";

const LAYOUTS: readonly SegmentedOption<ExportSettings["layout"]>[] = [
    { value: "grid", label: "Grid" },
    { value: "row", label: "Row" },
    { value: "column", label: "Column" },
];
const ASEPRITE_FORMS: readonly SegmentedOption<ExportSettings["files"]["asepriteJson"]>[] = [
    { value: "none", label: "None" },
    { value: "array", label: "Array" },
    { value: "hash", label: "Hash" },
];
/** As in Sprite properties: hundredths by arrow key, four decimals typed (SE-034). */
const PIVOT_RANGE = { min: 0, max: 1, step: 0.01, precision: 4 };
/** The value of the Frames select for "all frames"; a tag is `tag:<id>`. */
const ALL_FRAMES = "all";

/** "512 B", "1.2 KB", "3.4 MB". */
export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One setting: its name in the label column, its controls as a named group. */
function Section({ label, children }: { label: string; children: ReactNode }) {
    const labelId = useId();
    return (
        <>
            <span className="ui-field__label export-dialog__label" id={labelId}>
                {label}
            </span>
            <div className="export-dialog__group" role="group" aria-labelledby={labelId}>
                {children}
            </div>
        </>
    );
}

/** A segmented control with its name before it, as the fields show theirs. */
function Segments<Value extends string>(props: {
    label: string;
    value: Value;
    onChange(value: NoInfer<Value>): void;
    options: readonly SegmentedOption<Value>[];
}) {
    return (
        <span className="ui-field">
            <span className="ui-field__label" aria-hidden="true">
                {props.label}
            </span>
            <SegmentedControl {...props} />
        </span>
    );
}

/** A list of IDs under a heading. */
function IdList({ label, ids }: { label: string; ids: readonly string[] }) {
    const labelId = useId();
    return (
        <div className="export-dialog__ids">
            <span className="ui-field__label" id={labelId}>
                {label} ({ids.length})
            </span>
            <ul aria-labelledby={labelId} className="export-dialog__list">
                {ids.map((id) => (
                    <li key={id}>{id}</li>
                ))}
            </ul>
        </div>
    );
}

/**
 * The Export dialog (DESIGN §7; SE-052): the bundle options of SPEC §9.4, the optional files,
 * the frames (all or one tag), the pivot, where the bundle goes and "Export on save" on the
 * left; on the right the result of these settings, made as the export makes it: the atlas
 * with its rectangles, the files with their sizes, the frame and animation IDs, warnings, or
 * the message of the error that keeps the document from being exported. A change applies at
 * once (the settings are saved with the document; the pivot is an undo step); Close keeps
 * them, Export writes the bundle.
 */
export function ExportDialog({ request }: { request: ExportDialogRequest }) {
    const document = useSessions(
        (state) => state.documents.find((entry) => entry.id === request.documentId) ?? null,
    );
    const destination = useStore(request.destination);
    const preview = useMemo(() => (document ? previewOf(document) : null), [document]);
    const filesId = useId();

    // The document was closed under the dialog: nothing is left to export.
    useEffect(() => {
        if (!document) request.answer(null);
    }, [document, request]);
    if (!document || !preview) return null;

    const { doc } = document.session;
    const settings = doc.exportSettings;
    const set = (update: (settings: ExportSettings) => void) => request.setSettings(update);
    const setPivot = (patch: Partial<Pivot>) => request.setPivot({ ...doc.pivot, ...patch });

    const frameOptions: SelectOption<string>[] = [
        { value: ALL_FRAMES, label: "All frames" },
        ...doc.tags.map((tag) => {
            const from = doc.frames.findIndex((frame) => frame.id === tag.fromFrameId) + 1;
            const to = doc.frames.findIndex((frame) => frame.id === tag.toFrameId) + 1;
            return { value: `tag:${tag.id}`, label: `${tag.name} (${from}–${to})` };
        }),
    ];
    const frames = settings.frames === "all" ? ALL_FRAMES : `tag:${settings.frames.tagId}`;
    const choosing = destination.choosing;

    return (
        <Dialog
            open
            size="large"
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Export"
            className="export-dialog"
            actions={
                <>
                    <Button onClick={() => request.answer(null)}>Close</Button>
                    <Button
                        variant="primary"
                        disabled={preview.error !== null || choosing}
                        onClick={() => request.answer(true)}
                    >
                        Export
                    </Button>
                </>
            }
        >
            <div className="export-dialog__columns">
                <div className="export-dialog__form">
                    <Section label="Frames">
                        <Select
                            label="Frames"
                            hideLabel
                            value={frames}
                            onChange={(value) =>
                                set((target) => {
                                    target.frames =
                                        value === ALL_FRAMES
                                            ? "all"
                                            : { tagId: value.slice("tag:".length) };
                                })
                            }
                            options={frameOptions}
                        />
                    </Section>
                    <Section label="Atlas">
                        <div className="export-dialog__row">
                            <Segments
                                label="Layout"
                                value={settings.layout}
                                onChange={(layout) =>
                                    set((target) => void (target.layout = layout))
                                }
                                options={LAYOUTS}
                            />
                        </div>
                        <div className="export-dialog__row">
                            <NumberField
                                label="Padding"
                                value={settings.padding}
                                onChange={(padding) =>
                                    set((target) => void (target.padding = padding))
                                }
                                unit="px"
                                min={0}
                                max={MAX_ATLAS_PADDING}
                            />
                            <NumberField
                                label="Extrude"
                                value={settings.extrude}
                                onChange={(extrude) =>
                                    set((target) => void (target.extrude = extrude))
                                }
                                unit="px"
                                min={0}
                                max={MAX_ATLAS_EXTRUDE}
                            />
                        </div>
                        <div className="export-dialog__row">
                            <Toggle
                                label="Trim"
                                showLabel
                                pressed={settings.trim}
                                onPressedChange={(trim) =>
                                    set((target) => void (target.trim = trim))
                                }
                            />
                            <Toggle
                                label="Merge identical frames"
                                showLabel
                                pressed={settings.mergeDuplicates}
                                onPressedChange={(merge) =>
                                    set((target) => void (target.mergeDuplicates = merge))
                                }
                            />
                        </div>
                    </Section>
                    <Section label="Pivot">
                        <div className="export-dialog__row">
                            <PivotGrid
                                label="Pivot presets"
                                value={doc.pivot}
                                onChange={(pivot) => request.setPivot(pivot)}
                            />
                            <NumberField
                                label="X"
                                value={doc.pivot.x}
                                onChange={(x) => setPivot({ x })}
                                {...PIVOT_RANGE}
                            />
                            <NumberField
                                label="Y"
                                value={doc.pivot.y}
                                onChange={(y) => setPivot({ y })}
                                {...PIVOT_RANGE}
                            />
                        </div>
                    </Section>
                    <Section label="Files">
                        <div className="export-dialog__row">
                            <Toggle
                                label={`${preview.name}.sprites.ts`}
                                showLabel
                                pressed={settings.files.spritesTs}
                                onPressedChange={(on) =>
                                    set((target) => void (target.files.spritesTs = on))
                                }
                            />
                            <Toggle
                                label={`${preview.name}.preview.config.mjs`}
                                showLabel
                                pressed={settings.files.previewConfig}
                                onPressedChange={(on) =>
                                    set((target) => void (target.files.previewConfig = on))
                                }
                            />
                        </div>
                        <div className="export-dialog__row">
                            <Segments
                                label="Aseprite JSON"
                                value={settings.files.asepriteJson}
                                onChange={(form) =>
                                    set((target) => void (target.files.asepriteJson = form))
                                }
                                options={ASEPRITE_FORMS}
                            />
                        </div>
                    </Section>
                    <Section label="Destination">
                        {destination.mode === "folder" ? (
                            <div className="export-dialog__row">
                                <span className="export-dialog__destination" data-export-folder="">
                                    {destination.folder ?? "No folder chosen"}
                                </span>
                                <Button disabled={choosing} onClick={() => request.chooseFolder()}>
                                    Choose folder…
                                </Button>
                            </div>
                        ) : (
                            <span className="export-dialog__destination" data-export-folder="">
                                Download {preview.name}.zip
                            </span>
                        )}
                        <div className="export-dialog__row">
                            <Toggle
                                label="Export on save"
                                showLabel
                                pressed={settings.exportOnSave}
                                onPressedChange={(on) =>
                                    set((target) => void (target.exportOnSave = on))
                                }
                            />
                        </div>
                    </Section>
                </div>

                <div className="export-dialog__result" aria-live="polite">
                    {preview.bundle ? (
                        <>
                            <AtlasThumbnail
                                atlas={preview.bundle.atlas}
                                meta={preview.bundle.meta}
                            />
                            <div className="export-dialog__files">
                                <span className="ui-field__label" id={filesId}>
                                    Files
                                </span>
                                <ul
                                    aria-labelledby={filesId}
                                    className="export-dialog__list"
                                    data-export-files=""
                                >
                                    {preview.files.map((file) => (
                                        <li key={file.name}>
                                            <span>{file.name}</span>
                                            <span className="export-dialog__size">
                                                {formatSize(file.size)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <IdList label="Frame IDs" ids={preview.frameIds} />
                            <IdList label="Animation IDs" ids={preview.animationIds} />
                            {preview.warnings.length > 0 ? (
                                <ul className="export-dialog__warnings" data-export-warnings="">
                                    {preview.warnings.map((warning) => (
                                        <li key={warning}>{warning}</li>
                                    ))}
                                </ul>
                            ) : null}
                        </>
                    ) : (
                        <p className="export-dialog__error" role="alert" data-export-error="">
                            {preview.error}
                        </p>
                    )}
                </div>
            </div>
        </Dialog>
    );
}
