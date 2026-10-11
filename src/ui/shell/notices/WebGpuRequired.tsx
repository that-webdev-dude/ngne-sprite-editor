import "./notice.css";

export interface WebGpuRequiredProps {
    /** `no-api`: `navigator.gpu` is missing. `no-adapter`: adapter acquisition failed. */
    reason: "no-api" | "no-adapter";
    /** Error text from the browser, when there is one. */
    detail?: string;
}

const MISSING: Record<WebGpuRequiredProps["reason"], string> = {
    "no-api": "This browser does not provide WebGPU (navigator.gpu is missing).",
    "no-adapter":
        "This browser provides WebGPU, but no graphics adapter is available: graphics acceleration is off, or the GPU or its driver is blocked.",
};

/**
 * Full-window notice shown instead of the editor (DESIGN §7): what is missing, supported
 * browsers, how to enable acceleration.
 */
export function WebGpuRequired({ reason, detail }: WebGpuRequiredProps) {
    return (
        <main className="notice" data-notice="webgpu-required">
            <div className="notice__content">
                <h1 className="notice__title">WebGPU required</h1>
                <p>
                    NGNE Sprite Editor draws with the NGNE engine, which runs on WebGPU only; there
                    is no fallback renderer.
                </p>
                <h2 className="notice__heading">What is missing</h2>
                <p data-notice-reason={reason}>{MISSING[reason]}</p>
                {detail ? <p className="notice__detail">{detail}</p> : null}
                <h2 className="notice__heading">Supported browsers</h2>
                <p>
                    Desktop Chrome or Edge, current stable version, with the page opened over HTTPS
                    or from localhost.
                </p>
                <h2 className="notice__heading">How to enable acceleration</h2>
                <ol className="notice__list">
                    <li>
                        In the browser settings, under System, turn on graphics (hardware)
                        acceleration.
                    </li>
                    <li>Restart the browser and open this page again.</li>
                    <li>
                        If the notice remains, open chrome://gpu (edge://gpu) and check the WebGPU
                        line; updating the graphics driver usually resolves a disabled or blocked
                        adapter.
                    </li>
                </ol>
            </div>
        </main>
    );
}
