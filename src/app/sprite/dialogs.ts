import { MAX_DOCUMENT_SIDE, MIN_DOCUMENT_SIDE } from "../../core/model";
import { isSpriteName } from "../../core/sprite";
import type { CanvasAnchor, GridGeometry, Pivot, SpriteSizeMethod } from "../../core/sprite";
import { commandDialogs, createDialogRequests, dialogView } from "../dialogs/dialogRequests";
import type {
    DialogRequestBase,
    DialogRequests,
    DialogState,
    DialogView,
} from "../dialogs/dialogRequests";

/**
 * The dialogs of the sprite commands (DESIGN §7): New sprite, Sprite properties, Canvas size
 * and Sprite size. A command asks for a dialog and waits for the answer; the dialog host shows
 * the dialog for the open request and answers it (app/dialogs/dialogRequests.ts). The
 * document is changed by the command, never by the dialog (SPEC §5).
 */

/** Square sizes the New sprite dialog offers as presets (DESIGN §7), in pixels. */
export const NEW_SPRITE_SIZE_PRESETS: readonly number[] = [16, 32, 48, 64, 128];

/** What the New sprite dialog edits. */
export interface NewSpriteValues {
    name: string;
    width: number;
    height: number;
}

/** What the Sprite properties dialog edits. */
export interface SpritePropertiesValues {
    name: string;
    pivot: Pivot;
    grid: GridGeometry;
}

export interface NewSpriteRequest {
    kind: "new-sprite";
    initial: NewSpriteValues;
    /**
     * Name of the open document whose unsaved changes the new sprite replaces, or null. The
     * dialog asks once before it answers with values (DESIGN §7). New Sprite passes null
     * since documents have tabs (SE-047): a new sprite replaces nothing.
     */
    discards: string | null;
    /** Create with these values, or null to cancel. Closes the dialog. */
    answer(values: NewSpriteValues | null): void;
}

export interface SpritePropertiesRequest {
    kind: "sprite-properties";
    initial: SpritePropertiesValues;
    /** Apply these values, or null to cancel. Closes the dialog. */
    answer(values: SpritePropertiesValues | null): void;
}

/** What the Canvas size dialog edits. */
export interface CanvasSizeValues {
    width: number;
    height: number;
    /** Where the old canvas sits in the new one (`canvasSizeCommand`). */
    anchor: CanvasAnchor;
}

export interface CanvasSizeRequest {
    kind: "canvas-size";
    /** The values the dialog opens with: the size of the document, anchored at the centre. */
    initial: CanvasSizeValues;
    /** Resize with these values, or null to cancel. Closes the dialog. */
    answer(values: CanvasSizeValues | null): void;
}

/** What the Sprite size dialog edits. */
export interface SpriteSizeValues {
    width: number;
    height: number;
    method: SpriteSizeMethod;
}

export interface SpriteSizeRequest {
    kind: "sprite-size";
    /** The values the dialog opens with: the size of the document. */
    initial: SpriteSizeValues;
    /** Resample with these values, or null to cancel. Closes the dialog. */
    answer(values: SpriteSizeValues | null): void;
}

export type SpriteDialogRequest =
    NewSpriteRequest | SpritePropertiesRequest | CanvasSizeRequest | SpriteSizeRequest;

export type SpriteDialogState = DialogState<SpriteDialogRequest>;

const SPRITE_DIALOG_KINDS: ReadonlySet<string> = new Set<SpriteDialogRequest["kind"]>([
    "new-sprite",
    "sprite-properties",
    "canvas-size",
    "sprite-size",
]);

/** Whether a request of the shared store is one of the sprite dialogs, by its kind. */
export function isSpriteDialogRequest(request: DialogRequestBase): request is SpriteDialogRequest {
    return SPRITE_DIALOG_KINDS.has(request.kind);
}

export interface SpriteDialogs {
    /** The open request when it is a sprite dialog (`isSpriteDialogRequest`), otherwise null. */
    readonly store: DialogView<SpriteDialogRequest>;
    /**
     * Attaches a host (`DialogRequests.attachHost`): until one is, every request is answered
     * with null at once. Returns the function that detaches it.
     */
    attachHost(): () => void;
    /** Opens the New sprite dialog; resolves with the values to create, or null. */
    newSprite(
        options: Pick<NewSpriteRequest, "initial" | "discards">,
    ): Promise<NewSpriteValues | null>;
    /** Opens the Sprite properties dialog; resolves with the values to apply, or null. */
    spriteProperties(
        options: Pick<SpritePropertiesRequest, "initial">,
    ): Promise<SpritePropertiesValues | null>;
    /** Opens the Canvas size dialog; resolves with the values to apply, or null. */
    canvasSize(options: Pick<CanvasSizeRequest, "initial">): Promise<CanvasSizeValues | null>;
    /** Opens the Sprite size dialog; resolves with the values to apply, or null. */
    spriteSize(options: Pick<SpriteSizeRequest, "initial">): Promise<SpriteSizeValues | null>;
}

/**
 * The sprite dialogs over `requests`: by default requests of their own, which a test attaches
 * a host to; the app's go through `commandDialogs`, which the app's dialog host shows.
 */
export function createSpriteDialogs(
    requests: DialogRequests = createDialogRequests(),
): SpriteDialogs {
    return {
        store: dialogView(requests.store, isSpriteDialogRequest),
        attachHost: () => requests.attachHost(),
        newSprite: (options) =>
            requests.open<NewSpriteValues>((answer): NewSpriteRequest => ({
                kind: "new-sprite",
                ...options,
                answer,
            })),
        spriteProperties: (options) =>
            requests.open<SpritePropertiesValues>((answer): SpritePropertiesRequest => ({
                kind: "sprite-properties",
                ...options,
                answer,
            })),
        canvasSize: (options) =>
            requests.open<CanvasSizeValues>((answer): CanvasSizeRequest => ({
                kind: "canvas-size",
                ...options,
                answer,
            })),
        spriteSize: (options) =>
            requests.open<SpriteSizeValues>((answer): SpriteSizeRequest => ({
                kind: "sprite-size",
                ...options,
                answer,
            })),
    };
}

/**
 * The sprite dialogs of the app, through the app's dialog requests (`commandDialogs`), which
 * the app's one dialog host shows. Their store is a view of the shared one that shows the
 * sprite kinds only.
 */
export const spriteDialogs = createSpriteDialogs(commandDialogs);

/** What keeps a size from being a document's size; all false when it can be. */
export interface SizeProblems {
    width: boolean;
    height: boolean;
    /** One line for the dialog, or null when there is no problem. */
    message: string | null;
}

function isDocumentSide(value: number): boolean {
    return Number.isInteger(value) && value >= MIN_DOCUMENT_SIDE && value <= MAX_DOCUMENT_SIDE;
}

/** Checks a size against SPEC §5.1: each side an integer 1..1024. */
export function sizeProblems(size: { width: number; height: number }): SizeProblems {
    const width = !isDocumentSide(size.width);
    const height = !isDocumentSide(size.height);
    const range = `from ${MIN_DOCUMENT_SIDE} to ${MAX_DOCUMENT_SIDE} px`;
    const message =
        width && height
            ? `Width and height must each be ${range}.`
            : width
              ? `Width must be ${range}.`
              : height
                ? `Height must be ${range}.`
                : null;
    return { width, height, message };
}

/** What keeps the New sprite dialog from creating a document; all false when it can. */
export interface NewSpriteProblems extends SizeProblems {
    name: boolean;
}

/** Checks the values of the New sprite dialog against SPEC §5.1: each side an integer 1..1024. */
export function newSpriteProblems(values: NewSpriteValues): NewSpriteProblems {
    const name = !isSpriteName(values.name);
    const size = sizeProblems(values);
    return { ...size, name, message: size.message ?? (name ? "Enter a name." : null) };
}
