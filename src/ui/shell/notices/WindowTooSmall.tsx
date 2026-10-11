import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from "../layout";
import "./notice.css";

/** Full-window notice shown in place of the layout below 1280×720 (DESIGN §2). */
export function WindowTooSmall({ width, height }: { width: number; height: number }) {
    return (
        <main className="notice" data-notice="window-too-small">
            <div className="notice__content">
                <h1 className="notice__title">Window too small</h1>
                <p>
                    The editor needs a window of at least {MIN_WINDOW_WIDTH} × {MIN_WINDOW_HEIGHT}{" "}
                    CSS pixels; this one is {width} × {height}.
                </p>
                <p>Enlarge the window or reduce the browser zoom.</p>
            </div>
        </main>
    );
}
