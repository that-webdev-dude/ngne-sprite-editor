import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createCommandRegistry } from "../../../src/app/commands/registry";
import type { KeyContext } from "../../../src/app/commands/types";
import { setKeyContext } from "../../../src/app/keymap/contextState";
import { VIEWPORT_FOCUS_ATTRIBUTE } from "../../../src/app/keymap/environment";
import { installKeymap } from "../../../src/app/keymap/install";
import { Button } from "../../../src/ui/primitives/Button";
import { Dialog } from "../../../src/ui/primitives/Dialog";
import { Select } from "../../../src/ui/primitives/Select";
import { AppShell } from "../../../src/ui/shell/AppShell";
import { UiRoot } from "../../../src/ui/UiRoot";

// SE-007 keymap page: the real shell and the real keymap on a registry that holds nothing but
// spy commands, which the spec registers from the key table of SPEC §7.8. The regions carry
// what the keymap contexts need: a viewport focus element, a timeline cell, a text field.

/** One spy command: a chord of the table in one context (tests/e2e/se-007-spec-keys.ts). */
interface SpyBinding {
    chord: string;
    context: KeyContext;
    text: boolean;
    hold: boolean;
    condition: "selection" | "no-selection" | null;
}

interface KeyRecord {
    type: string;
    key: string;
    prevented: boolean;
}

interface KeymapHarness {
    /** Ids of the spies that ran, in order. */
    calls: string[];
    /** Ids of the hold spies that were released, in order. */
    releases: string[];
    /** Every key event after the keymap handled it. */
    events: KeyRecord[];
    /** Stands for "a selection exists" in the conditions of the table. */
    selection: boolean;
    /** Registers one spy per binding and returns their ids in the same order. */
    register(bindings: SpyBinding[]): string[];
    setContext(context: "gesture" | "floating", active: boolean): void;
    /** Clears the records and returns to no gesture, no floating selection, no selection. */
    reset(): void;
}

declare global {
    interface Window {
        se007?: KeymapHarness;
    }
}

const registry = createCommandRegistry();
const harness: KeymapHarness = {
    calls: [],
    releases: [],
    events: [],
    selection: false,
    register(bindings) {
        return bindings.map((binding, index) => {
            const id = `spy-${index}`;
            const { condition } = binding;
            registry.register({
                id,
                title: `${binding.chord} in ${binding.context}`,
                shortcut: binding.chord,
                context: binding.text ? [binding.context, "text"] : binding.context,
                enabled: () =>
                    condition === null || (condition === "selection") === harness.selection,
                run: () => void harness.calls.push(id),
                release: binding.hold ? () => void harness.releases.push(id) : undefined,
            });
            return id;
        });
    },
    setContext: setKeyContext,
    reset() {
        harness.calls.length = 0;
        harness.releases.length = 0;
        harness.events.length = 0;
        harness.selection = false;
        setKeyContext("gesture", false);
        setKeyContext("floating", false);
    },
};
window.se007 = harness;

installKeymap({ registry });
// Registered after the keymap's listener, so each event is recorded as the keymap left it.
for (const type of ["keydown", "keyup"]) {
    window.addEventListener(type, (event) => {
        const { key } = event as KeyboardEvent;
        harness.events.push({ type, key, prevented: event.defaultPrevented });
    });
}

const CHOICES = [
    { value: "one", label: "One" },
    { value: "two", label: "Two" },
];

function Page() {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [choice, setChoice] = useState("one");
    return (
        <UiRoot>
            <AppShell
                regions={{
                    "context-bar": (
                        <>
                            <input aria-label="Name" data-testid="text-field" />
                            <Button data-testid="plain-button">Plain button</Button>
                            <Select
                                label="Choice"
                                hideLabel
                                value={choice}
                                onChange={setChoice}
                                options={CHOICES}
                            />
                            <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
                        </>
                    ),
                    viewport: (
                        <div
                            tabIndex={0}
                            data-testid="viewport-focus"
                            style={{ width: "100%", height: "100%" }}
                            {...{ [VIEWPORT_FOCUS_ATTRIBUTE]: "" }}
                        />
                    ),
                    timeline: (
                        <>
                            <div tabIndex={0} data-testid="timeline-cell">
                                Cell
                            </div>
                            <button type="button" data-testid="timeline-button">
                                Transport
                            </button>
                        </>
                    ),
                }}
            />
            <Dialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                title="Test dialog"
                actions={<Button onClick={() => setDialogOpen(false)}>Close</Button>}
            >
                <input aria-label="Dialog field" data-testid="dialog-field" />
            </Dialog>
        </UiRoot>
    );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(<Page />);
