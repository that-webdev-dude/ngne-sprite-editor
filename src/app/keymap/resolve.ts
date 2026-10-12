import { chordKey } from "../commands/chord";
import type { CommandRegistry } from "../commands/registry";
import type { Command, KeyContext } from "../commands/types";
import {
    isBrowserChord,
    isCharacterChord,
    isNativeKeyChord,
    isTextEditingChord,
} from "./keyClasses";

/**
 * What the keymap needs to know about the moment a key is pressed (SPEC §7.8). It is read from
 * the page by environment.ts; tests build it by hand.
 */
export interface KeyEnvironment {
    /** A menu, dialog or popover is open; those handle their own keys. */
    overlayOpen: boolean;
    /**
     * What has keyboard focus: a text or number field, the viewport element itself, another
     * control, or nothing (the page body).
     */
    focus: "text" | "viewport" | "control" | "none";
    /** Focus is inside the timeline panel. */
    inTimeline: boolean;
    /** Native keys (keyClasses.ts) the focused control consumes itself. */
    nativeKeys: ReadonlySet<string>;
    /** The focused control uses typed characters for typeahead (a select). */
    typeahead: boolean;
    /** A multi-click tool gesture is in progress. */
    gesture: boolean;
    /** A floating selection exists. */
    floating: boolean;
}

/** The contexts that apply in an environment, highest priority first. */
export function applicableContexts(environment: KeyEnvironment): KeyContext[] {
    if (environment.overlayOpen) return [];
    // A text field is exclusive: of all bindings only those made in `text` (†) still act.
    if (environment.focus === "text") return ["text"];
    const contexts: KeyContext[] = [];
    if (environment.gesture) contexts.push("gesture");
    if (environment.floating) contexts.push("floating");
    if (environment.inTimeline) contexts.push("timeline");
    contexts.push("canvas", "global");
    return contexts;
}

export type KeyResolution =
    /** The key belongs to `command`, bound in `context`. `command` may be disabled. */
    | { action: "run"; command: Command; context: KeyContext }
    /** A bound chord that does not act here; its browser default is suppressed. */
    | { action: "suppress" }
    /** Not the keymap's key: the focused control or the browser handles it. */
    | { action: "pass" };

const PASS: KeyResolution = { action: "pass" };

/**
 * Resolves a canonical chord (SPEC §7.8): the first context that applies and binds the chord
 * gets it. Before that, the focused control gets the keys it consumes natively, and the
 * `canvas` bindings of native keys act only while the viewport itself has focus.
 *
 * Among several commands that bind the chord in the winning context the first enabled one is
 * returned; when none is enabled the first is, so the caller suppresses the key without
 * running anything. A lower context is not tried in that case.
 */
export function resolveKey(
    registry: Pick<CommandRegistry, "bindings" | "isBound">,
    chord: string,
    environment: KeyEnvironment,
): KeyResolution {
    const native = isNativeKeyChord(chord);
    const takenByControl =
        environment.focus !== "text" &&
        ((native && environment.nativeKeys.has(chordKey(chord))) ||
            (environment.typeahead && isCharacterChord(chord)));

    if (!takenByControl) {
        for (const context of applicableContexts(environment)) {
            if (context === "canvas" && native && environment.focus !== "viewport") continue;
            const bound = registry.bindings(context, chord);
            const command = bound.find((candidate) => candidate.enabled()) ?? bound[0];
            if (command) return { action: "run", command, context };
        }
    }

    // Bound somewhere, not acting here: no bookmark dialog for Ctrl+D, no find bar for F3.
    // Keys the control or the text field handles are never touched.
    const handledNatively =
        takenByControl || (environment.focus === "text" && isTextEditingChord(chord));
    if (!handledNatively && isBrowserChord(chord) && registry.isBound(chord)) {
        return { action: "suppress" };
    }
    return PASS;
}
