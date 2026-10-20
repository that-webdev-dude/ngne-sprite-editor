import { useEffect, useRef, useState } from "react";
import type { RecoveryEntry, RecoveryRequest } from "../../app/autosave/dialogs";
import type { PixelBuffer } from "../../core/model";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import "./recovery.css";

/** The box a thumbnail fits in, in CSS pixels. */
const BOX = 48;

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The composite of the first frame, magnified by a whole number or fitted into the box. */
function Thumbnail({ image, name }: { image: PixelBuffer; name: string }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const context = canvas.current?.getContext("2d");
        if (!context) return;
        const data = new ImageData(image.width, image.height);
        data.data.set(image.data);
        context.putImageData(data, 0, 0);
    }, [image]);
    const fit = BOX / Math.max(image.width, image.height);
    const zoom = fit >= 1 ? Math.floor(fit) : fit;
    return (
        <span className="recovery__thumbnail">
            <canvas
                ref={canvas}
                width={image.width}
                height={image.height}
                style={{ width: image.width * zoom, height: image.height * zoom }}
                role="img"
                aria-label={`${name}, first frame`}
                data-recovery-thumbnail=""
            />
        </span>
    );
}

/** Asks a row to take the focus: its first action (Recover, or Cancel while it asks). */
interface FocusRequest {
    readonly key: string;
    /** Tells two requests for the same row apart. */
    readonly serial: number;
}

function Row({
    entry,
    request,
    busy,
    focus,
    onWork,
}: {
    entry: RecoveryEntry;
    request: RecoveryRequest;
    busy: boolean;
    focus: FocusRequest | null;
    /** Runs `task` with the rows disabled; when it succeeds, the row goes. */
    onWork(task: () => Promise<boolean>): void;
}) {
    const [confirming, setConfirming] = useState(false);
    const first = useRef<HTMLButtonElement>(null);
    const asked = useRef(false);
    // The question's Cancel takes the focus when the row asks, Recover when it stops asking.
    useEffect(() => {
        if (!asked.current && !confirming) return;
        asked.current = true;
        first.current?.focus();
    }, [confirming]);
    // Asked for by the dialog (after a row went, or when an action failed); once enabled.
    useEffect(() => {
        if (focus?.key === entry.key && !busy) first.current?.focus();
    }, [focus, entry.key, busy]);
    const time = new Date(entry.savedAt);
    return (
        <li className="recovery__entry" data-recovery-entry={entry.name}>
            <Thumbnail image={entry.thumbnail} name={entry.name} />
            <span className="recovery__text">
                <span className="recovery__name">{entry.name}</span>
                <time className="recovery__time" dateTime={time.toISOString()}>
                    {timeFormat.format(time)}
                </time>
            </span>
            <span className="recovery__actions">
                {confirming ? (
                    <>
                        <span className="recovery__question">Discard permanently?</span>
                        <Button ref={first} disabled={busy} onClick={() => setConfirming(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="danger"
                            disabled={busy}
                            onClick={() => onWork(() => request.discard(entry.key))}
                        >
                            Discard
                        </Button>
                    </>
                ) : (
                    <>
                        <Button
                            ref={first}
                            variant="primary"
                            disabled={busy}
                            onClick={() => onWork(() => request.recover(entry.key))}
                        >
                            Recover
                        </Button>
                        <Button disabled={busy} onClick={() => setConfirming(true)}>
                            Discard
                        </Button>
                    </>
                )}
            </span>
        </li>
    );
}

/**
 * The recovery dialog (DESIGN §7): the documents left with unsaved changes, newest first, each
 * with its name, the time of its snapshot and a thumbnail, and Recover / Discard. Discard is
 * confirmed once in its row, since undo cannot bring a snapshot back; the question's Cancel
 * takes the focus. A row goes once its action succeeds (or another tab has its snapshot), the
 * focus going to the next row's Recover, or to Close when no row follows; the dialog closes
 * with the last row. Close and Escape keep the snapshots left for the next launch.
 */
export function RecoveryDialog({ request }: { request: RecoveryRequest }) {
    const [entries, setEntries] = useState(request.entries);
    const [busy, setBusy] = useState(false);
    const [focus, setFocus] = useState<FocusRequest | null>(null);
    const [focusClose, setFocusClose] = useState(0);
    const close = useRef<HTMLButtonElement>(null);
    const serial = useRef(0);
    useEffect(() => {
        if (focusClose > 0) close.current?.focus();
    }, [focusClose]);
    const work = (key: string, task: () => Promise<boolean>) => {
        setBusy(true);
        void task().then((done) => {
            setBusy(false);
            const index = entries.findIndex((entry) => entry.key === key);
            if (!done) {
                // Its action was disabled while it ran: the row takes the focus back.
                setFocus({ key, serial: ++serial.current });
                return;
            }
            const rest = entries.filter((entry) => entry.key !== key);
            setEntries(rest);
            if (rest.length === 0) {
                request.answer(null);
                return;
            }
            const next = rest[index];
            if (next) setFocus({ key: next.key, serial: ++serial.current });
            else setFocusClose((count) => count + 1);
        });
    };
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Recover unsaved work?"
            actions={
                <Button ref={close} onClick={() => request.answer(null)}>
                    Close
                </Button>
            }
        >
            <p>
                {entries.length === 1 ? "This document" : "These documents"} had unsaved changes
                when the editor was last closed.
            </p>
            <ul className="recovery__list" aria-label="Recoverable documents">
                {entries.map((entry) => (
                    <Row
                        key={entry.key}
                        entry={entry}
                        request={request}
                        busy={busy}
                        focus={focus}
                        onWork={(task) => work(entry.key, task)}
                    />
                ))}
            </ul>
        </Dialog>
    );
}
