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
    opener?.focus();
}
