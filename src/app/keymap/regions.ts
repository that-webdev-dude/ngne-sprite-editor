/**
 * Focus regions (SPEC §7.8, DESIGN §8): F6 and Shift+F6 move keyboard focus between the
 * regions of the shell, in document order.
 *
 * A region is an element with `data-region`. It takes part while it holds something that can
 * be focused: the element marked `data-region-focus`, or else its first tabbable element (a
 * splitter only when there is nothing else). A feature therefore joins the cycle by rendering
 * a focusable element in its region; nothing is registered.
 */
export const REGION_ATTRIBUTE = "data-region";
export const REGION_FOCUS_ATTRIBUTE = "data-region-focus";

const TABBABLE = [
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "summary",
    "[tabindex]",
    '[contenteditable="true"]',
].join(", ");

function canTakeFocus(element: HTMLElement): boolean {
    if (element.matches(":disabled") || element.closest("[inert]")) return false;
    if (element.getClientRects().length === 0) return false;
    return getComputedStyle(element).visibility !== "hidden";
}

/** The element F6 focuses in `region`, or null when the region has nothing to focus. */
export function regionFocusTarget(region: HTMLElement): HTMLElement | null {
    const marked = region.matches(`[${REGION_FOCUS_ATTRIBUTE}]`)
        ? region
        : region.querySelector<HTMLElement>(`[${REGION_FOCUS_ATTRIBUTE}]`);
    if (marked && canTakeFocus(marked)) return marked;

    const tabbable = [...region.querySelectorAll<HTMLElement>(TABBABLE)].filter(
        (element) => element.tabIndex >= 0 && canTakeFocus(element),
    );
    return (
        tabbable.find((element) => element.getAttribute("role") !== "separator") ??
        tabbable[0] ??
        null
    );
}

/**
 * Moves focus to the next (`1`) or previous (`-1`) region that can take it, wrapping around.
 * With focus outside every region the first or the last region is entered. Returns whether
 * focus moved.
 */
export function cycleFocusRegion(direction: 1 | -1, root: Document = document): boolean {
    const targets: { region: HTMLElement; target: HTMLElement }[] = [];
    for (const region of root.querySelectorAll<HTMLElement>(`[${REGION_ATTRIBUTE}]`)) {
        const target = regionFocusTarget(region);
        if (target) targets.push({ region, target });
    }
    if (targets.length === 0) return false;

    const active = root.activeElement;
    const current = targets.findIndex(({ region }) => active !== null && region.contains(active));
    const start = current === -1 && direction === -1 ? 0 : current;
    const next = targets[(start + direction + targets.length) % targets.length];
    if (!next || next.target === active) return false;
    next.target.focus();
    return root.activeElement === next.target;
}
