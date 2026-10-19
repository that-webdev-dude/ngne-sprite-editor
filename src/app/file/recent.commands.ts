import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { recentFiles } from "./recentFiles";
import type { RecentEntry } from "./recentFiles";
import { fileWorkflows } from "./workflows";

// File → Open Recent (SE-047): one command per recent file, registered and removed as the list
// changes, and Clear Recent Files, which keeps the submenu there while the list is empty. The
// submenu follows Open… (File menu order 110); the empty state lists the same commands.

/** The menu path of the recent files. */
export const OPEN_RECENT_PATH = ["File", "Open Recent"] as const;
/** Order of the first file in the File menu, and so of the submenu; files follow it. */
const FIRST_ORDER = 112;

/** The id of the command that opens a recent entry. */
export function openRecentId(entry: Pick<RecentEntry, "key">): string {
    return `file.openRecent.${entry.key}`;
}

/** Whether a file can be opened now: no file operation runs and no stroke is under way. */
const idle = () => fileWorkflows.canAct();

export const commands: CommandSpec[] = [
    {
        id: "file.clearRecent",
        title: "Clear Recent Files",
        menuPath: OPEN_RECENT_PATH,
        menuOrder: 190,
        enabled: () => recentFiles.store.getState().entries.length > 0,
        run: () => recentFiles.clear(),
    },
];

/** The commands of the files listed now; replaced as a whole when the list changes. */
let registered: (() => void)[] = [];

function registerEntries(entries: readonly RecentEntry[]): void {
    for (const unregister of registered) unregister();
    registered = entries.map((entry, index) =>
        appCommands.register(
            {
                id: openRecentId(entry),
                title: entry.name,
                menuPath: OPEN_RECENT_PATH,
                // Newest first, all in one group.
                menuOrder: FIRST_ORDER + index / 100,
                enabled: idle,
                run: async () => void (await fileWorkflows.openRecent(entry)),
            },
            "../file/recent.commands.ts",
        ),
    );
}

recentFiles.store.subscribe(({ entries }, previous) => {
    if (entries !== previous.entries) registerEntries(entries);
});
registerEntries(recentFiles.store.getState().entries);
void recentFiles.load();
