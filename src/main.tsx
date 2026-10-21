import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerAppUpdates, UPDATE_CHECK_MS } from "./app/pwa/updates";
import { App } from "./ui/App";
import { showUpdateToast } from "./ui/pwa/updateToast";

declare global {
    interface ImportMetaEnv {
        /** Vite's `base`: where the app, its manifest and its service worker are served. */
        readonly BASE_URL: string;
        /** True in a build, which has the service worker beside it (vite.config.ts). */
        readonly SERVICE_WORKER: boolean;
    }
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>,
);

// SE-072: a build registers its service worker (src/app/pwa/sw.ts), which keeps the app for
// offline use, and offers Reload when a new deployment is waiting. The dev server has none.
// The worker is registered once the page has loaded, so its download of the whole build does
// not compete with the page's own start.
function startServiceWorker(container: ServiceWorkerContainer): void {
    const updates = registerAppUpdates({
        container,
        url: `${import.meta.env.BASE_URL}sw.js`,
        scope: import.meta.env.BASE_URL,
        reload: () => window.location.reload(),
    });
    showUpdateToast(updates);
    // A page left open asks for a new deployment when it is shown again, and every hour.
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void updates.check();
    });
    setInterval(() => void updates.check(), UPDATE_CHECK_MS);
}

if (import.meta.env.SERVICE_WORKER && "serviceWorker" in navigator) {
    const start = () => startServiceWorker(navigator.serviceWorker);
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
}
