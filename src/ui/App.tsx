import { lazy, Suspense } from "react";
import { UiRoot } from "@ngne/editor-ui";
import { SurfaceHost } from "@ngne/editor-ui/commands";
import { WebGpuRequired } from "@ngne/editor-ui/messages";
import { useWebGpuSupport } from "@ngne/editor-ui/platform";
import { AppShell, useWindowTooSmall } from "@ngne/editor-ui/shell";
import { editorUi } from "../app/editorUi";
import { installTestHooks } from "../app/testing/testHooks";
import { toolState } from "../app/tools/activeTool";
import { ColourChips } from "./colour/ColourChips";
import { FileWorkflows } from "./file/FileWorkflows";
import { Viewport } from "./shell/regions/Viewport";
import { PixelMemoryWarning } from "./sprite/PixelMemoryWarning";
import { statusSource } from "./status/statusSource";
import { DocumentTabs } from "./tabs/DocumentTabs";
import { TimelinePanel } from "./timeline/TimelinePanel";
import "./status/cursorField.css";

// Development route: the package's gallery, left out of the production bundle.
const Gallery = import.meta.env.DEV ? lazy(() => import("./GalleryRoute")) : null;

// Development builds only: end-to-end tests reach the stores through `window.__ngneTest`.
if (import.meta.env.DEV) installTestHooks();

function isGalleryPath(pathname: string): boolean {
    return /\/gallery\/?$/.test(pathname);
}

/**
 * The editor behind its gate: WebGPU available. The package's shell shows the window-too-small
 * notice below 1280×720 and stays mounted meanwhile, so a resize loses no state; it holds the
 * regions, and the editor fills its slots: the document tabs in the menu bar, the colour chips
 * under the tool rail, the viewport and the timeline. The surfaces that commands open (command
 * palette, Preferences, shortcut sheet, About) are outside it.
 */
function Editor({ gpu }: Readonly<{ gpu: ReturnType<typeof useWebGpuSupport> }>) {
    if (gpu.status === "checking") return null;
    if (gpu.status === "unsupported") {
        return (
            <WebGpuRequired
                productName={editorUi.config.productName}
                reason={gpu.reason}
                detail={gpu.detail}
            />
        );
    }
    return (
        <>
            <AppShell
                menuCentre={<DocumentTabs />}
                railFooter={<ColourChips />}
                viewport={<Viewport />}
                bottom={<TimelinePanel />}
                status={statusSource}
                tools={toolState}
            />
            <SurfaceHost />
            <PixelMemoryWarning />
            <FileWorkflows />
        </>
    );
}

export function App() {
    const gpu = useWebGpuSupport();
    const tooSmall = useWindowTooSmall();
    const gallery = Gallery !== null && isGalleryPath(window.location.pathname);
    // Shortcuts act only while the shell is on screen.
    return (
        <UiRoot editorUi={editorUi} keymap={!gallery && gpu.status === "supported" && !tooSmall}>
            {gallery && Gallery ? (
                <Suspense fallback={null}>
                    <Gallery />
                </Suspense>
            ) : (
                <Editor gpu={gpu} />
            )}
        </UiRoot>
    );
}
