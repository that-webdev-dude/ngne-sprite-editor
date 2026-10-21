/**
 * Results and failures of work the app does on its own time (DESIGN §4: "a toast reports the
 * result of an explicit command … and asynchronous failures"): a file saved, a file that could
 * not be opened. The app says what to report; the interface shows it as a toast. `app` does
 * not import `ui`, so the interface attaches the sink that shows them (`attachNoticeSink`).
 * While none is attached, a notice goes to the console; one sent `untilShown` is also kept
 * and given to the first sink attached (SE-071).
 */
export type NoticeKind = "info" | "error";

export type NoticeSink = (kind: NoticeKind, message: string) => void;

export interface NoticeOptions {
    /**
     * Sent while no sink is attached, the notice is kept and given to the first sink
     * attached, so that it reaches the user once the interface shows notices (SE-071: a
     * storage write that failed before the toasts were ready).
     */
    untilShown?: boolean;
}

export interface Notices {
    /** A result: shown for a few seconds. */
    info(message: string): void;
    /** A failure: shown until dismissed. */
    error(message: string, options?: NoticeOptions): void;
    /** Adds a sink that shows the notices; returns the function that removes it. */
    attachSink(sink: NoticeSink): () => void;
}

export function createNotices(): Notices {
    const sinks = new Set<NoticeSink>();
    const pending: [NoticeKind, string][] = [];
    const report = (kind: NoticeKind, message: string, options: NoticeOptions = {}) => {
        if (sinks.size === 0) {
            (kind === "error" ? console.error : console.info)(message);
            if (options.untilShown) pending.push([kind, message]);
            return;
        }
        for (const sink of [...sinks]) sink(kind, message);
    };
    return {
        info: (message) => report("info", message),
        error: (message, options) => report("error", message, options),
        attachSink(sink) {
            const own: NoticeSink = (kind, message) => sink(kind, message);
            sinks.add(own);
            for (const [kind, message] of pending.splice(0)) own(kind, message);
            return () => {
                sinks.delete(own);
            };
        },
    };
}

/** The notices of the app. */
export const notices = createNotices();
