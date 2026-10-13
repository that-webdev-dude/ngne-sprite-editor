import type { DocSession } from "../model";
import { mergeTouched, type Command } from "./command";

/**
 * Makes one part of a chained command from the session as it is when the part's turn comes,
 * or returns null when that part has nothing to change. It reads the session and changes
 * nothing: the chained command does the part.
 */
export type CommandFactory = (session: DocSession) => Command | null;

/**
 * Several commands as one undo step, each made after the one before it was done.
 *
 * `compositeCommand` takes commands that are ready. Use it when every part can be made from
 * the session as it is before the step: a rename with a pivot change, patches of several
 * images. Use `chainedCommand` when a part can only be made once the part before it has run,
 * because it names what that part creates or because it is planned against the document: the
 * frame, cel, tag and layer stack commands are, and each refuses to run on a document that
 * changed since it was made, so two of them never share a `compositeCommand`.
 *
 * `factories` are called in order, each with the session as the parts before it left it. A
 * factory that returns null is skipped. The result is null when no factory makes a command;
 * there is then no step to undo. The first part is made here and the others during `do`, so
 * make the chained command and pass it to `History.execute` at once.
 *
 * - `do` does the parts in order. When a factory or a part throws, the parts already done are
 *   undone in reverse and the error is rethrown: the step happens as a whole or not at all.
 * - `undo` undoes the parts in reverse.
 * - A later `do` is a redo. It does the same parts again and calls no factory. Under a
 *   history the session before a redo is the session before the first `do`, because every
 *   change of it is a command, so each part finds what it was made from; and a part creates
 *   what it created before under the IDs it had then (frames, layers, tags, images), which
 *   later steps of the history may name.
 * - `bytes` and `touched` are those of the parts made so far, so they are complete once `do`
 *   has run. That is when a history reads them: `History.execute` records `bytes` and
 *   reports `touched` after `do`. `compositeCommand` reads both when it is made, so a chained
 *   command is not handed to it; the other commands become parts of the chain instead
 *   (`() => command`). A chained command can be a part of another chained command.
 */
export function chainedCommand(
    label: string,
    session: DocSession,
    factories: readonly CommandFactory[],
): Command | null {
    // A factory that makes nothing leaves the session alone, so the next one sees what it
    // would see during `do`: the first part can be made now.
    let next = 0;
    let first: Command | null = null;
    while (next < factories.length && !first) first = factories[next++](session);
    if (!first) return null;
    const rest = factories.slice(next);

    /** The parts in the order they are done. */
    const parts: Command[] = [first];
    /** True once a `do` has made every part; from then on `parts` stays as it is. */
    let complete = false;

    return {
        label,
        get bytes() {
            return parts.reduce((sum, part) => sum + part.bytes, 0);
        },
        get touched() {
            return mergeTouched(parts.map((part) => part.touched));
        },
        do(target) {
            let done = 0;
            try {
                for (; done < parts.length; done++) parts[done].do(target);
                if (complete) return;
                for (const factory of rest) {
                    const part = factory(target);
                    if (!part) continue;
                    parts.push(part);
                    part.do(target);
                    done++;
                }
                complete = true;
            } catch (error) {
                while (done > 0) parts[--done].undo(target);
                // What a failed first attempt made is dropped; another attempt makes it again.
                if (!complete) parts.length = 1;
                throw error;
            }
        },
        undo(target) {
            let left = parts.length;
            try {
                for (; left > 0; left--) parts[left - 1].undo(target);
            } catch (error) {
                for (; left < parts.length; left++) parts[left].do(target);
                throw error;
            }
        },
    };
}
