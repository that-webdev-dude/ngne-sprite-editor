// SE-071: what `surfaceOpener` follows (below).
const MENU_SELECTOR = '[role="menu"]';

/** The element focused before the focus entered the menus; null when there was none. */
let menuOrigin: HTMLElement | null = null;
/** Whether the focus was last inside a menu (an item removed leaves it on the body). */
let inMenu = false;
let ignoring = false;
let installed = false;

/**
 * A command chosen from a menu runs while the menu is still open and its item has focus; the
 * menu closes afterwards and the item is gone. A dialog that the command opens records the
 * focused element as its opener, and would have nothing to return focus to.
 *
 * This moves focus from an item of an open menu to the control that opened the menu, which
 * stays on the page: the menu names it with `aria-labelledby`. From a submenu it goes on to the
 * control of the outermost menu. It does nothing when focus is not in a menu, or when a menu
 * has no such control (a context menu).
 */
export function focusMenuOpener(root: Document = document): void {
    let element: Element | null = root.activeElement;
    let opener: HTMLElement | null = null;
    // A bound on the nesting, so that malformed markup cannot loop.
    for (let depth = 0; depth < 8; depth++) {
        const menu: Element | null = element?.closest('[role="menu"]') ?? null;
        if (!menu) break;
        const id = menu.getAttribute("aria-labelledby");
        opener = id ? root.getElementById(id) : null;
        if (!opener) return;
        element = opener;
    }
    if (!opener) return;
    // A modal menu keeps the focus inside while it is open; the attempt and the focus it
    // bounces back are not a change of origin (`surfaceOpener`).
    ignoring = true;
    try {
        opener.focus();
    } finally {
        ignoring = false;
    }
    if (root.activeElement === opener) inMenu = false;
}

// SE-071: the origin of a surface that a menu item opens. A context menu or a modal dropdown
// (the palette's swatch actions) has no control to go back to that `focusMenuOpener` could
// focus, and a modal one would not let the focus out anyway. So the element that had the
// focus when a menu took it — the cell, the swatch, the button — is remembered, and a surface
// that opens while the focus is (or, its item gone, was last) in a menu takes that element as
// its opener: the focus returns there when it closes.

function onFocusIn(event: FocusEvent): void {
    if (ignoring) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(MENU_SELECTOR)) {
        inMenu = false;
        return;
    }
    if (inMenu) return;
    inMenu = true;
    const from = event.relatedTarget;
    menuOrigin =
        from instanceof HTMLElement && from !== document.body && !from.closest(MENU_SELECTOR)
            ? from
            : null;
}

/** Starts following the focus in and out of menus; once per page. */
export function trackMenuOrigins(): void {
    if (installed || typeof document === "undefined") return;
    installed = true;
    document.addEventListener("focusin", onFocusIn, true);
}

trackMenuOrigins();

/**
 * The element a surface opening now returns the focus to when it closes: the focused element,
 * or — while the focus is in a menu, or was there last before its item went away — the element
 * that had the focus when the menus took it.
 */
export function surfaceOpener(): HTMLElement | null {
    const active = document.activeElement;
    const fromMenu = active === null || active === document.body || active.closest(MENU_SELECTOR);
    if (inMenu && fromMenu) return menuOrigin?.isConnected ? menuOrigin : null;
    return active instanceof HTMLElement && active !== document.body ? active : null;
}
