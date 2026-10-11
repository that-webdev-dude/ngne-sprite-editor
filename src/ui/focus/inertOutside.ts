/**
 * While a modal Radix layer is open (dialog, select list, context menu) Radix marks the rest of
 * the page `aria-hidden`, together with the marker below, and keeps pointer and Tab away from
 * it by its own means. This mirrors the mark to `inert`, so the browser itself treats that
 * content as unavailable: an `aria-hidden` subtree with focusable controls is otherwise an
 * accessibility error (WCAG 4.1.2, axe "aria-hidden-focus").
 */
const MARKER = "data-aria-hidden";
/** Radix's own tab stops at the edges of the page; they must stay focusable. */
const FOCUS_GUARD = "data-radix-focus-guard";

/** Starts mirroring under `root`; returns the function that stops it. */
export function inertOutsideModalLayers(root: HTMLElement = document.body): () => void {
    const observer = new MutationObserver((records) => {
        for (const { target } of records) {
            if (!(target instanceof HTMLElement) || target.hasAttribute(FOCUS_GUARD)) continue;
            target.inert = target.hasAttribute(MARKER);
        }
    });
    observer.observe(root, { attributes: true, attributeFilter: [MARKER], subtree: true });
    return () => observer.disconnect();
}
