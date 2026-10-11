import { createRoot } from "react-dom/client";
import { DockSection } from "../../../src/ui/dock/DockSection";
import type { DockPanel } from "../../../src/ui/dock/registry";
import { AppShell, REGION_IDS } from "../../../src/ui/shell/AppShell";
import type { RegionId } from "../../../src/ui/shell/AppShell";
import { UiRoot } from "../../../src/ui/UiRoot";

// SE-006 error boundary page: the real shell with one region (`?region=<id>`) or one dock panel
// (`?region=dock-panel`) whose content throws while rendering. The spec repairs it by setting
// `window.se006Repaired` and then uses the boundary's Reload action.
function Fragile() {
    if (!(window as Window & { se006Repaired?: boolean }).se006Repaired) {
        throw new Error("SE-006 harness: this content fails to render.");
    }
    return <span data-fragile="">Content restored</span>;
}

const fragilePanel: DockPanel = { id: "fragile", title: "Fragile", order: 1, Body: Fragile };
const steadyPanel: DockPanel = {
    id: "steady",
    title: "Steady",
    order: 2,
    Body: () => <span data-steady="">Steady content</span>,
};

const target = new URLSearchParams(window.location.search).get("region") ?? "";
const regions =
    target === "dock-panel"
        ? {
              dock: (
                  <>
                      <DockSection
                          panel={fragilePanel}
                          collapsed={false}
                          onCollapsedChange={() => {}}
                      />
                      <DockSection
                          panel={steadyPanel}
                          collapsed={false}
                          onCollapsedChange={() => {}}
                      />
                  </>
              ),
          }
        : REGION_IDS.includes(target as RegionId)
          ? { [target]: <Fragile /> }
          : {};

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
    <UiRoot>
        <AppShell regions={regions} />
    </UiRoot>,
);
