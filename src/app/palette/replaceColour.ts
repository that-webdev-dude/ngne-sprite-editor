import type { StoreApi } from "zustand/vanilla";
import { formatHex } from "../../core/color";
import { replaceColourCommand } from "../../core/palettes";
import type { ReplaceRefusal, ReplaceScope } from "../../core/palettes";
import { commandDialogs, createDialogRequests, dialogView } from "../dialogs/dialogRequests";
import type { DialogRequestBase, DialogRequests, DialogView } from "../dialogs/dialogRequests";
import { notices as appNotices } from "../notices/notices";
import type { Notices } from "../notices/notices";
import { applyFloating as applyAppFloating } from "../selection/floating";
import { editorStore } from "../state/editor";
import type { EditorState } from "../state/editor";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument, SessionsState } from "../state/sessions";
import { PAINT_REFUSED } from "../tools/paintTarget";

// Replace Colour… (DESIGN §7; SPEC §7.1, Replace colour; SE-066): the dialog asks for the
// colour to replace (the foreground at first), the colour to put in its place (the
// background), the tolerance and the scope (the selection, the active cel, the active frame,
// the sprite); `core/palettes` makes the change, one undo step. The command applies a
// floating selection first, as the palette's other commands do, and never runs during a
// stroke (SPEC §5.2). The tolerance and the scope chosen last are offered again; "Selection"
// is offered first whenever there is a selection, and when there is none the cel replaces it.
// A result is one toast: how many pixels changed, that none matched, or why it was refused.

export interface ReplaceColourValues {
    /** The colour to replace, 0xRRGGBBAA. */
    from: number;
    /** The colour put in its place, 0xRRGGBBAA. */
    to: number;
    /** 0–255. */
    tolerance: number;
    scope: ReplaceScope;
}

export interface ReplaceColourRequest {
    kind: "replace-colour";
    /** The values the dialog opens with. */
    initial: ReplaceColourValues;
    /** Whether the document has a selection: the scope "selection" is offered only then. */
    hasSelection: boolean;
    /** The values to replace with, or null to cancel. */
    answer(values: ReplaceColourValues | null): void;
}

function isReplaceColourRequest(request: DialogRequestBase): request is ReplaceColourRequest {
    return request.kind === "replace-colour";
}

export interface ReplaceColourDialogs {
    /** The open request when it is the Replace colour dialog, otherwise null. */
    readonly store: DialogView<ReplaceColourRequest>;
    /** Attaches a host; until one is, every request is answered with null at once. */
    attachHost(): () => void;
    /** Shows the dialog; resolves with the values, or null when cancelled. */
    ask(
        options: Omit<ReplaceColourRequest, "kind" | "answer">,
    ): Promise<ReplaceColourValues | null>;
}

/** The dialog over `requests`: by default requests of its own, for a test to host. */
export function createReplaceColourDialogs(
    requests: DialogRequests = createDialogRequests(),
): ReplaceColourDialogs {
    return {
        store: dialogView(requests.store, isReplaceColourRequest),
        attachHost: () => requests.attachHost(),
        ask: (options) =>
            requests.open<ReplaceColourValues>((answer): ReplaceColourRequest => ({
                kind: "replace-colour",
                ...options,
                answer,
            })),
    };
}

/** The Replace colour dialog of the app, shown by the app's one dialog host. */
export const replaceColourDialogs = createReplaceColourDialogs(commandDialogs);

/** What a refusal says, as the paint tools say it (SPEC §7.1). */
export const REPLACE_REFUSED: Readonly<Record<ReplaceRefusal, string>> = {
    "no-selection": "Nothing is selected",
    missing: PAINT_REFUSED.missing,
    reference: PAINT_REFUSED.reference,
    hidden: PAINT_REFUSED.hidden,
    locked: PAINT_REFUSED.locked,
};

const SCOPE_NAMES: Readonly<Record<ReplaceScope, string>> = {
    selection: "the selection",
    cel: "the cel",
    frame: "the frame",
    sprite: "the sprite",
};

export interface ReplaceColourOptions {
    sessions?: StoreApi<SessionsState>;
    editor?: Pick<StoreApi<EditorState>, "getState">;
    dialogs?: Pick<ReplaceColourDialogs, "ask">;
    notices?: Pick<Notices, "info" | "error">;
    /** Applies the floating selection; throws when it cannot. The default is the app's. */
    applyFloating?(): void;
}

export interface ReplaceColour {
    /** Shows the dialog for the active document and replaces as it answers. */
    run(): Promise<boolean>;
}

function reason(error: unknown): string {
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

export function createReplaceColour(options: ReplaceColourOptions = {}): ReplaceColour {
    const sessions = options.sessions ?? sessionsStore;
    const editor = options.editor ?? editorStore;
    const dialogs = options.dialogs ?? replaceColourDialogs;
    const notices = options.notices ?? appNotices;
    const applyFloating = options.applyFloating ?? (() => applyAppFloating());
    /** What the dialog was answered with last: its tolerance and scope are offered again. */
    let last: Pick<ReplaceColourValues, "tolerance" | "scope"> = { tolerance: 0, scope: "cel" };

    const current = (id: string): OpenDocument | null =>
        sessions.getState().documents.find((entry) => entry.id === id) ?? null;
    const failed = (why: string): false => {
        notices.error(`Could not replace the colour. ${why}`);
        return false;
    };

    return {
        async run() {
            const opened = activeDocument(sessions.getState());
            if (!opened) return false;
            try {
                applyFloating();
            } catch {
                // `applyFloating` has reported why.
                return false;
            }
            const document = current(opened.id);
            if (!document) return false;
            if (document.history.transaction) return failed("A stroke is in progress.");
            const hasSelection = document.session.selection !== null;
            const { foreground, background } = editor.getState();
            const scope = hasSelection
                ? "selection"
                : last.scope === "selection"
                  ? "cel"
                  : last.scope;
            const values = await dialogs.ask({
                initial: { from: foreground, to: background, tolerance: last.tolerance, scope },
                hasSelection,
            });
            if (!values) return false;
            last = { tolerance: values.tolerance, scope: values.scope };

            // The document as it is now: the dialog may have been open for a while.
            const target = current(document.id);
            if (!target) return failed("The document was closed meanwhile.");
            if (target.history.transaction) return failed("A stroke is in progress.");
            try {
                const result = replaceColourCommand(target.session, values);
                if ("refused" in result) return failed(`${REPLACE_REFUSED[result.refused]}.`);
                if (!result.command) {
                    notices.info(
                        `No pixel of ${formatHex(values.from)} to replace in ${SCOPE_NAMES[values.scope]}`,
                    );
                    return false;
                }
                target.history.execute(result.command);
                const pixels = result.pixels === 1 ? "1 pixel" : `${result.pixels} pixels`;
                notices.info(`Replaced ${pixels} in ${SCOPE_NAMES[values.scope]}`);
                return true;
            } catch (error) {
                return failed(reason(error));
            }
        },
    };
}

/** Replace Colour… of the app. */
export const replaceColour = createReplaceColour();
