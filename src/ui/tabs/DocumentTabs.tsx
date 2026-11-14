import { ChevronDown, X } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { fileWorkflows } from "../../app/file/workflows";
import { sessionsStore } from "../../app/state/sessions";
import { documentTabs, subscribeDocumentTabs } from "../../app/tabs/tabLabel";
import type { TabInfo } from "../../app/tabs/tabLabel";
import { activateDocument, closeDocument, moveDocument } from "../../app/tabs/tabs";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import "./tabs.css";

// The document tabs in the centre of the menu bar (DESIGN §2, SE-047): one tab per open
// document, the active one selected, each with its label (its file's name once it has a file,
// its sprite name until then; `tabLabel.ts`), the unsaved marker and a close control. A press
// selects a tab and a drag along the strip reorders it; a middle click or the close control
// closes it (asking first when it has unsaved changes). From the keyboard the strip is one tab
// stop: the arrow keys, Home and End move between tabs, Enter or Space selects one, Delete
// closes it and Ctrl+Shift+← / → move it. Tabs shrink to 96 px; past that the strip scrolls
// and an overflow menu lists every document.

/** How far a press moves along the strip before it is a drag, in CSS pixels. */
const DRAG_THRESHOLD = 4;

const subscribe = (listener: () => void) =>
    subscribeDocumentTabs(sessionsStore, fileWorkflows, listener);
const snapshot = () => {
    const state = sessionsStore.getState();
    return JSON.stringify([state.activeId, documentTabs(state, fileWorkflows)]);
};

/**
 * The tabs and the active document; renders again only when one of them changes. The files of
 * the documents are not in the session store, so the strip follows the file workflows too: a
 * save names the tab after its file as soon as it is done.
 */
function useTabs(): { tabs: readonly TabInfo[]; activeId: string | null } {
    const key = useSyncExternalStore(subscribe, snapshot);
    return useMemo(() => {
        const [activeId, tabs] = JSON.parse(key) as [string | null, TabInfo[]];
        return { activeId, tabs };
    }, [key]);
}

const tabSelector = (id: string) => `[data-document-tab="${CSS.escape(id)}"]`;

/** Scrolls `list` horizontally so that `tab` lies inside it. */
function reveal(list: HTMLElement, tab: Element): void {
    const outer = list.getBoundingClientRect();
    const inner = tab.getBoundingClientRect();
    if (inner.left < outer.left) list.scrollLeft -= outer.left - inner.left;
    else if (inner.right > outer.right) list.scrollLeft += inner.right - outer.right;
}

export function DocumentTabs() {
    const { tabs, activeId } = useTabs();
    const list = useRef<HTMLDivElement>(null);
    const [overflowing, setOverflowing] = useState(false);
    /** The tab the keyboard is on: the active one unless arrows moved away from it. */
    const [focusId, setFocusId] = useState<string | null>(null);
    /** A tab that must have the focus once the strip has rendered (after a keyboard move). */
    const refocus = useRef<string | null>(null);
    const stop = useRef<(() => void) | null>(null);
    const order = tabs.map((tab) => tab.id).join("\n");
    /** Everything that changes the width of a tab: a rename or the unsaved marker too. */
    const widths = JSON.stringify(tabs);
    const stopId = tabs.some((tab) => tab.id === focusId) ? focusId : activeId;

    // The overflow menu shows while the tabs, shrunk to their least width, do not fit. The
    // strip and each tab are observed: a tab that grows (a longer name) is measured again.
    useLayoutEffect(() => {
        const element = list.current;
        if (!element) return;
        const measure = () => setOverflowing(element.scrollWidth > element.clientWidth + 1);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        for (const tab of element.querySelectorAll("[data-document-tab]")) observer.observe(tab);
        return () => observer.disconnect();
    }, [widths]);

    // The active tab is always in view; so is a tab the keyboard moved.
    useLayoutEffect(() => {
        const element = list.current;
        const id = refocus.current ?? activeId;
        if (!element || id === null) return;
        const tab = element.querySelector<HTMLElement>(tabSelector(id));
        if (!tab) return;
        reveal(element, tab);
        if (refocus.current !== null) {
            refocus.current = null;
            tab.focus({ preventScroll: true });
        }
    }, [activeId, order, overflowing]);

    // A drag that is still going when the strip goes away ends with it.
    useLayoutEffect(() => () => stop.current?.(), []);

    if (tabs.length === 0) return null;

    const focusTab = (id: string) => {
        const tab = list.current?.querySelector<HTMLElement>(tabSelector(id));
        if (!tab) return;
        setFocusId(id);
        tab.focus({ preventScroll: true });
        if (list.current) reveal(list.current, tab);
    };

    /**
     * Closes the focused tab (Delete). The focus goes to the tab now in its place, or the one
     * before it; with no tab left, to the viewport (the empty state's first action).
     */
    const closeFocused = async (id: string) => {
        const index = tabs.findIndex((tab) => tab.id === id);
        if (!(await closeDocument(id))) return;
        const { documents } = sessionsStore.getState();
        const next = documents[index] ?? documents[index - 1] ?? null;
        if (next) setFocusId(next.id);
        // Once the strip has rendered without the closed tab.
        requestAnimationFrame(() => {
            const target = next
                ? document.querySelector<HTMLElement>(tabSelector(next.id))
                : document.querySelector<HTMLElement>(
                      "[data-viewport-focus], [data-empty-state] button",
                  );
            target?.focus({ preventScroll: true });
            if (next && target && list.current) reveal(list.current, target);
        });
    };

    /**
     * Ctrl+Shift+← / →: moves the tab `id`, at `index`, one place (not past either end).
     * Returns whether `key` was one of them.
     */
    const reorderKey = (key: string, id: string, index: number): boolean => {
        if (key !== "ArrowLeft" && key !== "ArrowRight") return false;
        const to = index + (key === "ArrowLeft" ? -1 : 1);
        if (to >= 0 && to < tabs.length) {
            refocus.current = id;
            setFocusId(id);
            moveDocument(id, to);
        }
        return true;
    };

    /** What a key without modifiers does on the tab `id`, at `index`; undefined: nothing. */
    const plainKeyAction = (key: string, id: string, index: number) => {
        const at = (offset: number) => tabs[(index + offset + tabs.length) % tabs.length]!.id;
        const actions = new Map<string, () => void>([
            ["ArrowLeft", () => focusTab(at(-1))],
            ["ArrowRight", () => focusTab(at(1))],
            ["Home", () => focusTab(tabs[0]!.id)],
            ["End", () => focusTab(tabs.at(-1)!.id)],
            ["Enter", () => activateDocument(id)],
            [" ", () => activateDocument(id)],
            ["Delete", () => void closeFocused(id)],
        ]);
        return actions.get(key);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLElement>, id: string) => {
        const index = tabs.findIndex((tab) => tab.id === id);
        const { altKey, ctrlKey, metaKey, shiftKey } = event;
        let handled = false;
        if (ctrlKey && shiftKey && !altKey && !metaKey) {
            handled = reorderKey(event.key, id, index);
        } else if (!altKey && !ctrlKey && !metaKey && !shiftKey) {
            const action = plainKeyAction(event.key, id, index);
            action?.();
            handled = action !== undefined;
        }
        // Taken here: the keymap leaves a key whose default was prevented alone.
        if (handled) event.preventDefault();
    };

    const onPointerDown = (event: ReactPointerEvent<HTMLElement>, id: string) => {
        if (event.button !== 0) return;
        // The close control closes; it does not select the tab first.
        if ((event.target as Element).closest("[data-tab-close]")) return;
        activateDocument(id);
        setFocusId(null);
        const element = list.current;
        if (!element) return;
        const { pointerId, clientX: startX } = event;
        let dragging = false;
        const onMove = (move: PointerEvent) => {
            if (move.pointerId !== pointerId) return;
            if (!dragging && Math.abs(move.clientX - startX) < DRAG_THRESHOLD) return;
            dragging = true;
            // The place among the other tabs: after every tab whose middle is left of the
            // pointer.
            const others = [...element.querySelectorAll<HTMLElement>("[data-document-tab]")]
                .filter((tab) => tab.dataset.documentTab !== id)
                .map((tab) => tab.getBoundingClientRect());
            const to = others.filter((box) => box.left + box.width / 2 < move.clientX).length;
            moveDocument(id, to);
        };
        const end = (up: PointerEvent) => {
            if (up.pointerId === pointerId) stop.current?.();
        };
        stop.current?.();
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        stop.current = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            stop.current = null;
        };
    };

    return (
        <div className="document-tabs" data-document-tabs="">
            <div
                ref={list}
                className="document-tabs__list"
                role="tablist"
                aria-label="Documents"
                onBlur={(event) => {
                    // Left for another part of the page: the tab stop is the selected tab again.
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setFocusId(null);
                    }
                }}
                onWheel={(event) => {
                    // A vertical wheel scrolls the strip sideways.
                    if (list.current && event.deltaX === 0) list.current.scrollLeft += event.deltaY;
                }}
            >
                {tabs.map((tab) => {
                    const active = tab.id === activeId;
                    return (
                        <div
                            key={tab.id}
                            role="tab"
                            className="document-tab"
                            aria-selected={active}
                            tabIndex={tab.id === stopId ? 0 : -1}
                            aria-keyshortcuts="Delete Control+Shift+ArrowLeft Control+Shift+ArrowRight"
                            data-document-tab={tab.id}
                            onPointerDown={(event) => onPointerDown(event, tab.id)}
                            onMouseDown={(event) => {
                                // No autoscroll on a middle press: it closes the tab.
                                if (event.button === 1) event.preventDefault();
                            }}
                            onAuxClick={(event) => {
                                if (event.button !== 1) return;
                                event.preventDefault();
                                void closeDocument(tab.id);
                            }}
                            onKeyDown={(event) => onKeyDown(event, tab.id)}
                            onFocus={() => setFocusId(tab.id)}
                        >
                            <span className="document-tab__label">
                                <span
                                    className="document-tab__name"
                                    data-document-name={active ? "" : undefined}
                                    title={tab.tooltip}
                                >
                                    {tab.label}
                                </span>
                                {tab.dirty ? (
                                    <span
                                        className="document-tab__unsaved"
                                        data-unsaved-marker={active ? "" : undefined}
                                        title="Unsaved changes"
                                    >
                                        <span aria-hidden="true">*</span>
                                        <span className="ui-visually-hidden">Unsaved changes</span>
                                    </span>
                                ) : null}
                            </span>
                            {/* Pointer only: from the keyboard Delete closes the tab. */}
                            <span
                                className="document-tab__close"
                                aria-hidden="true"
                                title={`Close ${tab.label}`}
                                data-tab-close=""
                                onClick={() => void closeDocument(tab.id)}
                            >
                                <Icon icon={X} />
                            </span>
                        </div>
                    );
                })}
            </div>
            {overflowing ? (
                <DropdownMenu.Root modal={false}>
                    {/* An icon-only control has the app's tooltip (DESIGN §8; SE-071). */}
                    <Tooltip label="All documents">
                        <DropdownMenu.Trigger asChild>
                            <button
                                type="button"
                                className="ui-icon-button document-tabs__overflow"
                                aria-label="All documents"
                                data-tabs-overflow=""
                            >
                                <Icon icon={ChevronDown} />
                            </button>
                        </DropdownMenu.Trigger>
                    </Tooltip>
                    <DropdownMenu.Portal>
                        <DropdownMenu.Content
                            className="ui-menu"
                            align="end"
                            sideOffset={4}
                            collisionPadding={8}
                            aria-label="All documents"
                            onContextMenu={(event) => event.preventDefault()}
                        >
                            <DropdownMenu.RadioGroup
                                value={activeId ?? ""}
                                onValueChange={(id) => activateDocument(id)}
                            >
                                {tabs.map((tab) => (
                                    <DropdownMenu.RadioItem
                                        key={tab.id}
                                        className="ui-menu__item"
                                        value={tab.id}
                                        data-tab-item={tab.id}
                                    >
                                        <span className="document-tabs__item-name">
                                            {tab.label}
                                        </span>
                                        {tab.dirty ? (
                                            <span className="ui-menu__shortcut">
                                                Unsaved changes
                                            </span>
                                        ) : null}
                                    </DropdownMenu.RadioItem>
                                ))}
                            </DropdownMenu.RadioGroup>
                        </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                </DropdownMenu.Root>
            ) : null}
        </div>
    );
}
