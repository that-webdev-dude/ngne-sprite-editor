import { describe, expect, it, vi } from "vitest";
import {
    consoleError,
    instanceDiagnostic,
    oncePerMessage,
    RENDERER_REPLACED_MESSAGE,
    RendererReplaced,
    viewportDiagnostic,
} from "../../src/engine/viewport/diagnostics";

// SE-071 (from the SE-011 review): NGNE's diagnostic for a renderer that could not recover
// says "Reload to create a new renderer", but the viewport replaces a failed renderer itself
// (SPEC §6.4). The toast says that instead; the console keeps NGNE's error.

const ngneFailure = new Error("WebGPU recovery failed. Reload to create a new renderer");

describe("the diagnostic of a renderer that failed", () => {
    it("is reported in the viewport's words, with NGNE's error as its cause", () => {
        const reported = instanceDiagnostic(ngneFailure, "failed");
        expect(reported).toBeInstanceOf(RendererReplaced);
        expect((reported as Error).message).toBe(RENDERER_REPLACED_MESSAGE);
        expect((reported as Error).message).not.toMatch(/reload/i);
        expect((reported as Error).cause).toBe(ngneFailure);
        expect(consoleError(reported)).toBe(ngneFailure);
    });

    it("leaves every other diagnostic as NGNE reported it", () => {
        for (const status of ["ready", "recovering", "initializing", undefined]) {
            expect(instanceDiagnostic(ngneFailure, status)).toBe(ngneFailure);
        }
        const upload = new Error("upload failed");
        expect(consoleError(upload)).toBe(upload);
    });

    it("keeps the viewport's words when an upload or a frame rejects with it later", () => {
        const failure = new Error("WebGPU recovery failed. Reload to create a new renderer");
        // Before the renderer reported it, NGNE's error is any other error.
        expect(viewportDiagnostic(failure)).toBe(failure);
        const report = vi.fn();
        const shared = oncePerMessage(report);
        const viewportReport = (error: unknown) => shared(viewportDiagnostic(error));
        viewportReport(instanceDiagnostic(failure, "failed"));
        const later = viewportDiagnostic(failure);
        expect(later).toBeInstanceOf(RendererReplaced);
        expect((later as Error).cause).toBe(failure);
        viewportReport(failure);
        viewportReport(failure);
        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0]![0]).toBe(RENDERER_REPLACED_MESSAGE);
        // Another error with the same text, never reported by a failed renderer, is not changed.
        const other = new Error(failure.message);
        expect(viewportDiagnostic(other)).toBe(other);
        viewportReport(other);
        expect(report).toHaveBeenCalledTimes(2);
        expect(report.mock.calls[1]![0]).toBe(failure.message);
    });

    it("is shown once however often a renderer fails", () => {
        const report = vi.fn();
        const once = oncePerMessage(report);
        once(instanceDiagnostic(ngneFailure, "failed"));
        once(instanceDiagnostic(new Error("WebGPU recovery failed. Other cause"), "failed"));
        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0]![0]).toBe(RENDERER_REPLACED_MESSAGE);
    });
});
