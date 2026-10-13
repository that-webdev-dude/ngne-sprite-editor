import { describe, expect, it, vi } from "vitest";
import { UploadQueue } from "../../src/engine/UploadQueue";
import type { Upload } from "../../src/engine/UploadQueue";
import { bitmap, ends, FakeRenderer, flush } from "./se-011-support";
import type { FakeBitmap } from "./se-011-support";

// SE-011: the upload queue of SPEC §6.4 — single-flight and latest-wins per slot, the source
// bitmap closed when its upload settles, which rejections are ignored, and what a slot is
// said to show.

interface Harness {
    renderer: FakeRenderer;
    queue: UploadQueue<string>;
    published: string[];
    errors: string[];
    /** Bitmaps made by builders, in the order they were built. */
    built: FakeBitmap[];
    /** A builder for an image called `label`. */
    image(label: string): () => Upload<string>;
}

function harness(renderer = new FakeRenderer()): Harness {
    const published: string[] = [];
    const errors: string[] = [];
    const built: FakeBitmap[] = [];
    const queue = new UploadQueue<string>({
        target: renderer,
        onPublish: (slot, tag) => published.push(`${slot}=${tag}`),
        onError: (slot, error) => errors.push(`${slot}: ${String(error)}`),
    });
    return {
        renderer,
        queue,
        published,
        errors,
        built,
        image: (label) => () => {
            const source = bitmap(label);
            built.push(source);
            return { bitmap: source, tag: label };
        },
    };
}

describe("UploadQueue: single flight", () => {
    it("starts the upload of a request in a later microtask and marks the slot busy at once", async () => {
        const { renderer, queue, image, built } = harness();
        queue.request("ed:f:0", image("a"));
        expect(built).toHaveLength(0);
        expect(queue.busy("ed:f:0")).toBe(true);
        expect(queue.pending("ed:f:0")).toBe(true);

        await flush();
        expect(renderer.calls.map((call) => `${call.id}<${call.source.label}`)).toEqual([
            "ed:f:0<a",
        ]);
        expect(queue.pending("ed:f:0")).toBe(false);
        expect(queue.busy("ed:f:0")).toBe(true);
    });

    it("keeps one upload in flight per slot: a later request waits for it", async () => {
        const { renderer, queue, image, published } = harness();
        queue.request("ed:f:0", image("a"));
        await flush();
        queue.request("ed:f:0", image("b"));
        await flush();
        // The second is neither built nor sent while the first is in flight.
        expect(renderer.calls).toHaveLength(1);
        expect(queue.pending("ed:f:0")).toBe(true);

        renderer.inFlight("ed:f:0").resolve();
        await flush();
        expect(renderer.calls.map((call) => call.source.label)).toEqual(["a", "b"]);
        expect(published).toEqual(["ed:f:0=a"]);

        renderer.inFlight("ed:f:0").resolve();
        await flush();
        expect(published).toEqual(["ed:f:0=a", "ed:f:0=b"]);
        expect(queue.busy("ed:f:0")).toBe(false);
        expect(queue.stats).toMatchObject({ requested: 2, started: 2, published: 2, replaced: 0 });
    });

    it("lets slots run side by side", async () => {
        const { renderer, queue, image, published } = harness();
        queue.request("ed:checker", image("checker"));
        queue.request("ed:f:0", image("a"));
        queue.request("ed:f:1", image("b"));
        await flush();
        expect(renderer.calls.map((call) => call.id)).toEqual(["ed:checker", "ed:f:0", "ed:f:1"]);

        renderer.inFlight("ed:f:1").resolve();
        await flush();
        expect(published).toEqual(["ed:f:1=b"]);
        expect(queue.busy("ed:f:1")).toBe(false);
        expect(queue.busy("ed:f:0")).toBe(true);
        expect(queue.busy()).toBe(true);
    });
});

describe("UploadQueue: latest wins", () => {
    it("builds only the newest of the requests that wait behind an upload", async () => {
        const { renderer, queue, image, built, published } = harness();
        queue.request("ed:f:0", image("a"));
        await flush();
        queue.request("ed:f:0", image("b"));
        queue.request("ed:f:0", image("c"));
        queue.request("ed:f:0", image("d"));
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        renderer.inFlight("ed:f:0").resolve();
        await flush();

        // "b" and "c" were replaced before their turn: never built, never uploaded.
        expect(built.map((source) => source.label)).toEqual(["a", "d"]);
        expect(published).toEqual(["ed:f:0=a", "ed:f:0=d"]);
        expect(queue.stats).toMatchObject({ requested: 4, replaced: 2, started: 2, published: 2 });
    });

    it("builds only the last of several requests made in one task", async () => {
        const { renderer, queue, image, built } = harness();
        queue.request("ed:f:0", image("a"));
        queue.request("ed:f:0", image("b"));
        queue.request("ed:f:0", image("c"));
        await flush();
        expect(built.map((source) => source.label)).toEqual(["c"]);
        expect(renderer.calls).toHaveLength(1);
    });

    it("runs the builder when the upload starts, so it reads the state of that moment", async () => {
        const { renderer, queue } = harness();
        let state = "old";
        const current = () => ({ bitmap: bitmap(state), tag: state });
        queue.request("ed:f:0", current);
        state = "newer";
        await flush();
        queue.request("ed:f:0", current);
        state = "newest";
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        expect(renderer.calls.map((call) => call.source.label)).toEqual(["newer", "newest"]);
    });

    it("accepts a builder that returns a promise", async () => {
        const { renderer, queue, published } = harness();
        queue.request("ed:f:0", async () => {
            await flush();
            return { bitmap: bitmap("late"), tag: "late" };
        });
        await flush();
        expect(renderer.calls).toHaveLength(0);
        await flush();
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        expect(published).toEqual(["ed:f:0=late"]);
    });
});

describe("UploadQueue: what a slot shows", () => {
    it("changes `published` only when the matching upload resolves", async () => {
        const { renderer, queue, image } = harness();
        expect(queue.published("ed:f:0")).toBeUndefined();
        queue.request("ed:f:0", image("a"));
        await flush();
        // In flight: the texture is not there yet.
        expect(queue.published("ed:f:0")).toBeUndefined();
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        expect(queue.published("ed:f:0")).toBe("a");

        // A replacement on its way does not change what the slot shows.
        queue.request("ed:f:0", image("b"));
        await flush();
        expect(queue.published("ed:f:0")).toBe("a");
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        expect(queue.published("ed:f:0")).toBe("b");
    });

    it("tells onPublish whether a newer request is already waiting", async () => {
        const renderer = new FakeRenderer();
        const seen: string[] = [];
        const queue: UploadQueue<string> = new UploadQueue<string>({
            target: renderer,
            onPublish: (slot, tag) => seen.push(`${tag} pending=${queue.pending(slot)}`),
        });
        queue.request("ed:f:0", () => ({ bitmap: bitmap("a"), tag: "a" }));
        await flush();
        queue.request("ed:f:0", () => ({ bitmap: bitmap("b"), tag: "b" }));
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        expect(seen).toEqual(["a pending=true", "b pending=false"]);
    });

    it("keeps the previous tag when an upload fails or is ignored", async () => {
        const { renderer, queue, image } = harness();
        queue.request("ed:f:0", image("a"));
        await flush();
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        queue.request("ed:f:0", image("b"));
        await flush();
        renderer.inFlight("ed:f:0").reject(new Error("Texture replacement superseded: ed:f:0"));
        await flush();
        expect(queue.published("ed:f:0")).toBe("a");
    });
});

describe("UploadQueue: the source bitmap", () => {
    it("is closed when its upload resolves, and not before", async () => {
        const { renderer, queue, image, built } = harness();
        queue.request("ed:f:0", image("a"));
        await flush();
        expect(built[0]?.closed).toBe(false);
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        expect(built[0]?.closed).toBe(true);
    });

    it("is closed when its upload rejects, whatever the reason", async () => {
        const { renderer, queue, image, built } = harness();
        const reasons = [
            new Error("Texture replacement superseded: x"),
            new DOMException("aborted", "AbortError"),
            new Error("WebGPU renderer is disposed"),
            new Error("WebGPU resource validation failed"),
        ];
        for (const [index, reason] of reasons.entries()) {
            const slot = `ed:f:${index}`;
            queue.request(slot, image(slot));
            await flush();
            renderer.inFlight(slot).reject(reason);
            await flush();
        }
        expect(built.map((source) => source.closed)).toEqual([true, true, true, true]);
    });

    it("is closed when the queue is disposed during its upload", async () => {
        const { renderer, queue, image, built } = harness();
        queue.request("ed:f:0", image("a"));
        await flush();
        queue.dispose();
        await flush();
        expect(renderer.inFlight("ed:f:0").signal?.aborted).toBe(true);
        expect(built[0]?.closed).toBe(true);
    });
});

describe("UploadQueue: rejections", () => {
    it("ignores superseded, aborted and disposed-renderer rejections and keeps the slot in use", async () => {
        const { renderer, queue, image, errors, published } = harness();
        const reasons = [
            new Error("Texture replacement superseded: ed:f:0"),
            new DOMException("The operation was aborted", "AbortError"),
            new Error("WebGPU renderer is disposed"),
        ];
        for (const reason of reasons) {
            queue.request("ed:f:0", image("ignored"));
            await flush();
            renderer.inFlight("ed:f:0").reject(reason);
            await flush();
        }
        expect(errors).toEqual([]);
        expect(queue.failed("ed:f:0")).toBe(false);
        expect(queue.stats).toMatchObject({ ignored: 3, failed: 0, published: 0 });

        queue.request("ed:f:0", image("next"));
        await flush();
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        expect(published).toEqual(["ed:f:0=next"]);
    });

    it("reports any other rejection once and takes no more uploads for that slot", async () => {
        const { renderer, queue, image, errors, built } = harness();
        queue.request("ed:f:0", image("a"));
        await flush();
        // A request that waits behind the failing upload is dropped with it.
        queue.request("ed:f:0", image("waiting"));
        renderer.inFlight("ed:f:0").reject(new Error("WebGPU resource validation failed"));
        await flush();
        expect(errors).toEqual(["ed:f:0: Error: WebGPU resource validation failed"]);
        expect(queue.failed("ed:f:0")).toBe(true);
        expect(queue.busy("ed:f:0")).toBe(false);

        // Not retried on this renderer: later requests are dropped unbuilt.
        queue.request("ed:f:0", image("again"));
        queue.request("ed:f:0", image("and again"));
        await flush();
        expect(renderer.calls).toHaveLength(1);
        expect(built.map((source) => source.label)).toEqual(["a"]);
        expect(errors).toHaveLength(1);
        expect(queue.stats).toMatchObject({ failed: 1, dropped: 2 });

        // Other slots are not affected, and a fresh queue (a fresh renderer) tries again.
        queue.request("ed:f:1", image("other"));
        await flush();
        expect(renderer.calls.map((call) => call.id)).toEqual(["ed:f:0", "ed:f:1"]);
        const fresh = harness();
        fresh.queue.request("ed:f:0", fresh.image("retry"));
        await flush();
        expect(fresh.renderer.calls.map((call) => call.source.label)).toEqual(["retry"]);
    });

    it("reports a builder that throws and keeps the slot in use", async () => {
        const { renderer, queue, image, errors, published } = harness();
        queue.request("ed:f:0", () => {
            throw new Error("no pixels");
        });
        await flush();
        expect(errors).toEqual(["ed:f:0: Error: no pixels"]);
        expect(renderer.calls).toHaveLength(0);
        expect(queue.failed("ed:f:0")).toBe(false);

        queue.request("ed:f:0", image("fine"));
        await flush();
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        expect(published).toEqual(["ed:f:0=fine"]);
    });
});

describe("UploadQueue: dispose and idle", () => {
    it("forgets waiting requests and ignores what uploads in flight settle with", async () => {
        // This renderer leaves aborted calls in flight, so the test settles them itself.
        const { renderer, queue, image, published, errors, built } = harness(
            new FakeRenderer({ rejectsOnAbort: false }),
        );
        queue.request("ed:f:0", image("a"));
        queue.request("ed:f:1", image("b"));
        await flush();
        queue.request("ed:f:0", image("waiting"));
        queue.dispose();
        await flush();
        expect(built.map((source) => source.closed)).toEqual([false, false]);
        // A renderer that was disposed rejects with its own error, or even resolves.
        renderer.calls[0]?.reject(new Error("Some failure after disposal"));
        renderer.calls[1]?.resolve();
        await flush();

        expect(published).toEqual([]);
        expect(errors).toEqual([]);
        expect(built.map((source) => `${source.label}:${source.closed}`)).toEqual([
            "a:true",
            "b:true",
        ]);
        expect(queue.published("ed:f:1")).toBeUndefined();

        // Nothing is accepted afterwards.
        queue.request("ed:f:2", image("late"));
        await flush();
        expect(renderer.calls).toHaveLength(2);
        expect(queue.busy()).toBe(false);
    });

    it("resolves idle() when nothing is in flight or waiting", async () => {
        const { renderer, queue, image } = harness();
        await queue.idle();

        let idle = false;
        queue.request("ed:f:0", image("a"));
        queue.request("ed:f:1", image("b"));
        void queue.idle().then(() => {
            idle = true;
        });
        await flush();
        queue.request("ed:f:0", image("c"));
        renderer.inFlight("ed:f:0").resolve();
        renderer.inFlight("ed:f:1").resolve();
        await flush();
        // "c" started behind "a": still not idle.
        expect(idle).toBe(false);
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        expect(idle).toBe(true);
    });

    it("resolves idle() at once after dispose", async () => {
        const { queue, image } = harness();
        queue.request("ed:f:0", image("a"));
        await flush();
        const waiting = queue.idle();
        queue.dispose();
        await waiting;
        await queue.idle();
    });

    it("is not busy from the moment it is disposed, whatever is still inside texture()", async () => {
        // The renderer does not reject on abort: the upload stays in flight after dispose.
        const { renderer, queue, image, built, published, errors } = harness(
            new FakeRenderer({ rejectsOnAbort: false }),
        );
        queue.request("ed:f:0", image("a"));
        queue.request("ed:f:1", image("b"));
        await flush();
        queue.request("ed:f:1", image("waiting"));
        expect(queue.busy()).toBe(true);
        expect(queue.busy("ed:f:0")).toBe(true);
        expect(queue.pending("ed:f:1")).toBe(true);

        queue.dispose();
        // In the same task: nothing here can publish any more.
        expect(queue.disposed).toBe(true);
        expect(queue.busy()).toBe(false);
        expect(queue.busy("ed:f:0")).toBe(false);
        expect(queue.busy("ed:f:1")).toBe(false);
        expect(queue.pending("ed:f:1")).toBe(false);

        // The loop a renderer instance waits in ends; it does not spin on a queue that says
        // "busy" and "idle" at once.
        let turns = 0;
        while (queue.busy() && turns < 1000) {
            turns++;
            await queue.idle();
        }
        expect(turns).toBe(0);
        await queue.idle();

        // The calls settle in the background: bitmaps closed, nothing published or reported.
        expect(built.map((source) => source.closed)).toEqual([false, false]);
        renderer.calls[0]?.resolve();
        renderer.calls[1]?.reject(new Error("WebGPU resource validation failed"));
        await flush();
        expect(built.map((source) => `${source.label}:${source.closed}`)).toEqual([
            "a:true",
            "b:true",
        ]);
        expect(published).toEqual([]);
        expect(errors).toEqual([]);
        expect(queue.published("ed:f:0")).toBeUndefined();
        expect(queue.failed("ed:f:1")).toBe(false);
        expect(renderer.calls).toHaveLength(2);
    });

    it("resolves idle() exactly when busy() turns false", async () => {
        const { renderer, queue, image } = harness();
        const seen: boolean[] = [];
        queue.request("ed:f:0", image("a"));
        void queue.idle().then(() => seen.push(queue.busy()));
        await flush();
        expect(seen).toEqual([]);
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        // Busy was already false when the waiter ran.
        expect(seen).toEqual([false]);
    });
});

describe("UploadQueue: callbacks that throw", () => {
    it("reports a throwing onPublish and keeps the slot in use", async () => {
        const reported = vi.spyOn(console, "error").mockImplementation(() => {});
        const renderer = new FakeRenderer();
        const failure = new Error("the listener failed");
        let calls = 0;
        const queue = new UploadQueue<string>({
            target: renderer,
            onPublish: () => {
                calls++;
                if (calls === 1) throw failure;
            },
        });
        queue.request("ed:f:0", () => ({ bitmap: bitmap("a"), tag: "a" }));
        await flush();
        queue.request("ed:f:0", () => ({ bitmap: bitmap("b"), tag: "b" }));
        renderer.inFlight("ed:f:0").resolve();
        await flush();

        // Reported, not lost as an unhandled rejection; the upload itself went through.
        expect(reported.mock.calls.map((call) => call[1])).toEqual([failure]);
        expect(queue.published("ed:f:0")).toBe("a");
        expect(queue.failed("ed:f:0")).toBe(false);
        // The request that waited behind it runs, and the queue comes to rest.
        expect(renderer.calls.map((call) => call.source.label)).toEqual(["a", "b"]);
        renderer.inFlight("ed:f:0").resolve();
        expect(await ends(() => queue.idle())).toBe(true);
        expect(queue.busy()).toBe(false);
        expect(queue.published("ed:f:0")).toBe("b");
        expect(calls).toBe(2);

        // And the slot takes a later request.
        queue.request("ed:f:0", () => ({ bitmap: bitmap("c"), tag: "c" }));
        await flush();
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        expect(queue.published("ed:f:0")).toBe("c");
        reported.mockRestore();
    });

    it("reports a throwing onError and still comes to rest", async () => {
        const reported = vi.spyOn(console, "error").mockImplementation(() => {});
        const renderer = new FakeRenderer();
        const failure = new Error("the error handler failed");
        const queue = new UploadQueue<string>({
            target: renderer,
            onError: () => {
                throw failure;
            },
        });
        // Once for a builder that throws, once for a rejected upload.
        queue.request("ed:f:0", () => {
            throw new Error("no pixels");
        });
        queue.request("ed:f:1", () => ({ bitmap: bitmap("b"), tag: "b" }));
        await flush();
        renderer.inFlight("ed:f:1").reject(new Error("WebGPU resource validation failed"));
        expect(await ends(() => queue.idle())).toBe(true);

        expect(reported.mock.calls.map((call) => call[1])).toEqual([failure, failure]);
        expect(queue.busy()).toBe(false);
        expect(queue.failed("ed:f:0")).toBe(false);
        expect(queue.failed("ed:f:1")).toBe(true);
        // The slot whose builder threw is usable.
        queue.request("ed:f:0", () => ({ bitmap: bitmap("a"), tag: "a" }));
        await flush();
        renderer.inFlight("ed:f:0").resolve();
        await flush();
        expect(queue.published("ed:f:0")).toBe("a");
        reported.mockRestore();
    });
});
