import { createKeyContextStore, setKeyContext as setStateContext } from "@ngne/editor-ui/commands";
import type { KeyContextState as StateContexts } from "@ngne/editor-ui/commands";

/**
 * The two keymap contexts of SPEC §7.8 that follow editor state instead of focus. The feature
 * that owns the state switches its context on and off: the polygon lasso and the curve tool
 * for `gesture`, the floating selection for `floating`. The editor UI instance holds this store
 * (`sources.keyContextState`, src/app/editorUi.ts): its keymap resolves with it, and its
 * commands refresh when it changes.
 */
export type KeyContextState = StateContexts<"gesture" | "floating">;

export const keyContextStore = createKeyContextStore(["gesture", "floating"] as const);

export function setKeyContext(context: keyof KeyContextState, active: boolean): void {
    setStateContext(keyContextStore, context, active);
}
