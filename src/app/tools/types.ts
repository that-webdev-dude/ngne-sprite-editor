import type { LucideIcon } from "lucide-react";
import type { History } from "../../core/history";
import type { DocSession, PixelBuffer, Rect } from "../../core/model";
import type { OpenDocument } from "../state/sessions";
import type { Point } from "../view/coordinates";

// The tools of the editor (SPEC §7.1, SE-014): what a feature implements to add one. A tool is
// a `ToolSpec` exported from a module of its own named `*.tools.ts`; `toolRegistry.ts` explains
// how it is found. The pointer pipeline (`pipeline.ts`) calls the active tool's handlers with
// pointer samples in document coordinates and, for a tool that paints, an open transaction.

/** The buttons a tool tells apart: the left one paints the foreground, the right one the background (SPEC §7.1). */
export type ToolButton = "primary" | "secondary";

/** Modifier keys held at a pointer sample or a key event. */
export interface ToolModifiers {
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
    meta: boolean;
}

/** One position of the pointer during a stroke, as a tool receives it. */
export interface ToolPointer {
    /** Client position, CSS pixels, as the pointer event reported it. */
    readonly client: Point;
    /**
     * Position in the pixels of the canvas on screen, with its fraction: the space of the
     * view's origin and of the anchors of `zoomBy`. While NGNE stretches its old canvas after
     * a resize, those are the old canvas's pixels (SPEC §6.3).
     */
    readonly device: Point;
    /**
     * The document pixel shown under the pointer: whole numbers, also outside the document
     * (negative, or beyond its size). During NGNE's resize quiet it is the texel on screen
     * under the pointer, the one the overlay's cursor names (SE-014).
     */
    readonly pixel: Point;
    /** The document position, with its fraction inside the pixel. */
    readonly position: Point;
    /** Whether `pixel` lies inside the document. */
    readonly inside: boolean;
    /** The button that began the stroke. */
    readonly button: ToolButton;
    readonly modifiers: Readonly<ToolModifiers>;
    /** Time stamp of the event, in milliseconds. */
    readonly time: number;
}

/** A key going down or up while a stroke is in progress (`ToolSpec.onKey`). */
export interface ToolKey {
    readonly type: "down" | "up";
    /** The key as chords name it: "Shift", "Alt", "Enter", "B" (`commands/chord.ts`). */
    readonly key: string;
    /** The modifiers held after the event. */
    readonly modifiers: Readonly<ToolModifiers>;
    /** A key-down repeated by the keyboard. */
    readonly repeat: boolean;
}

/**
 * The target and the pixels of a painting stroke: one transaction of the document's history
 * (SPEC §5.2), opened by the pipeline before `onDown` and committed after `onUp` as one undo
 * step labelled with the tool's name, or aborted by Escape or a pointer cancel.
 */
export interface PaintStroke {
    readonly layerId: string;
    readonly frameId: string;
    /**
     * The cel's image (created transparent when the cel was empty). The tool writes into
     * `image.data` (straight RGBA8, the document's size) and reports each write with
     * `markDirty`.
     */
    readonly image: PixelBuffer;
    /**
     * Reports pixels written inside `rect` (integers; clipped to the canvas): they become part
     * of the undo step and appear in the viewport, composited and uploaded at most once per
     * animation frame. A write that is not reported is neither.
     */
    markDirty(rect: Rect): void;
}

/** What a tool works with during one stroke, from its pointer down to its end. */
export interface ToolContext {
    /** The active document as it was at the pointer down. */
    readonly document: OpenDocument;
    readonly session: DocSession;
    readonly history: History;
    /** The button that began the stroke. */
    readonly button: ToolButton;
    /**
     * The colour of that button, 0xRRGGBBAA: the foreground for the left button, the
     * background for the right one (SPEC §7.1).
     */
    readonly colour: number;
    /** The tool's option values: each option's default, or the value the user set. */
    readonly options: Readonly<Record<string, ToolOptionValue>>;
    /** For a tool that paints (`ToolSpec.paints`): the stroke's pixels; null otherwise. */
    readonly paint: PaintStroke | null;
    /** Shows transient tool feedback in the status bar (DESIGN §4, message channels). */
    feedback(message: string): void;
    /**
     * Makes this stroke a gesture of several presses (SE-031; SPEC §7.8, the `gesture`
     * context): it does not end at the release but takes the next presses too, each with
     * `onDown`, its moves and `onUp`, and the moves between them (`onHover`), until it is
     * closed — Enter, or a double click: `onClose`, then it is kept as at a release — or
     * cancelled: Escape, a pointer cancel during a press, a change of the active tool or of
     * the document (`onCancel`). Called from a handler of the stroke; after the stroke ended
     * it does nothing.
     */
    openGesture(): void;
    /**
     * Closes this stroke's open gesture as Enter does (SE-065: the curve, after its last
     * point): `onClose`, then it is kept as at a release. Called from a handler of the stroke;
     * when no gesture of the stroke is open it does nothing. Called from `onDown`, the press
     * ends with the gesture: its release finds no stroke.
     */
    closeGesture(): void;
}

/** What a tool's cursor depends on (`ToolSpec.cursor`). */
export interface ToolCursorState {
    /** The modifier keys held. */
    readonly modifiers: Readonly<ToolModifiers>;
    /** A stroke of this tool is in progress. */
    readonly pressed: boolean;
    /**
     * The pointer is over the document (DESIGN §6: a paint tool that draws a brush outline
     * hides the system cursor there and shows the outline instead).
     */
    readonly overDocument: boolean;
}

export type ToolOptionValue = number | boolean | string;

interface ToolOptionBase {
    /** The option's name in the tool's options: "size". */
    key: string;
    /** Label in the context bar: "Size". */
    label: string;
}

/** A number, shown as a number field (DESIGN §4). */
export interface NumberToolOption extends ToolOptionBase {
    kind: "number";
    min: number;
    max: number;
    /** Step of the arrow keys and the grid values snap to; the default is 1. */
    step?: number;
    /** Unit shown after the value: "px", "%". */
    unit?: string;
    default: number;
}

/** On or off, shown as a toggle with its label (DESIGN §4). */
export interface ToggleToolOption extends ToolOptionBase {
    kind: "toggle";
    default: boolean;
}

/** One of a few values, shown as a segmented control, or as a select with `display`. */
export interface ChoiceToolOption extends ToolOptionBase {
    kind: "choice";
    choices: readonly { value: string; label: string }[];
    default: string;
    /** The default is "segmented". */
    display?: "segmented" | "select";
}

/**
 * One option of a tool. The context bar shows the options of the active tool in the order
 * the tool lists them (DESIGN §5.2: size · shape · mode toggles · tolerance · ink · opacity).
 */
export type ToolOptionSpec = NumberToolOption | ToggleToolOption | ChoiceToolOption;

/**
 * A key that makes a tool the active one while it is held (SPEC §7.8: Space, Alt). It acts in
 * the `canvas` context; a key that controls consume natively (Space) only while the viewport
 * element itself has the focus (`tools.commands.ts`).
 */
export interface ToolHold {
    /** The chord of the held key: "Space", "Alt". Bound in the `canvas` context. */
    key: string;
    /**
     * Whether holding the key takes this tool now, given the tool the user selected (null
     * when that tool is not registered). The default is always: Space takes the hand from any
     * tool, Alt the eyedropper only from a paint tool.
     */
    when?(selected: Tool | null): boolean;
}

/**
 * A tool, as its module declares it. Every handler is optional. For one pointer down the
 * pipeline calls `onDown`, `onMove` for every sample (coalesced events included; the last of
 * each event's for a tool with `latestSample`), and then
 * exactly one of `onUp` or `onCancel`; strokes never overlap. A gesture
 * (`ToolContext.openGesture`) repeats that for each of its presses, with `onHover` between
 * them, and ends with `onClose` or `onCancel`.
 */
export interface ToolSpec {
    /** Stable and unique: "pencil". The id of a planned rail slot takes that slot. */
    id: string;
    /** Name in the rail's tooltip, the context bar and the undo step: "Pencil". */
    label: string;
    /** Rail icon; a planned slot supplies one when the tool does not. */
    icon?: LucideIcon;
    /** Key that selects the tool, bound in the `canvas` context (SPEC §7.8): "B". */
    shortcut?: string;
    /**
     * Position in the tool rail, ascending; tools whose positions differ in the hundreds are
     * in different groups (DESIGN §5.1: 100 draw, 200 shapes, 300 select, 400 navigate). A
     * tool without one takes the position of the planned slot of its id, or is not in the rail.
     * For a variant (`variantOf`) it orders the variants of its slot.
     */
    railOrder?: number;
    /**
     * The rail slot this tool shares as a variant (DESIGN §5.1, SE-031): the id of the slot's
     * own tool or planned slot, for example "marquee" for the elliptical marquee. The slot's
     * button shows the variant selected last, with a corner mark; holding it opens the menu
     * of its variants, and a tool key pressed while a tool of the slot is selected selects the
     * slot's next variant. The variant has no slot of its own.
     */
    variantOf?: string;
    /** One-line hint for the tool's modifiers, shown in the status bar while it is active. */
    hint?: string;
    /** The options the context bar shows while the tool is active. */
    options?: readonly ToolOptionSpec[];
    /**
     * The tool writes pixels: the pipeline resolves the paint target before `onDown` (the
     * active layer must be a visible, unlocked pixel layer, at a zoom of 1× or more) and
     * opens the stroke's transaction (`ToolContext.paint`). When the target is refused the
     * status bar says why and no handler is called.
     */
    paints?: boolean;
    /** A key that makes this tool the active one while it is held. */
    hold?: ToolHold;
    /** CSS cursor over the viewport while the tool is active; the default is "default". */
    cursor?: string | ((state: ToolCursorState) => string);
    /**
     * The tool follows where the pointer is, not the path it took (the Move tool, SE-032
     * review): of the coalesced samples of one pointer event `onMove` receives only the last.
     * A sample whose buttons no longer hold the stroke's still ends the stroke where it is.
     */
    latestSample?: boolean;
    onDown?(context: ToolContext, pointer: ToolPointer): void;
    onMove?(context: ToolContext, pointer: ToolPointer): void;
    /**
     * The button was released: the stroke ends, and a paint stroke is committed after this;
     * a gesture (`ToolContext.openGesture`) stays open for its next press.
     */
    onUp?(context: ToolContext, pointer: ToolPointer): void;
    /**
     * The pointer moved over the viewport with no button held, between the presses of this
     * tool's open gesture: once per pointer event, at the last of its coalesced samples (only
     * where the pointer is now matters between presses; SE-065 review).
     */
    onHover?(context: ToolContext, pointer: ToolPointer): void;
    /**
     * The open gesture was closed: Enter (SPEC §7.8, `gesture`) or a double click. The stroke
     * is kept after this, as at a release: committed, then `onCommit`.
     */
    onClose?(context: ToolContext): void;
    /**
     * The stroke was cancelled (Escape, a pointer cancel, the document closed; for a gesture
     * also a change of the active tool): a paint stroke's pixels are put back after this.
     */
    onCancel?(context: ToolContext): void;
    /**
     * A key went down or up while a stroke of this tool is in progress. Returns true when the
     * tool used it: the key's default is prevented and no shortcut acts on it. Escape is never
     * passed here; it cancels the stroke.
     */
    onKey?(context: ToolContext, key: ToolKey): boolean;
    /**
     * The stroke ended at its release (`onUp`) and was kept: for a tool that paints, after
     * its transaction was committed, `recorded` when that made a history entry and false
     * when the stroke changed nothing. Not called when the stroke was cancelled, nor when its
     * pixels were taken back because they could not be committed (SE-015).
     */
    onCommit?(context: ToolContext, recorded: boolean): void;
}

/** A registered tool: its spec, with what its planned slot supplies. */
export interface Tool extends ToolSpec {
    /** The module that registered it; used in error messages. */
    readonly source: string;
    readonly options: readonly ToolOptionSpec[];
    /** Its position in the rail, or null when it is not in the rail. */
    readonly railOrder: number | undefined;
}

/**
 * A slot of the tool rail for a tool a later ticket implements (DESIGN §5.1): shown disabled
 * until a tool with the same id is registered, which then takes it over.
 */
export interface PlannedToolSpec {
    id: string;
    label: string;
    shortcut?: string;
    icon: LucideIcon;
    railOrder: number;
}

/** What a `*.tools.ts` module exports (at least one of the two). */
export interface ToolModule {
    tools?: readonly ToolSpec[];
    plannedTools?: readonly PlannedToolSpec[];
}

/** One button of the tool rail: a registered tool, or the planned slot of one. */
export interface RailSlot {
    readonly id: string;
    readonly label: string;
    readonly shortcut: string | undefined;
    readonly icon: LucideIcon | undefined;
    readonly railOrder: number;
    /**
     * The tool of the slot's id, or the first of its variants when there is none; null while
     * the slot is planned only.
     */
    readonly tool: Tool | null;
    /**
     * Every tool of the slot (DESIGN §5.1, SE-031): the tool of its id first, then the tools
     * that name it in `variantOf`, by their `railOrder` and then their id. More than one means
     * the button switches between them.
     */
    readonly variants: readonly Tool[];
}
