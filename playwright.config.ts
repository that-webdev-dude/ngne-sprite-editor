import { createServer } from "node:net";
import { defineConfig } from "@playwright/test";

// One port per checkout: taken from PORT, otherwise a free one. It is written back to the
// environment so the worker processes, which load this file again, reuse the same value.
function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            server.close(() =>
                typeof address === "object" && address
                    ? resolve(address.port)
                    : reject(new Error("no port")),
            );
        });
    });
}
process.env.PORT ??= String(await freePort());
const port = Number(process.env.PORT);

const ci = !!process.env.CI;

// NGNE's CI setup for software WebGPU (ngne/.github/workflows/ci.yml): headed Chrome under
// xvfb with the SwiftShader adapter. Locally Chrome uses the hardware adapter.
const swiftShaderArgs = [
    "--use-webgpu-adapter=swiftshader",
    "--enable-unsafe-webgpu",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
    "--enable-features=Vulkan",
    "--use-angle=vulkan",
    "--use-vulkan=swiftshader",
    "--disable-vulkan-surface",
];

export default defineConfig({
    testDir: "tests/e2e",
    testMatch: "**/*.spec.ts",
    fullyParallel: true,
    forbidOnly: ci,
    retries: 0,
    // CI shows every worker's Chrome window on one X display. Two instances take the pointer
    // grab and the hover from each other, which ends drags and closes menus mid-test.
    workers: ci ? 1 : undefined,
    // A cold dev server and the CI runner (software WebGPU, few cores) are several times
    // slower than a warm local run; the limits leave room for both.
    timeout: ci ? 120_000 : 30_000,
    expect: { timeout: ci ? 20_000 : 10_000 },
    reporter: ci ? [["github"], ["list"]] : "list",
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        channel: "chrome",
        headless: process.env.E2E_HEADLESS !== "0",
        launchOptions: {
            // The scale factor is fixed: a headed run on a scaled display otherwise lays out
            // in fractional pixels.
            args: [
                "--force-color-profile=srgb",
                "--force-device-scale-factor=1",
                ...(ci ? swiftShaderArgs : []),
            ],
        },
        trace: "retain-on-failure",
    },
    webServer: {
        command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: false,
    },
});
