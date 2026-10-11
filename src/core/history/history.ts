import { randomId } from "../model";
import type { DocSession, IdGenerator, Touched } from "../model";
import { defaultPixelAllocator, type PixelAllocator } from "./allocate";
import type { Command } from "./command";
import { TransactionError } from "./errors";
import { beginTransaction, type Transaction, type TransactionOptions } from "./transaction";

/** Memory budget of a history unless another is given: 256 MB (SPEC §5.2). */
export const DEFAULT_HISTORY_BUDGET_BYTES = 256 * 1024 * 1024;

/** Options of a `History`. */
export interface HistoryOptions {
    /** Memory budget in bytes; the default is `DEFAULT_HISTORY_BUDGET_BYTES`. */
    budgetBytes?: number;
    /** Allocates the pixel memory of transactions; a test replaces it to simulate failure. */
    allocate?: PixelAllocator;
}

/** One step of a history, as reported to its subscribers. */
export interface HistoryChange {
    /** "do" is a new command (executed, or committed by a transaction). */
    kind: "do" | "undo" | "redo";
    /** Label of the command that was done, undone or redone. */
    label: string;
    /** What the step changed (the command's `touched`). */
    touched: Touched;
}

/** Receives every step of a history after the session has changed. */
export type HistoryListener = (change: HistoryChange) => void;

interface Entry {
    command: Command;
    bytes: number;
    /** Position of the history while this entry is the newest done one. */
    position: number;
}

/**
 * The undo history of one session (SPEC §5.2): every change of the session is a command
 * executed here or a transaction begun here.
 */
export class History {
    /** The session this history changes. */
    readonly session: DocSession;
    /** Memory budget in bytes. */
    readonly budgetBytes: number;
    readonly #allocate: PixelAllocator;
    /** Oldest first. Entries below `#done` are done; the rest are undone and can be redone. */
    readonly #entries: Entry[] = [];
    #done = 0;
    #bytes = 0;
    /** Position below the oldest retained entry. */
    #floor = 0;
    #lastPosition = 0;
    #transaction: Transaction | null = null;
    readonly #listeners = new Set<HistoryListener>();

    constructor(session: DocSession, options: HistoryOptions = {}) {
        this.session = session;
        this.budgetBytes = options.budgetBytes ?? DEFAULT_HISTORY_BUDGET_BYTES;
        this.#allocate = options.allocate ?? defaultPixelAllocator;
    }

    /** Number of commands `undo` can still reverse. */
    get undoCount(): number {
        return this.#done;
    }

    /** Number of undone commands `redo` can still repeat. */
    get redoCount(): number {
        return this.#entries.length - this.#done;
    }

    /** True when `undo` has a command to reverse. */
    get canUndo(): boolean {
        return this.undoCount > 0;
    }

    /** True when `redo` has a command to repeat. */
    get canRedo(): boolean {
        return this.redoCount > 0;
    }

    /** Label of the command `undo` would reverse, for menu text; null when there is none. */
    get undoLabel(): string | null {
        return this.#entries[this.#done - 1]?.command.label ?? null;
    }

    /** Label of the command `redo` would repeat, for menu text; null when there is none. */
    get redoLabel(): string | null {
        return this.#entries[this.#done]?.command.label ?? null;
    }

    /**
     * Identifies the state of the document: it changes with every do, undo and redo, and
     * has the same value again only when undo or redo is back at the same state. A document
     * is dirty when this differs from the position recorded at the last save (SPEC §5.2).
     */
    get position(): number {
        return this.#entries[this.#done - 1]?.position ?? this.#floor;
    }

    /** Memory retained by the commands of this history, in bytes. */
    get bytes(): number {
        return this.#bytes;
    }

    /** The open transaction, or null. While one is open, only it may change the session. */
    get transaction(): Transaction | null {
        return this.#transaction;
    }

    /**
     * Does `command` and makes it the newest entry; undone commands can no longer be
     * redone. When `command.do` throws, the error is rethrown and the history is unchanged.
     */
    execute(command: Command): void {
        this.#assertIdle("execute");
        command.do(this.session);
        this.#record(command);
    }

    /** Reverses the newest done command. Returns false when there is none. */
    undo(): boolean {
        this.#assertIdle("undo");
        const entry = this.#entries[this.#done - 1];
        if (!entry) return false;
        entry.command.undo(this.session);
        this.#done--;
        this.#notify("undo", entry.command);
        return true;
    }

    /** Repeats the command undone last. Returns false when there is none. */
    redo(): boolean {
        this.#assertIdle("redo");
        const entry = this.#entries[this.#done];
        if (!entry) return false;
        entry.command.do(this.session);
        this.#done++;
        this.#notify("redo", entry.command);
        return true;
    }

    /**
     * Begins a tool stroke on the cel of a pixel layer at a frame (SPEC §5.2). An empty
     * cel gets a transparent image, whose ID comes from `newId`. Throws `TransactionError`
     * for a target that is not such a cel, and `AllocationError` with the session unchanged.
     */
    begin(options: TransactionOptions, newId: IdGenerator = randomId): Transaction {
        this.#assertIdle("begin");
        this.#transaction = beginTransaction(this.session, options, {
            newId,
            allocate: this.#allocate,
            closed: () => {
                this.#transaction = null;
            },
            record: (command) => this.#record(command),
        });
        return this.#transaction;
    }

    /** Calls `listener` after every do, undo and redo. Returns the function that stops it. */
    subscribe(listener: HistoryListener): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    #assertIdle(call: string): void {
        if (this.#transaction) {
            throw new TransactionError(`${call}: a transaction is open; commit or abort it first.`);
        }
    }

    /** Makes a command that is already applied the newest entry. */
    #record(command: Command): void {
        for (const undone of this.#entries.splice(this.#done)) this.#bytes -= undone.bytes;
        this.#entries.push({ command, bytes: command.bytes, position: ++this.#lastPosition });
        this.#done++;
        this.#bytes += command.bytes;
        // Oldest first; the newest entry stays even when it alone exceeds the budget.
        while (this.#bytes > this.budgetBytes && this.#entries.length > 1) {
            const dropped = this.#entries.shift();
            if (!dropped) break;
            this.#bytes -= dropped.bytes;
            this.#floor = dropped.position;
            this.#done--;
        }
        this.#notify("do", command);
    }

    #notify(kind: HistoryChange["kind"], command: Command): void {
        const change: HistoryChange = { kind, label: command.label, touched: command.touched };
        for (const listener of [...this.#listeners]) listener(change);
    }
}
