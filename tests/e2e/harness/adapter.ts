// The DOM library of the pinned TypeScript has no WebGPU types; only these fields are read.
interface GpuLike {
    requestAdapter(): Promise<{ info: { vendor: string; architecture: string } } | null>;
}

/** The page's WebGPU adapter as "<vendor> <architecture>", or "none". */
export async function adapterName(): Promise<string> {
    const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
    const adapter = await gpu?.requestAdapter();
    return adapter ? `${adapter.info.vendor} ${adapter.info.architecture}`.trim() : "none";
}
