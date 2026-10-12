import { chordFromEvent, chordKey, eventKey } from "../commands/chord";
import type { KeyEventLike } from "../commands/chord";
import { invokeCommand } from "../commands/invoke";
import type { CommandErrorHandler } from "../commands/invoke";
import type { CommandRegistry } from "../commands/registry";
import type { Command } from "../commands/types";
import { keyContextStore } from "./contextState";
import { readKeyEnvironment } from "./environment";
import { resolveKey } from "./resolve";
import type { KeyEnvironment } from "./resolve";

/** The keyboard event fields the keymap reads and the one call it makes. */
export interface KeymapEvent extends KeyEventLike {
    repeat: boolean;
    isComposing: boolean;
    defaultPrevented: boolean;
    preventDefault(): void;
}

/** The part of `window` the keymap listens on; tests pass an `EventTarget`. */
export interface KeymapTarget {
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface KeymapOptions {
    registry: CommandRegistry;
    /** Where the key events arrive; the default is `window`. */
    target?: KeymapTarget;
    /** The environment of the key being pressed; the default reads the page (environment.ts). */
    environment?(): KeyEnvironment;
    /** Receives what a command throws; the default logs it. */
    onError?: CommandErrorHandler;
}

/**
 * Connects the keyboard to the command registry (SPEC §7.8). One listener in the bubble
 * phase: a control that handled the key and prevented its default is left alone. Returns the
 * function that disconnects the keymap.
 *
 * A resolved chord has its browser default prevented, whether its command is enabled or not.
 * A hold binding (`release`) runs once on key down and is released on key up or when the
 * window loses focus.
 */
export function installKeymap(options: KeymapOptions): () => void {
    const { registry } = options;
    const target: KeymapTarget = options.target ?? window;
    const environment =
        options.environment ?? (() => readKeyEnvironment(document, keyContextStore.getState()));
    const onError: CommandErrorHandler =
        options.onError ?? ((error, command) => console.error(`Command ${command.id}:`, error));
    /** Hold bindings whose key is down, by key. */
    const held = new Map<string, Command>();

    const onKeyDown = (event: Event) => {
        const key = event as Event & KeymapEvent;
        if (key.defaultPrevented || key.isComposing) return;
        const chord = chordFromEvent(key);
        if (chord === null) return;

        const resolution = resolveKey(registry, chord, environment());
        if (resolution.action === "pass") return;
        key.preventDefault();
        if (resolution.action === "suppress") return;

        const { command } = resolution;
        if (!command.release) {
            invokeCommand(command, onError);
            return;
        }
        // The key repeats while it is held; the binding starts once.
        const heldKey = chordKey(chord);
        if (key.repeat || held.has(heldKey)) return;
        if (invokeCommand(command, onError)) held.set(heldKey, command);
    };

    const release = (heldKey: string) => {
        const command = held.get(heldKey);
        if (!command) return;
        held.delete(heldKey);
        try {
            command.release?.();
        } catch (error) {
            onError(error, command);
        }
    };

    const onKeyUp = (event: Event) => {
        const key = event as Event & KeymapEvent;
        const heldKey = eventKey(key);
        if (heldKey === null) return;
        const wasHeld = held.has(heldKey);
        release(heldKey);
        // Releasing Alt on its own would otherwise move focus to the browser's menu.
        if (wasHeld || (heldKey === "Alt" && registry.isBound("Alt"))) key.preventDefault();
    };

    const onBlur = () => {
        for (const heldKey of [...held.keys()]) release(heldKey);
    };

    target.addEventListener("keydown", onKeyDown);
    target.addEventListener("keyup", onKeyUp);
    target.addEventListener("blur", onBlur);
    return () => {
        target.removeEventListener("keydown", onKeyDown);
        target.removeEventListener("keyup", onKeyUp);
        target.removeEventListener("blur", onBlur);
        onBlur();
    };
}
