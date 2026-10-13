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
