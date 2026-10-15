// On the colour controls the right button means the background colour (DESIGN §4: no context
// menu "on the canvas or on swatches, where the right button means background colour"; DESIGN
// §5.3 for the picker). Chrome sends the context menu of a right press at the press on Linux
// and macOS, and at the release on Windows, to the element under the pointer then — which,
// after a drag, may be another region. As the viewport does for a right-button stroke
// (SE-014), the one menu that follows the press is cancelled wherever it goes; any later
// press, or the keyboard's menu key, disarms that.

let disarm: (() => void) | null = null;

/** Cancels the context menu that follows the right-button press being handled now. */
export function cancelNextContextMenu(): void {
    disarm?.();
    const onMenu = (event: Event) => {
        event.preventDefault();
        stop();
    };
    // Listeners added while the press is dispatched do not see that press itself.
    const onPress = () => stop();
    const onKey = (event: KeyboardEvent) => {
        if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) stop();
    };
    const stop = () => {
        window.removeEventListener("contextmenu", onMenu, true);
        window.removeEventListener("pointerdown", onPress, true);
        window.removeEventListener("keydown", onKey, true);
        if (disarm === stop) disarm = null;
    };
    window.addEventListener("contextmenu", onMenu, true);
    window.addEventListener("pointerdown", onPress, true);
    window.addEventListener("keydown", onKey, true);
    disarm = stop;
}
