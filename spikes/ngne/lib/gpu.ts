import type { AdapterRecord } from "./types.ts";

// The DOM library of the pinned TypeScript has no WebGPU types; only these fields are used.
export interface GpuDeviceLike {
    destroy(): void;
    readonly lost: Promise<{ readonly reason?: string; readonly message: string }>;
    readonly queue: { onSubmittedWorkDone(): Promise<undefined> };
}

interface GpuAdapterInfoLike {
    readonly vendor: string;
    readonly architecture: string;
    readonly device: string;
    readonly description: string;
    readonly isFallbackAdapter?: boolean;
}

interface GpuAdapterLike {
    readonly info: GpuAdapterInfoLike;
    requestDevice(...args: unknown[]): Promise<GpuDeviceLike>;
}

interface GpuLike {
    requestAdapter(options?: unknown): Promise<GpuAdapterLike | null>;
}

export interface TrackedDevice {
    readonly device: GpuDeviceLike;
    readonly adapter: AdapterRecord;
    readonly createdAt: number;
    live: boolean;
    endedAt?: number;
    reason?: string;
}

export interface DeviceTracker {
    readonly devices: TrackedDevice[];
    liveCount(): number;
    latestLive(): TrackedDevice | undefined;
    adapters(): AdapterRecord[];
}

function recordOf(info: GpuAdapterInfoLike): AdapterRecord {
    return {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
        isFallbackAdapter: info.isFallbackAdapter ?? null,
    };
}

/** The adapter `requestAdapter()` returns without options, which is how NGNE asks for it. */
export async function defaultAdapter(): Promise<AdapterRecord | null> {
    const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
    const adapter = await gpu?.requestAdapter();
    return adapter ? recordOf(adapter.info) : null;
}

/**
 * Wraps `GPUAdapter.prototype.requestDevice` (SE-002 method notes) so every device NGNE
 * creates is known: live count for question 4, forced loss for question 8, and the adapter
 * actually used for every question. Call before the first renderer is created.
 */
export function trackDevices(): DeviceTracker {
    const devices: TrackedDevice[] = [];
    const scope = globalThis as unknown as { GPUAdapter?: { prototype: GpuAdapterLike } };
    const prototype = scope.GPUAdapter?.prototype;
    if (prototype) {
        const original = prototype.requestDevice;
        prototype.requestDevice = async function (this: GpuAdapterLike, ...args: unknown[]) {
            const device = await original.apply(this, args);
            const tracked: TrackedDevice = {
                device,
                adapter: recordOf(this.info),
                createdAt: performance.now(),
                live: true,
            };
            const end = (reason: string) => {
                if (!tracked.live) return;
                tracked.live = false;
                tracked.endedAt = performance.now();
                tracked.reason = reason;
            };
            const destroy = device.destroy.bind(device);
            device.destroy = () => {
                end("destroy()");
                destroy();
            };
            void device.lost.then((info) => end(info.reason ?? "lost"));
            devices.push(tracked);
            return device;
        };
    }
    return {
        devices,
        liveCount: () => devices.filter((entry) => entry.live).length,
        latestLive: () => [...devices].reverse().find((entry) => entry.live),
        adapters() {
            const seen = new Map<string, AdapterRecord>();
            for (const { adapter } of devices) seen.set(JSON.stringify(adapter), adapter);
            return [...seen.values()];
        },
    };
}
