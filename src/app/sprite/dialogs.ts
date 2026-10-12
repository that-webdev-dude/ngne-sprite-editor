import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { MAX_DOCUMENT_SIDE, MIN_DOCUMENT_SIDE } from "../../core/model";
import { isSpriteName } from "../../core/sprite";
import type { GridGeometry, Pivot } from "../../core/sprite";

/**
 * The dialogs of the New Sprite and Sprite Properties commands (DESIGN §7). A command asks for
 * a dialog and waits for the answer; the interface shows the dialog for the open request and
 * answers it. The document is changed by the command, never by the dialog (SPEC §5).
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
     * dialog asks once before it answers with values (DESIGN §7).
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

export type SpriteDialogRequest = NewSpriteRequest | SpritePropertiesRequest;

export interface SpriteDialogState {
    /** The dialog that is open, or null. */
    request: SpriteDialogRequest | null;
}

export interface SpriteDialogs {
    readonly store: StoreApi<SpriteDialogState>;
    /** Opens the New sprite dialog; resolves with the values to create, or null. */
    newSprite(
        options: Pick<NewSpriteRequest, "initial" | "discards">,
    ): Promise<NewSpriteValues | null>;
    /** Opens the Sprite properties dialog; resolves with the values to apply, or null. */
    spriteProperties(
        options: Pick<SpritePropertiesRequest, "initial">,
    ): Promise<SpritePropertiesValues | null>;
}

export function createSpriteDialogs(): SpriteDialogs {
    const store = createStore<SpriteDialogState>(() => ({ request: null }));

    /** One dialog at a time: a request made while another is open is answered with null. */
    function open<Values>(
        build: (answer: (values: Values | null) => void) => SpriteDialogRequest,
    ): Promise<Values | null> {
        if (store.getState().request) return Promise.resolve(null);
        return new Promise((resolve) => {
            const request = build((values) => {
                // Answered already: a second answer changes nothing.
                if (store.getState().request !== request) return;
                store.setState({ request: null });
                resolve(values);
            });
            store.setState({ request });
        });
    }

    return {
        store,
        newSprite: (options) =>
            open<NewSpriteValues>((answer) => ({ kind: "new-sprite", ...options, answer })),
        spriteProperties: (options) =>
            open<SpritePropertiesValues>((answer) => ({
                kind: "sprite-properties",
                ...options,
                answer,
            })),
    };
}

/** The sprite dialogs of the app. */
export const spriteDialogs = createSpriteDialogs();

/** The open dialog request, or null; the component renders again when it changes. */
export function useSpriteDialogRequest(): SpriteDialogRequest | null {
    return useStore(spriteDialogs.store, (state) => state.request);
}

/** What keeps the New sprite dialog from creating a document; all false when it can. */
export interface NewSpriteProblems {
    name: boolean;
    width: boolean;
    height: boolean;
    /** One line for the dialog, or null when there is no problem. */
    message: string | null;
}

function isDocumentSide(value: number): boolean {
    return Number.isInteger(value) && value >= MIN_DOCUMENT_SIDE && value <= MAX_DOCUMENT_SIDE;
}

/** Checks the values of the New sprite dialog against SPEC §5.1: each side an integer 1..1024. */
export function newSpriteProblems(values: NewSpriteValues): NewSpriteProblems {
    const name = !isSpriteName(values.name);
    const width = !isDocumentSide(values.width);
    const height = !isDocumentSide(values.height);
    const range = `from ${MIN_DOCUMENT_SIDE} to ${MAX_DOCUMENT_SIDE} px`;
    const message =
        width && height
            ? `Width and height must each be ${range}.`
            : width
              ? `Width must be ${range}.`
              : height
                ? `Height must be ${range}.`
                : name
                  ? "Enter a name."
                  : null;
    return { name, width, height, message };
}
