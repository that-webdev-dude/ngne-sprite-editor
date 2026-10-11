import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyValueStorage } from "../../src/ui/platform/storage";
import { detectWebGpu, initialWebGpuSupport } from "../../src/ui/platform/webgpu";
import { createThemeStore, THEME_STORAGE_KEY } from "../../src/ui/theme/theme";
import { createToastService, INFO_TOAST_MS } from "../../src/ui/toast/toast";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
    data: Map<string, string>;
} {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => void data.set(key, value),
        removeItem: (key) => void data.delete(key),
    };
}

describe("theme store", () => {
    it("defaults to dark", () => {
        expect(createThemeStore(memoryStorage()).getState().theme).toBe("dark");
        expect(createThemeStore(null).getState().theme).toBe("dark");
    });

    it("persists the theme and restores it in a new store", () => {
        const storage = memoryStorage();
        const store = createThemeStore(storage);
        store.getState().setTheme("light");
        expect(storage.data.get(THEME_STORAGE_KEY)).toBe("light");
        expect(createThemeStore(storage).getState().theme).toBe("light");

        store.getState().toggleTheme();
        expect(store.getState().theme).toBe("dark");
        expect(createThemeStore(storage).getState().theme).toBe("dark");
    });

    it("falls back to dark on an unknown stored value", () => {
        const storage = memoryStorage({ [THEME_STORAGE_KEY]: "sepia" });
        expect(createThemeStore(storage).getState().theme).toBe("dark");
    });

    it("notifies subscribers", () => {
        const store = createThemeStore(memoryStorage());
        const seen: string[] = [];
        store.subscribe((state) => seen.push(state.theme));
        store.getState().setTheme("light");
        expect(seen).toEqual(["light"]);
    });
});

describe("toast service (DESIGN §4)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const messages = (service: ReturnType<typeof createToastService>) =>
        service.store.getState().toasts.map((item) => `${item.kind}: ${item.message}`);

    it("removes an information toast after 4 s", () => {
        const service = createToastService();
        service.info("Saved");
        expect(messages(service)).toEqual(["info: Saved"]);
        vi.advanceTimersByTime(INFO_TOAST_MS - 1);
        expect(messages(service)).toEqual(["info: Saved"]);
        vi.advanceTimersByTime(1);
        expect(messages(service)).toEqual([]);
        expect(INFO_TOAST_MS).toBe(4000);
    });

    it("keeps an error toast until it is dismissed", () => {
        const service = createToastService();
        const id = service.error("Import failed");
        vi.advanceTimersByTime(60_000);
        expect(messages(service)).toEqual(["error: Import failed"]);
        service.dismiss(id);
        expect(messages(service)).toEqual([]);
    });

    it("queues toasts in order and expires each on its own clock", () => {
        const service = createToastService();
        service.info("Saved");
        vi.advanceTimersByTime(1000);
        service.error("Export failed");
        service.info("Exported 3 files");
        expect(messages(service)).toEqual([
            "info: Saved",
            "error: Export failed",
            "info: Exported 3 files",
        ]);
        vi.advanceTimersByTime(3000);
        expect(messages(service)).toEqual(["error: Export failed", "info: Exported 3 files"]);
        vi.advanceTimersByTime(1000);
        expect(messages(service)).toEqual(["error: Export failed"]);
    });

    it("does not stack a message that is already shown, and restarts its clock", () => {
        const service = createToastService();
        const first = service.info("Saved");
        vi.advanceTimersByTime(3000);
        expect(service.info("Saved")).toBe(first);
        expect(messages(service)).toEqual(["info: Saved"]);
        vi.advanceTimersByTime(3000);
        expect(messages(service)).toEqual(["info: Saved"]);
        vi.advanceTimersByTime(1000);
        expect(messages(service)).toEqual([]);
        expect(service.error("Failed")).toBe(service.error("Failed"));
    });

    it("notifies subscribers of every change", () => {
        const service = createToastService();
        const counts: number[] = [];
        service.store.subscribe((state) => counts.push(state.toasts.length));
        const id = service.error("Failed");
        service.dismiss(id);
        expect(counts).toEqual([1, 0]);
    });
});

describe("WebGPU detection (DESIGN §7, WebGPU required)", () => {
    it("reports a missing navigator.gpu without waiting", async () => {
        expect(initialWebGpuSupport({})).toEqual({ status: "unsupported", reason: "no-api" });
        expect(await detectWebGpu({})).toEqual({ status: "unsupported", reason: "no-api" });
    });

    it("checks adapter acquisition when the API exists", async () => {
        const gpu = { requestAdapter: () => Promise.resolve({}) };
        expect(initialWebGpuSupport({ gpu })).toEqual({ status: "checking" });
        expect(await detectWebGpu({ gpu })).toEqual({ status: "supported" });
    });

    it("reports a null adapter as unsupported", async () => {
        const gpu = { requestAdapter: () => Promise.resolve(null) };
        expect(await detectWebGpu({ gpu })).toEqual({
            status: "unsupported",
            reason: "no-adapter",
        });
    });

    it("reports a rejected or throwing adapter request as unsupported, with the error", async () => {
        const rejecting = { requestAdapter: () => Promise.reject(new Error("blocked")) };
        expect(await detectWebGpu({ gpu: rejecting })).toEqual({
            status: "unsupported",
            reason: "no-adapter",
            detail: "Error: blocked",
        });
        const throwing = {
            requestAdapter: (): Promise<object | null> => {
                throw new TypeError("not allowed");
            },
        };
        expect(await detectWebGpu({ gpu: throwing })).toMatchObject({
            status: "unsupported",
            reason: "no-adapter",
        });
    });
});
