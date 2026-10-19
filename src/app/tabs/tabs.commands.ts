import type { CommandSpec } from "../commands/types";
import { sessionsStore } from "../state/sessions";
import { activateDocument, neighbourOf, tabsAvailable } from "./tabs";

// Commands of the document tabs (SE-047): the next and the previous tab, in the View menu and
// the command palette. They have no key: Ctrl+Tab and Ctrl+PageDown belong to the browser. In
// the tab strip itself the arrow keys move between tabs (ui/tabs/DocumentTabs.tsx).

function step(by: number): void {
    const id = neighbourOf(sessionsStore.getState(), by);
    if (id !== null) activateDocument(id);
}

const enabled = (by: number) => () =>
    neighbourOf(sessionsStore.getState(), by) !== null && tabsAvailable();

export const commands: CommandSpec[] = [
    {
        id: "document.next",
        title: "Next Document",
        menuPath: ["View"],
        menuOrder: 600,
        enabled: enabled(1),
        run: () => step(1),
    },
    {
        id: "document.previous",
        title: "Previous Document",
        menuPath: ["View"],
        menuOrder: 610,
        enabled: enabled(-1),
        run: () => step(-1),
    },
];
