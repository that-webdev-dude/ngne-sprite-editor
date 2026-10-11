// Result shapes shared by the spike pages (browser) and the runner (Node). Types only.

export interface AdapterRecord {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
    isFallbackAdapter: boolean | null;
}

/** `binding` checks decide the question's go / no-go; the others are recorded only. */
export interface Check {
    name: string;
    pass: boolean;
    binding: boolean;
    detail: string;
}

/** One human-readable number for the deliverable's tables. */
export interface SummaryLine {
    label: string;
    value: string;
}

export interface PageInfo {
    url: string;
    devicePixelRatio: number;
    viewport: [number, number];
    screen: [number, number];
    visibility: string;
}

export interface PageResult {
    question: number;
    variant: string;
    /** True when every binding check passed. */
    pass: boolean;
    checks: Check[];
    summary: SummaryLine[];
    metrics: Record<string, unknown>;
    samples: Record<string, number[]>;
    /** Uncaught page errors; always empty in a valid run. */
    uncaught: string[];
    /** Adapters NGNE requested a device from (recorded by the `requestDevice` wrap). */
    adapters: AdapterRecord[];
    notes: string[];
    page: PageInfo;
    durationMs: number;
}

export type GpuId = "intel-uhd" | "rtx-4060" | "swiftshader";

export interface QuestionRecord {
    title: string;
    threshold: string;
    /**
     * True when every run of the question passed its binding checks. Question 4 compares two
     * strategies: it is true when at least one of them passed, and `parts` says which.
     */
    pass: boolean;
    /** Verdict of each part of a question that has parts (question 4: a, b and a's variants). */
    parts?: Record<string, boolean>;
    /** False when a page of the question produced no result (a failed run, not a no-go). */
    complete: boolean;
    runs: PageResult[];
}

export interface SpikeData {
    format: "se-002-spike-data";
    version: 1;
    gpu: GpuId;
    recordedAt: string;
    commit: string;
    command: string;
    quick: boolean;
    environment: {
        os: string;
        cpu: string;
        memoryGb: number;
        node: string;
        chrome: string;
        headless: boolean;
        chromeArgs: string[];
        ngne: string;
        playwright: string;
        vite: string;
        adapter: AdapterRecord;
        gpuPage: Record<string, string>;
        dawnAdapters: string[];
    };
    questions: Record<string, QuestionRecord>;
}
