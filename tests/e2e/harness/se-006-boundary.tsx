import { createRoot } from "react-dom/client";
import "@ngne/editor-ui/styles.css";
import { createEditorUi, UiRoot } from "@ngne/editor-ui";
import { AppShell } from "@ngne/editor-ui/shell";
import type { StatusField } from "@ngne/editor-ui/shell";
import { editorUi } from "../../../src/app/editorUi";
import { railToolSource } from "../../../src/app/tools/railToolSource";
import { ColourChips } from "../../../src/ui/colour/ColourChips";
import { Viewport } from "../../../src/ui/shell/regions/Viewport";
import { statusSource } from "../../../src/ui/status/statusSource";
import type { StatusFields } from "../../../src/ui/status/statusFields";
import { DocumentTabs } from "../../../src/ui/tabs/DocumentTabs";
import { TimelinePanel } from "../../../src/ui/timeline/TimelinePanel";

// SE-006 error boundary page: the real shell, built by the package from the app's registries,
// with one region (`?region=<id>`) or one dock panel (`?region=dock-panel`) whose content
// throws while rendering. The spec repairs it by setting `window.se006Repaired` and then uses
// the boundary's Reload action. The regions the app fills (menu bar centre, tool rail footer,
// viewport, timeline) take the failing content in their slot; the context bar, the dock and
// the status bar draw registries, so the page adds a failing entry to the registry instead.

const repaired = () => !!(window as Window & { se006Repaired?: boolean }).se006Repaired;

function Fragile() {
    if (!repaired()) throw new Error("SE-006 harness: this content fails to render.");
    return <span data-fragile="">Content restored</span>;
}

const steady = () => <span data-steady="">Steady content</span>;
const never = () => () => {};

const target = new URLSearchParams(window.location.search).get("region") ?? "";
const { modules } = editorUi.config;

/** A status field fails as a whole, not as a component: its text throws until repaired. */
const fragileField: StatusField<StatusFields> = {
    id: "fragile",
    order: 0,
    text() {
        if (!repaired()) throw new Error("SE-006 harness: this content fails to render.");
        return "Content restored";
    },
};

const harnessUi = createEditorUi({
    ...editorUi.config,
    modules: {
        ...modules,
        contextBars:
            target === "context-bar"
                ? {
                      ...modules.contextBars,
                      "harness/fragile.contextbar.tsx": {
                          contextBarContent: {
                              id: "fragile",
                              order: -1,
                              shown: () => true,
                              subscribe: never,
                              Body: Fragile,
                          },
                      },
                  }
                : modules.contextBars,
        dock:
            target === "dock-panel"
                ? {
                      "harness/fragile.dock.tsx": {
                          dockPanel: { id: "fragile", title: "Fragile", order: 1, Body: Fragile },
                      },
                      "harness/steady.dock.tsx": {
                          dockPanel: { id: "steady", title: "Steady", order: 2, Body: steady },
                      },
                  }
                : target === "dock"
                  ? {
                        ...modules.dock,
                        // The header is outside the panel's own boundary: the dock's catches it.
                        "harness/fragile.dock.tsx": {
                            dockPanel: {
                                id: "fragile",
                                title: "Fragile",
                                order: 1000,
                                Body: steady,
                                HeaderExtra: Fragile,
                            },
                        },
                    }
                  : modules.dock,
        statusFields:
            target === "status-bar"
                ? {
                      ...modules.statusFields,
                      "harness/fragile.status.ts": { statusFields: [fragileField] },
                  }
                : modules.statusFields,
    },
});

// Fields are text: the restored field is marked here, as the spec finds restored content.
new MutationObserver(() => {
    const field = document.querySelector('[data-status="fragile"]:not([data-fragile])');
    field?.setAttribute("data-fragile", "");
}).observe(document.body, { childList: true, subtree: true });

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
    <UiRoot editorUi={harnessUi}>
        <AppShell
            menuCentre={target === "menu-bar" ? <Fragile /> : <DocumentTabs />}
            railFooter={target === "tool-rail" ? <Fragile /> : <ColourChips />}
            viewport={target === "viewport" ? <Fragile /> : <Viewport />}
            bottom={target === "timeline" ? <Fragile /> : <TimelinePanel />}
            status={statusSource}
            tools={railToolSource}
        />
    </UiRoot>,
);
