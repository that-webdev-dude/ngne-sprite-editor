import { Frame } from "@ngne/core";
import { defaultAdapter } from "../lib/gpu.ts";
import { runSpike } from "../lib/harness.ts";
import { camera, createRenderer } from "../lib/ngne.ts";

// Adapter probe: which adapter `requestAdapter()` returns without options (NGNE's call), and
// which adapter NGNE's own device comes from. The runner compares both with the GPU requested.
runSpike(0, async (spike) => {
    const adapter = await defaultAdapter();
    spike.metric("defaultAdapter", adapter);
    spike.check("WebGPU adapter available", adapter !== null);
    if (!adapter) return;

    const canvas = document.createElement("canvas");
    document.querySelector("#stage")?.append(canvas);
    const errors: unknown[] = [];
    const renderer = await createRenderer(canvas, 16, 16, (error) => errors.push(error));
    const frame = new Frame();
    frame.scene(camera(false), 1);
    frame.rect(8, 8, 8, 8, 0xff0000);
    renderer.render(frame, 0x000010);
    spike.check("NGNE renderer ready", renderer.status === "ready" && errors.length === 0);
    spike.metric("userAgent", navigator.userAgent);
    renderer.dispose();
});
