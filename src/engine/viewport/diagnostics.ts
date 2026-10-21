// NGNE reports problems through a diagnostic callback and rejects uploads with errors of
// several shapes (`Error`, `GPUError`, plain values). The viewport shows each distinct message
// once (SE-011).

/** The text of whatever NGNE reported. */
export function errorMessage(error: unknown): string {
    if (typeof error === "object" && error !== null && "message" in error) {
        const message = String(error.message);
        if (message) return message;
    }
    return String(error);
}

/**
 * Returns a function that passes an error on with its message the first time that message
 * is seen and drops it afterwards. A `report` that throws is not allowed to reach NGNE.
 */
export function oncePerMessage(
    report: (message: string, error: unknown) => void,
): (error: unknown) => void {
    const seen = new Set<string>();
    return (error) => {
        const message = errorMessage(error);
        if (seen.has(message)) return;
        seen.add(message);
        try {
            report(message, error);
        } catch {
            // Reporting is best effort.
        }
    };
}

/**
 * The text shown when NGNE gives up on a renderer: its own diagnostic says "Reload to create a
 * new renderer", but the viewport replaces a failed renderer itself (SPEC §6.4), so the reload
 * is not needed (SE-071).
 */
export const RENDERER_REPLACED_MESSAGE =
    "The renderer could not recover from a lost GPU device; the viewport replaces it with a new one.";

/** NGNE's diagnostic of a renderer that ended `failed`, as the viewport reports it. */
export class RendererReplaced extends Error {
    override readonly name = "RendererReplaced";

    constructor(cause: unknown) {
        super(RENDERER_REPLACED_MESSAGE, { cause });
    }
}

/**
 * The errors of renderers that ended `failed`. NGNE rejects the renderer's later uploads and
 * frames with the same error, which reaches the viewport by another path.
 */
const rendererFailures = new WeakSet<object>();

/**
 * The diagnostic NGNE reports to an instance: a renderer that has ended `failed` reports why,
 * and the viewport shows its own text for it; anything else is passed on as it is.
 */
export function instanceDiagnostic(error: unknown, status: string | undefined): unknown {
    if (status !== "failed") return error;
    if (typeof error === "object" && error !== null) rendererFailures.add(error);
    return new RendererReplaced(error);
}

/**
 * Any error the viewport reports: a failed renderer's error, which NGNE gave to the
 * instance's diagnostic first (`instanceDiagnostic`), keeps the viewport's text when an
 * upload or a frame rejects with it later; anything else is passed on as it is.
 */
export function viewportDiagnostic(error: unknown): unknown {
    return typeof error === "object" && error !== null && rendererFailures.has(error)
        ? new RendererReplaced(error)
        : error;
}

/** What the console gets for a reported error: NGNE's own error, not the viewport's text. */
export function consoleError(error: unknown): unknown {
    return error instanceof RendererReplaced ? error.cause : error;
}
