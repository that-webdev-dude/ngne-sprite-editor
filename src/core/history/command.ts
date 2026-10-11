import type { DocSession, Touched } from "../model";

/**
 * One undoable change of a session (SPEC §5.2). `undo` reverses `do` exactly, and each of
 * them either completes or throws with the session as it found it. A command that cannot
 * allocate memory throws `AllocationError`.
 */
export interface Command {
    /** Menu text of the step, as in "Undo Pencil". */
    label: string;
    do(session: DocSession): void;
    undo(session: DocSession): void;
    /** Memory the command retains, in bytes; counted against the history budget. */
    bytes: number;
    /** What `do` and `undo` change; the history reports it to its subscribers. */
    touched: Touched;
}

/** Union of several `touched` records, each ID once. */
export function mergeTouched(parts: readonly Touched[]): Touched {
    return {
        frameIds: [...new Set(parts.flatMap((part) => part.frameIds))],
        layerIds: [...new Set(parts.flatMap((part) => part.layerIds))],
        structure: parts.some((part) => part.structure),
    };
}

/**
 * Several commands as one undo step: done in the given order, undone in reverse. When one of
 * them throws, those that already ran are reversed before the error is rethrown, so the step
 * happens as a whole or not at all.
 */
export function compositeCommand(label: string, commands: readonly Command[]): Command {
    const parts = [...commands];
    return {
        label,
        bytes: parts.reduce((sum, part) => sum + part.bytes, 0),
        touched: mergeTouched(parts.map((part) => part.touched)),
        do(session) {
            let done = 0;
            try {
                for (; done < parts.length; done++) parts[done].do(session);
            } catch (error) {
                while (done > 0) parts[--done].undo(session);
                throw error;
            }
        },
        undo(session) {
            let left = parts.length;
            try {
                for (; left > 0; left--) parts[left - 1].undo(session);
            } catch (error) {
                for (; left < parts.length; left++) parts[left].do(session);
                throw error;
            }
        },
    };
}
