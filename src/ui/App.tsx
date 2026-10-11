import { lazy, Suspense } from "react";
import { useWindowHeight, useWindowWidth } from "./platform/useWindowSize";
import { useWebGpuSupport } from "./platform/webgpu";
import { AppShell } from "./shell/AppShell";
import { isWindowTooSmall } from "./shell/layout";
import { WebGpuRequired } from "./shell/notices/WebGpuRequired";
import { WindowTooSmall } from "./shell/notices/WindowTooSmall";
import { UiRoot } from "./UiRoot";

// Development route: left out of the production bundle.
const Gallery = import.meta.env.DEV
    ? lazy(() => import("./gallery/Gallery").then((module) => ({ default: module.Gallery })))
    : null;

function isGalleryPath(pathname: string): boolean {
    return /\/gallery\/?$/.test(pathname);
}

/** The editor behind its two gates: WebGPU available, window at least 1280×720. */
function Editor() {
    const gpu = useWebGpuSupport();
    const width = useWindowWidth();
    const height = useWindowHeight();
    if (gpu.status === "checking") return null;
    if (gpu.status === "unsupported") {
        return <WebGpuRequired reason={gpu.reason} detail={gpu.detail} />;
    }
    // The shell stays mounted while the notice covers it, so a resize loses no state.
    const tooSmall = isWindowTooSmall(width, height);
    return (
        <>
            <AppShell hidden={tooSmall} />
            {tooSmall ? <WindowTooSmall width={width} height={height} /> : null}
        </>
    );
}

export function App() {
    return (
        <UiRoot>
            {Gallery && isGalleryPath(window.location.pathname) ? (
                <Suspense fallback={null}>
                    <Gallery />
                </Suspense>
            ) : (
                <Editor />
            )}
        </UiRoot>
    );
}
