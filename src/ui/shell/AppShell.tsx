import type { CSSProperties, ReactNode } from "react";
import { useTimelineState } from "../../app/timeline/timelineState";
import { useWindowHeight } from "../platform/useWindowSize";
import { Splitter } from "../primitives/Splitter";
import {
    DOCK_WIDTH,
    resolveDockWidth,
    resolveTimelineHeight,
    TIMELINE_HEIGHT,
    timelineMaxHeight,
} from "./layout";
import { useLayout } from "./layoutStore";
import { RailFrame } from "./RailFrame";
import { RegionBoundary } from "./RegionBoundary";
import { ContextBar } from "./regions/ContextBar";
import { Dock } from "./regions/Dock";
import { MenuBar } from "./regions/MenuBar";
import { StatusBar } from "./regions/StatusBar";
import { Timeline } from "./regions/Timeline";
import { ToolRail } from "./regions/ToolRail";
import { Viewport } from "./regions/Viewport";
import "./shell.css";

/** The seven regions of DESIGN §2; each element carries its id as `data-region`. */
export const REGION_IDS = [
    "menu-bar",
    "tool-rail",
    "context-bar",
    "viewport",
    "dock",
    "timeline",
    "status-bar",
] as const;
export type RegionId = (typeof REGION_IDS)[number];

export interface AppShellProps {
    /** Replaces the content of single regions (test pages); the default is `regions/*.tsx`. */
    regions?: Partial<Record<RegionId, ReactNode>>;
    /** Keeps the shell mounted but not displayed (window too small). */
    hidden?: boolean;
}

/**
 * App shell: the region frames, their error boundaries and the two splitters. Region content
 * lives in `regions/`, one module per region, so a feature edits only its own region.
 */
export function AppShell({ regions = {}, hidden = false }: AppShellProps) {
    const windowHeight = useWindowHeight();
    const dockWidth = resolveDockWidth(useLayout((state) => state.dockWidth));
    const timelineHeight = resolveTimelineHeight(
        useLayout((state) => state.timelineHeight),
        windowHeight,
    );
    const setDockWidth = useLayout((state) => state.setDockWidth);
    const setTimelineHeight = useLayout((state) => state.setTimelineHeight);
    // Tab toggles the timeline (SPEC §7.8, SE-022); hidden, its row of the grid is empty.
    const timelineVisible = useTimelineState((state) => state.visible);
    const sizes = {
        "--shell-dock-width": `${dockWidth}px`,
        "--shell-timeline-height": timelineVisible ? `${timelineHeight}px` : "0px",
    } as CSSProperties;

    return (
        <div className="shell" style={sizes} hidden={hidden}>
            <header className="shell-menubar" data-region="menu-bar">
                <RegionBoundary name="Menu bar">
                    {regions["menu-bar"] ?? <MenuBar />}
                </RegionBoundary>
            </header>
            <RailFrame>{regions["tool-rail"] ?? <ToolRail />}</RailFrame>
            <section className="shell-context" data-region="context-bar" aria-label="Tool options">
                <RegionBoundary name="Context bar">
                    {regions["context-bar"] ?? <ContextBar />}
                </RegionBoundary>
            </section>
            <main className="shell-viewport" data-region="viewport">
                <RegionBoundary name="Viewport">{regions.viewport ?? <Viewport />}</RegionBoundary>
            </main>
            <aside className="shell-dock" data-region="dock" aria-label="Panels">
                <Splitter
                    className="shell-dock__splitter"
                    orientation="vertical"
                    label="Resize panels"
                    value={dockWidth}
                    min={DOCK_WIDTH.min}
                    max={DOCK_WIDTH.max}
                    growth={-1}
                    onChange={setDockWidth}
                    onReset={() => setDockWidth(null)}
                />
                <div className="shell-dock__scroll">
                    <RegionBoundary name="Panels">{regions.dock ?? <Dock />}</RegionBoundary>
                </div>
            </aside>
            <section
                className="shell-timeline"
                data-region="timeline"
                aria-label="Timeline"
                hidden={!timelineVisible}
            >
                <Splitter
                    className="shell-timeline__splitter"
                    orientation="horizontal"
                    label="Resize timeline"
                    value={timelineHeight}
                    min={TIMELINE_HEIGHT.min}
                    max={timelineMaxHeight(windowHeight)}
                    growth={-1}
                    onChange={setTimelineHeight}
                    onReset={() => setTimelineHeight(null)}
                />
                <div className="shell-timeline__content">
                    <RegionBoundary name="Timeline">
                        {regions.timeline ?? <Timeline />}
                    </RegionBoundary>
                </div>
            </section>
            <footer className="shell-status" data-region="status-bar">
                <RegionBoundary name="Status bar">
                    {regions["status-bar"] ?? <StatusBar />}
                </RegionBoundary>
            </footer>
        </div>
    );
}
