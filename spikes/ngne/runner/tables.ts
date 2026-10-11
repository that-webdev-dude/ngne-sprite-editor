// Rebuilds the generated blocks of docs/spikes/SE-002-ngne-integration.md from the raw data
// in docs/spikes/data/se-002-<gpu>.json, so recording a run needs no transcription.
//
//   node spikes/ngne/runner/tables.ts
//
// A block is the text between `<!-- generated:NAME:begin -->` and `<!-- generated:NAME:end -->`.
// Blocks: status, summary, environment, q1 … q11. Everything outside the blocks is left as it is.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GpuId, PageResult, QuestionRecord, SpikeData } from "../lib/types.ts";
import { QUESTIONS, type QuestionMeta } from "./questions.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DOCUMENT = resolve(root, "docs/spikes/SE-002-ngne-integration.md");
const GPUS: readonly { id: GpuId; label: string }[] = [
    { id: "intel-uhd", label: "Intel UHD" },
    { id: "rtx-4060", label: "RTX 4060" },
    { id: "swiftshader", label: "SwiftShader" },
];

function load(id: GpuId): SpikeData | undefined {
    const file = resolve(root, `docs/spikes/data/se-002-${id}.json`);
    if (!existsSync(file)) return undefined;
    const data = JSON.parse(readFileSync(file, "utf8")) as SpikeData;
    if (data.format !== "se-002-spike-data" || data.gpu !== id)
        throw new Error(`${file} is not SE-002 data for ${id}`);
    return data;
}

const data = new Map(GPUS.map((gpu) => [gpu.id, load(gpu.id)]));
const record = (id: GpuId, question: number): QuestionRecord | undefined =>
    data.get(id)?.questions[String(question)];

const cell = (text: string): string => text.replaceAll("|", "\\|").replaceAll("\n", " ");
const row = (cells: readonly string[]): string => `| ${cells.map(cell).join(" | ")} |`;
function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
    return [row(header), row(header.map(() => "---")), ...rows.map(row)].join("\n");
}

/** GPUs whose result decides the question: both reference GPUs, and SwiftShader where marked S. */
function deciding(question: QuestionMeta): GpuId[] {
    // Question 1's threshold is defined on Intel UHD; the other GPUs are recorded.
    if (question.number === 1) return ["intel-uhd"];
    return question.swiftShader
        ? ["intel-uhd", "rtx-4060", "swiftshader"]
        : ["intel-uhd", "rtx-4060"];
}

const labelOf = (id: GpuId): string => GPUS.find((gpu) => gpu.id === id)?.label ?? id;

function resultWord(found: QuestionRecord | undefined): string {
    if (!found) return "not measured";
    if (!found.complete) return "incomplete run";
    return found.pass ? "go" : "no-go";
}

function verdict(question: QuestionMeta): { word: string; consequence: string } {
    const decides = deciding(question);
    const failed = decides.filter((id) => {
        const found = record(id, question.number);
        return found && !found.pass;
    });
    const missing = decides.filter((id) => !record(id, question.number));
    if (failed.length)
        return {
            word:
                `**no-go** (${failed.map(labelOf).join(", ")})` +
                (missing.length ? `; ${missing.map(labelOf).join(", ")} not measured` : ""),
            consequence: question.noGo,
        };
    if (missing.length)
        return {
            word: `pending: ${missing.map(labelOf).join(", ")}`,
            consequence: `Go: ${question.go} No-go: ${question.noGo}`,
        };
    return { word: "**go**", consequence: question.go };
}

const line = (result: PageResult | undefined, start: string): string =>
    result?.summary.find((entry) => entry.label.startsWith(start))?.value ?? "?";
const run = (found: QuestionRecord, variant: string): PageResult | undefined =>
    found.runs.find((result) => result.variant === variant);

/** The few numbers of a question shown in the summary table. */
function headline(question: number, found: QuestionRecord): string {
    const first = found.runs[0];
    const all = (start: string) => found.runs.map((result) => line(result, start)).join(", ");
    switch (question) {
        case 1:
            return (
                `256²: p95 to submitted ${line(first, "256² to render() submitted").split(" / ")[1] ?? "?"} ms, ` +
                `${line(first, "256² sustained").split(" ")[0] ?? "?"} replacements/s`
            );
        case 2:
            return (
                `superseded ${line(first, "Overlapping calls")}; largest publish gap ` +
                `${line(first, "Queue stream: largest gap")} ms; stale renders ` +
                `${line(first, "Queue stream: stale renders").split(" / ")[0] ?? "?"}`
            );
        case 3:
            return `exact cases at DPR 1, 1.25, 1.5, 2: ${all("pixelSnap off: exact cases")}`;
        case 4: {
            const parts = found.parts ?? {};
            const word = (key: string) => (parts[key] ? "go" : "no-go");
            const stages = ["detached", "detached-redraw", "stacked"].map(
                (stage) =>
                    `${stage} ${word(`a ${stage}`)}, median ` +
                    `${line(run(found, `a ${stage} auto`), `(a) ${stage}: swap time`).split(" / ")[0] ?? "?"} ms`,
            );
            return (
                `(a) ${word("a")}: ${stages.join("; ")}. (b) ${word("b")}: ` +
                `${line(run(found, "b DPR 1"), "(b) resizes with exact readback")} resizes exact, ` +
                `${line(run(found, "b DPR 1"), "(b) devices created")} device`
            );
        }
        case 5:
            return (
                `diagnostics (dropped ticks / other) ${line(first, "Diagnostics")}; viewport wrong draws ` +
                `${line(first, "Viewport draws").split(" / ")[1] ?? "?"}; preview wrong frames ` +
                `${line(first, "Preview frames exact").split(" / ")[1] ?? "?"}`
            );
        case 6:
            return (
                `ungated: ${line(first, "Ungated: diagnostics").split(" / ")[0] ?? "?"} diagnostic, ` +
                `${line(first, "Ungated: sprites")} sprites/draw calls; gated: ${line(first, "Gated")} diagnostics`
            );
        case 7:
            return found.runs
                .map(
                    (result) =>
                        `${result.variant}: readback ${line(result, "Readback after render()")} px differ, ` +
                        `afterFrame wrong ${line(result, "Readback in afterFrame").split(" / ")[1] ?? "?"}, ` +
                        `screenshots ${line(result, "Screenshot of the bare")}/${line(result, "Screenshot of the BrowserGame")}`,
                )
                .join("; ");
        case 8:
            return (
                `ready after ${line(first, "Back to ready")} ms; idle viewport redrawn ` +
                `${line(first, "Idle viewport, status polled")} losses`
            );
        case 9:
            return (
                `snap off ${line(first, "Snap off")}; default snap, even rects ` +
                `${line(first, "Default snap, even rects")}; odd rect differs by ` +
                `${line(first, "Default snap, odd")} px`
            );
        case 10:
            return `status "${line(first, "Page status")}", error text ${line(first, "Error text")}`;
        case 11:
            return `${line(first, "Above baseline")} bytes above baseline after 1×1 replacement`;
        default:
            return "";
    }
}

function gpuCell(question: QuestionMeta, id: GpuId): string {
    const found = record(id, question.number);
    if (!found) return "not measured";
    const decides = deciding(question).includes(id);
    return `${resultWord(found)}${decides ? "" : " (recorded)"}: ${headline(question.number, found)}`;
}

function summaryBlock(): string {
    return table(
        [
            "#",
            "Question",
            "Method",
            "Go threshold",
            ...GPUS.map((gpu) => gpu.label),
            "Go / no-go",
            "Consequence for the spec",
        ],
        QUESTIONS.map((question) => {
            const result = verdict(question);
            return [
                String(question.number),
                question.title + (question.swiftShader ? " (S)" : ""),
                question.method,
                question.threshold,
                ...GPUS.map((gpu) => gpuCell(question, gpu.id)),
                result.word,
                result.consequence,
            ];
        }),
    );
}

function environmentBlock(): string {
    const value = (id: GpuId, read: (found: SpikeData) => string): string => {
        const found = data.get(id);
        return found ? read(found) : "not measured";
    };
    const rows: [string, (found: SpikeData) => string][] = [
        ["Recorded (UTC)", (found) => found.recordedAt],
        ["Commit", (found) => found.commit],
        ["Command", (found) => `\`${found.command}\``],
        ["Raw data", (found) => `[data/se-002-${found.gpu}.json](data/se-002-${found.gpu}.json)`],
        [
            "WebGPU adapter (vendor / architecture)",
            (found) =>
                `${found.environment.adapter.vendor} / ${found.environment.adapter.architecture}`,
        ],
        ["Fallback adapter", (found) => String(found.environment.adapter.isFallbackAdapter)],
        [
            "Chrome",
            (found) =>
                `${found.environment.chrome}, ${found.environment.headless ? "new headless" : "headed"}`,
        ],
        [
            "Chrome arguments",
            (found) =>
                `\`${found.environment.chromeArgs.join(" ")}\` and \`--force-device-scale-factor=<DPR>\``,
        ],
        ["OS", (found) => found.environment.gpuPage["Operating system"] ?? found.environment.os],
        ["CPU", (found) => found.environment.cpu],
        ["Memory (GB)", (found) => String(found.environment.memoryGb)],
        ["GPU0 (chrome://gpu)", (found) => found.environment.gpuPage.GPU0 ?? ""],
        ["GPU1 (chrome://gpu)", (found) => found.environment.gpuPage.GPU1 ?? ""],
        ["GL_RENDERER (compositor)", (found) => found.environment.gpuPage.GL_RENDERER ?? ""],
        ["Node", (found) => found.environment.node],
        [
            "@ngne/core / Playwright / Vite",
            (found) =>
                `${found.environment.ngne} / ${found.environment.playwright} / ${found.environment.vite}`,
        ],
    ];
    return table(
        ["", ...GPUS.map((gpu) => gpu.label)],
        rows.map(([name, read]) => [name, ...GPUS.map((gpu) => value(gpu.id, read))]),
    );
}

function questionBlock(question: QuestionMeta): string {
    const result = verdict(question);
    const out: string[] = [];
    const words = GPUS.map((gpu) => {
        const found = record(gpu.id, question.number);
        const decides = deciding(question).includes(gpu.id);
        return `${gpu.label} ${resultWord(found)}${found && !decides ? " (recorded, does not decide)" : ""}`;
    });
    out.push(`Result: ${result.word}. ${words.join(" · ")}.`, "");

    // One row per number; a question with several runs prefixes the run's label.
    const labels: string[] = [];
    const values = new Map<string, Map<GpuId, string>>();
    for (const gpu of GPUS)
        for (const pageResult of record(gpu.id, question.number)?.runs ?? [])
            for (const entry of pageResult.summary) {
                const label = (pageResult.variant ? `[${pageResult.variant}] ` : "") + entry.label;
                if (!values.has(label)) {
                    values.set(label, new Map());
                    labels.push(label);
                }
                values.get(label)?.set(gpu.id, entry.value);
            }
    if (labels.length)
        out.push(
            table(
                ["Measure", ...GPUS.map((gpu) => gpu.label)],
                labels.map((label) => [
                    label,
                    ...GPUS.map((gpu) =>
                        data.get(gpu.id)?.questions[String(question.number)]
                            ? (values.get(label)?.get(gpu.id) ?? "")
                            : "not measured",
                    ),
                ]),
            ),
            "",
        );

    const failed: string[] = [];
    for (const gpu of GPUS)
        for (const pageResult of record(gpu.id, question.number)?.runs ?? [])
            for (const check of pageResult.checks)
                if (!check.pass)
                    failed.push(
                        `- ${gpu.label}${pageResult.variant ? `, ${pageResult.variant}` : ""} — ` +
                            `${check.binding ? "**failed**" : "recorded"}: ${check.name}` +
                            (check.detail ? ` — ${check.detail}` : ""),
                    );
    out.push(
        failed.length
            ? `Checks that did not hold (failed checks decide the result; recorded ones do not):\n\n${failed.join("\n")}`
            : "Every check held on the GPUs measured.",
    );
    return out.join("\n");
}

/** Which runs are recorded, and what the eleven verdicts add up to. */
function statusBlock(): string {
    const lines = GPUS.map((gpu) => {
        const found = data.get(gpu.id);
        return found
            ? `- ${gpu.label}: recorded ${found.recordedAt} at commit ${found.commit}.`
            : `- ${gpu.label}: **not measured yet**.`;
    });
    const words = QUESTIONS.map((question) => ({ question, word: verdict(question).word }));
    const numbers = (start: string) =>
        words
            .filter((entry) => entry.word.startsWith(start))
            .map((entry) => entry.question.number)
            .join(", ");
    const noGo = numbers("**no-go**");
    const pending = numbers("pending");
    lines.push(
        noGo
            ? `- Questions: no-go for ${noGo}` +
                  (pending ? `; waiting for results: ${pending}.` : ".")
            : pending
              ? `- Questions: none decided as no-go; waiting for results: ${pending}.`
              : "- Questions: all eleven go.",
    );
    return lines.join("\n");
}

let text = readFileSync(DOCUMENT, "utf8");
function replaceBlock(name: string, content: string): void {
    const begin = `<!-- generated:${name}:begin -->`;
    const end = `<!-- generated:${name}:end -->`;
    const from = text.indexOf(begin);
    const to = text.indexOf(end);
    if (from < 0 || to < from) throw new Error(`Block ${name} not found in ${DOCUMENT}`);
    text = `${text.slice(0, from + begin.length)}\n${content}\n${text.slice(to)}`;
}

replaceBlock("status", statusBlock());
replaceBlock("summary", summaryBlock());
replaceBlock("environment", environmentBlock());
for (const question of QUESTIONS) replaceBlock(`q${question.number}`, questionBlock(question));
writeFileSync(DOCUMENT, text);
console.log(
    `Tables rebuilt in ${DOCUMENT} from: ` +
        GPUS.map((gpu) => `${gpu.label} ${data.get(gpu.id) ? "recorded" : "not measured"}`).join(
            ", ",
        ),
);
