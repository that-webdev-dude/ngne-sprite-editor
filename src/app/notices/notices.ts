/**
 * Results and failures of work the app does on its own time (DESIGN §4: "a toast reports the
 * result of an explicit command … and asynchronous failures"): a file saved, a file that could
 * not be opened. The app says what to report; the interface shows it as a toast. `app` does
 * not import `ui`, so the interface attaches the sink that shows them (`attachNoticeSink`).
 * While none is attached, a notice goes to the console.
 */
export type NoticeKind = "info" | "error";

export type NoticeSink = (kind: NoticeKind, message: string) => void;

export interface Notices {
    /** A result: shown for a few seconds. */
    info(message: string): void;
    /** A failure: shown until dismissed. */
    error(message: string): void;
    /** Adds a sink that shows the notices; returns the function that removes it. */
    attachSink(sink: NoticeSink): () => void;
}

export function createNotices(): Notices {
    const sinks = new Set<NoticeSink>();
    const report = (kind: NoticeKind, message: string) => {
        if (sinks.size === 0) {
            (kind === "error" ? console.error : console.info)(message);
            return;
        }
        for (const sink of [...sinks]) sink(kind, message);
    };
    return {
        info: (message) => report("info", message),
        error: (message) => report("error", message),
        attachSink(sink) {
            const own: NoticeSink = (kind, message) => sink(kind, message);
            sinks.add(own);
            return () => {
                sinks.delete(own);
            };
        },
    };
}

/** The notices of the app. */
export const notices = createNotices();
