import { useEffect, useState } from "react";

/**
 * WebGPU availability for the "WebGPU required" notice (DESIGN §7). The engine is not
 * involved: only `navigator.gpu` and adapter acquisition are probed, so nothing here imports
 * `@ngne/core` (SPEC §5).
 */
export type WebGpuSupport =
    | { status: "checking" }
    | { status: "supported" }
    | { status: "unsupported"; reason: "no-api" | "no-adapter"; detail?: string };

// The DOM library of the pinned TypeScript has no WebGPU types; only these fields are read.
interface GpuLike {
    requestAdapter(): Promise<object | null>;
}
export interface NavigatorLike {
    gpu?: GpuLike;
}

const NO_API: WebGpuSupport = { status: "unsupported", reason: "no-api" };

/** The answer available without waiting: missing API, or still to be checked. */
export function initialWebGpuSupport(nav: NavigatorLike): WebGpuSupport {
    return nav.gpu ? { status: "checking" } : NO_API;
}

/** Resolves once adapter acquisition has succeeded or failed. Never rejects. */
export async function detectWebGpu(nav: NavigatorLike): Promise<WebGpuSupport> {
    const gpu = nav.gpu;
    if (!gpu) return NO_API;
    try {
        const adapter = await gpu.requestAdapter();
        return adapter ? { status: "supported" } : { status: "unsupported", reason: "no-adapter" };
    } catch (error) {
        return { status: "unsupported", reason: "no-adapter", detail: String(error) };
    }
}

export function useWebGpuSupport(): WebGpuSupport {
    const [support, setSupport] = useState<WebGpuSupport>(() =>
        initialWebGpuSupport(navigator as NavigatorLike),
    );
    useEffect(() => {
        let live = true;
        void detectWebGpu(navigator as NavigatorLike).then((result) => {
            if (live) setSupport(result);
        });
        return () => {
            live = false;
        };
    }, []);
    return support;
}
