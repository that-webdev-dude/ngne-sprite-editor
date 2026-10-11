/**
 * Input modality for the focus ring (DESIGN §3.3: keyboard focus only). The last relevant
 * input kind is written to `data-modality` on the root element; styles/base.css shows the ring
 * only under "keyboard".
 */
export type Modality = "keyboard" | "pointer";

export interface ModalityKey {
    key: string;
    /** The event target accepts typed text (text field, textarea, contenteditable). */
    typing: boolean;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]);

/**
 * Whether a key press means the user is working from the keyboard. Modifiers alone do not
 * (Shift-click, Ctrl-drag), and neither does typing or stepping inside a text field that was
 * focused with the pointer; Tab always does.
 */
export function isKeyboardNavigation({ key, typing }: ModalityKey): boolean {
    if (MODIFIER_KEYS.has(key)) return false;
    return !typing || key === "Tab";
}

const NON_TEXT_INPUT_TYPES = new Set([
    "button",
    "checkbox",
    "color",
    "file",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
]);

function acceptsTyping(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
    return target instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(target.type);
}

/** Starts tracking on `root`; returns the function that stops it. */
export function trackFocusModality(root: HTMLElement = document.documentElement): () => void {
    const set = (modality: Modality) => {
        if (root.dataset.modality !== modality) root.dataset.modality = modality;
    };
    const onKeyDown = (event: KeyboardEvent) => {
        if (isKeyboardNavigation({ key: event.key, typing: acceptsTyping(event.target) })) {
            set("keyboard");
        }
    };
    const onPointerDown = () => set("pointer");
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("pointerdown", onPointerDown, true);
        delete root.dataset.modality;
    };
}
