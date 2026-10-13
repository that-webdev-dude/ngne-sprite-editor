import type { TextureTarget } from "../../src/engine/UploadQueue";
import type {
    ViewportChecker,
    ViewportDocument,
    ViewportPort,
    ViewportView,
} from "../../src/engine/viewport/types";

// Shared by the SE-011 unit tests: stand-ins for the renderer and the viewport.

/** An `ImageBitmap` as far as the upload queue uses one. */
export interface FakeBitmap {
    label: string;
    closed: boolean;
    close(): void;
}

export function bitmap(label: string): FakeBitmap & ImageBitmap {
    const fake: FakeBitmap = {
        label,
        closed: false,
        close() {
            fake.closed = true;
        },
    };
    return fake as FakeBitmap & ImageBitmap;
}

/** One `texture()` call a test settles by hand. */
export interface TextureCall {
    id: string;
    source: FakeBitmap;
    signal: AbortSignal | undefined;
    resolve(): void;
    reject(error: unknown): void;
}

/** A renderer whose uploads stay in flight until the test resolves or rejects them. */
export class FakeRenderer implements TextureTarget {
    readonly calls: TextureCall[] = [];
    /** False: an aborted call stays in flight until the test settles it. */
    readonly #rejectsOnAbort: boolean;

    constructor(options: { rejectsOnAbort?: boolean } = {}) {
        this.#rejectsOnAbort = options.rejectsOnAbort ?? true;
    }

    texture(id: string, source: ImageBitmap, signal?: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            const call: TextureCall = {
                id,
                source: source as unknown as FakeBitmap,
                signal,
                resolve,
                reject,
            };
            this.calls.push(call);
            // As NGNE does: an abort rejects the call.
            if (this.#rejectsOnAbort) {
                signal?.addEventListener("abort", () =>
                    reject(new DOMException("aborted", "AbortError")),
                );
            }
        });
    }

    /** The call in flight for a slot. */
    inFlight(id: string): TextureCall {
        const call = this.calls.filter((entry) => entry.id === id).pop();
        if (!call) throw new Error(`No texture() call for ${id}`);
        return call;
    }
}

/** Lets every microtask and promise reaction queued so far run. */
export function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Whether `work` finishes within a few turns of the event loop. Work that waits for
 * something that never comes gives false; work that spins on microtasks lets no timer fire,
 * and the test then ends at its timeout.
 */
export async function ends(work: () => Promise<void>, turns = 5): Promise<boolean> {
    let done = false;
    void work().then(() => {
        done = true;
    });
    for (let turn = 0; turn < turns && !done; turn++) await flush();
    return done;
}

/** A viewport that records what it is told. */
export class RecordingViewport implements ViewportPort {
    readonly calls: string[] = [];
    document: ViewportDocument | null = null;
    current: string | null = null;
    view: ViewportView | null = null;
    checker: ViewportChecker | null = null;
    background: number | null = null;
    readonly invalidated: (readonly string[] | "all")[] = [];

    setDocument(document: ViewportDocument | null): void {
        this.calls.push(document ? `document ${document.width}x${document.height}` : "document -");
        this.document = document;
        // As the viewport does: the frame key went with the document left.
        this.current = null;
    }

    setCurrent(key: string | null): void {
        this.calls.push(`current ${key ?? "-"}`);
        this.current = key;
    }

    invalidate(keys: readonly string[] | "all"): void {
        this.calls.push(`invalidate ${keys === "all" ? "all" : keys.join(",")}`);
        this.invalidated.push(keys);
    }

    setView(view: ViewportView): void {
        this.calls.push(`view ${view.scale}@${view.originX},${view.originY}`);
        this.view = view;
    }

    setChecker(checker: ViewportChecker): void {
        this.calls.push(
            `checker ${checker.a.toString(16)}/${checker.b.toString(16)}/${checker.size}`,
        );
        this.checker = checker;
    }

    setBackground(colour: number): void {
        this.calls.push(`background ${colour.toString(16)}`);
        this.background = colour;
    }

    /** The calls made since the last `take`. */
    take(): string[] {
        return this.calls.splice(0);
    }
}
