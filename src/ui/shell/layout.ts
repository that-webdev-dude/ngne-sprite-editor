/**
 * Shell geometry (DESIGN §2), kept free of the DOM for unit tests. All values are CSS pixels.
 * The fixed region sizes are repeated in shell.css; tests/e2e/se-006-shell.spec.ts compares the
 * rendered shell with docs/design/mockup.html.
 */
export const MIN_WINDOW_WIDTH = 1280;
export const MIN_WINDOW_HEIGHT = 720;

export const DOCK_WIDTH = { default: 264, min: 220, max: 360 } as const;
export const TIMELINE_HEIGHT = {
    default: 200,
    /** The default is this fraction of the window height when that is less than `default`. */
    defaultFraction: 0.28,
    min: 120,
    /** Upper limit as a fraction of the window height. */
    maxFraction: 0.5,
} as const;

/** Tool rail metrics; they match the rail rules of shell.css. */
export const RAIL = {
    button: 28,
    gap: 2,
    padding: 8,
    /** A separator: 1 px line with 4 px margin on both sides. */
    separator: 9,
} as const;

/** Sizes the user chose with the splitters; null means the default. */
export interface StoredLayout {
    dockWidth: number | null;
    timelineHeight: number | null;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Below the minimum window the app shows a notice instead of the shell. */
export function isWindowTooSmall(width: number, height: number): boolean {
    return width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT;
}

export function timelineMaxHeight(windowHeight: number): number {
    return Math.max(TIMELINE_HEIGHT.min, Math.floor(windowHeight * TIMELINE_HEIGHT.maxFraction));
}

/** min(200 px, 28% of the window height). */
export function defaultTimelineHeight(windowHeight: number): number {
    return Math.min(
        TIMELINE_HEIGHT.default,
        Math.floor(windowHeight * TIMELINE_HEIGHT.defaultFraction),
    );
}

/** The timeline height to render: the stored or default height within 120 px–50%. */
export function resolveTimelineHeight(stored: number | null, windowHeight: number): number {
    return clamp(
        stored ?? defaultTimelineHeight(windowHeight),
        TIMELINE_HEIGHT.min,
        timelineMaxHeight(windowHeight),
    );
}

/** The dock width to render: the stored or default width within 220–360 px. */
export function resolveDockWidth(stored: number | null): number {
    return clamp(stored ?? DOCK_WIDTH.default, DOCK_WIDTH.min, DOCK_WIDTH.max);
}

/** Reads a stored layout record; anything malformed falls back to the default per field. */
export function parseStoredLayout(value: unknown): StoredLayout {
    const record = (typeof value === "object" && value !== null ? value : {}) as Record<
        string,
        unknown
    >;
    const size = (field: unknown) =>
        typeof field === "number" && Number.isFinite(field) && field > 0 ? field : null;
    return { dockWidth: size(record.dockWidth), timelineHeight: size(record.timelineHeight) };
}

/**
 * Height the rail content needs in one column: `groupSizes` tool buttons per group, separators
 * between groups, and an optional footer (colour chips) of `footerHeight`.
 */
export function railOneColumnHeight(groupSizes: readonly number[], footerHeight = 0): number {
    const groups = groupSizes.filter((size) => size > 0);
    const buttons = groups.reduce(
        (sum, size) => sum + size * RAIL.button + (size - 1) * RAIL.gap,
        0,
    );
    const separators = Math.max(0, groups.length - 1) * (RAIL.separator + 2 * RAIL.gap);
    const footer = footerHeight > 0 ? footerHeight + (groups.length > 0 ? RAIL.gap : 0) : 0;
    return 2 * RAIL.padding + buttons + separators + footer;
}

/** DESIGN §2: two columns when the content does not fit the rail's height in one. */
export function railColumns(
    groupSizes: readonly number[],
    footerHeight: number,
    availableHeight: number,
): 1 | 2 {
    return railOneColumnHeight(groupSizes, footerHeight) > availableHeight ? 2 : 1;
}
