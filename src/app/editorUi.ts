// Declares `import.meta.glob` wherever this module is compiled.
import type {} from "../import-meta";
import { createEditorUi } from "@ngne/editor-ui";
import type { EditorUiModules } from "@ngne/editor-ui";
import { setKeyContext } from "@ngne/editor-ui/commands";
import { setBottomRegionVisible } from "@ngne/editor-ui/shell";
import type { StatusFields } from "../ui/status/statusFields";
import { PreferencesDialog } from "../ui/preferences/PreferencesDialog";
import { appInfo } from "./about/appInfo";
import { bindEditorUi } from "./editorUiHandle";
import { keyContextStore } from "./keymap/contextState";
import type { OverlayFrame } from "./overlay/types";
import { keepsPlaying, stopPlaybackForEdit } from "./playback/playbackState";
import { editorStore } from "./state/editor";
import { sessionsStore } from "./state/sessions";
import { timelineStore } from "./timeline/timelineState";
import type { ToolSpec } from "./tools/types";

// The editor UI instance of the sprite editor (@ngne/editor-ui, SPEC §5 of the package): its
// identity, menus, key contexts, the timeline as the bottom region, the height of the colour
// chips under the tool rail, and the module maps of its registries, each found by one glob
// line under `src`, so a feature adds a command, dialog, panel, tool or overlay layer as a
// module of its own. The stores the commands read refresh them; playback stops before every
// command but the ones that keep it playing (SE-024). Its own surface: Preferences.

/** The menus of the menu bar, in order (DESIGN §2). */
export const MENU_BAR = [
    "File",
    "Edit",
    "Sprite",
    "Layer",
    "Frame",
    "Select",
    "View",
    "Help",
] as const;
export type MenuBarMenu = (typeof MENU_BAR)[number];

/**
 * The editor's key contexts between the package's `text` and `canvas` (SPEC §7.8), highest
 * priority first: `gesture` and `floating` follow editor state, `timeline` the focus.
 */
export const SPRITE_CONTEXTS = ["gesture", "floating", "timeline"] as const;
export type SpriteContext = (typeof SPRITE_CONTEXTS)[number];

/** Every key context, in the order a key looks for its command. */
export const KEY_CONTEXTS = ["text", ...SPRITE_CONTEXTS, "canvas", "global"] as const;

/** Where the focus makes the `timeline` context active: the bottom region. */
export const TIMELINE_SELECTOR = '[data-region="timeline"]';

/** The height of the colour chips under the tool rail's groups (DESIGN §5.1). */
const RAIL_FOOTER_HEIGHT = 54;

type Modules = EditorUiModules<MenuBarMenu, SpriteContext, ToolSpec, OverlayFrame, StatusFields>;

/** One module of a registry's map. */
type ModuleOf<Name extends keyof Modules> = Modules[Name][string];

const commandModules = import.meta.glob<ModuleOf<"commands">>("../**/*.commands.{ts,tsx}", {
    eager: true,
});

/** The discovered command modules, by their path from this file. */
export const commandModulePaths: readonly string[] = Object.keys(commandModules).sort();

export const editorUi = createEditorUi<
    MenuBarMenu,
    SpriteContext,
    ToolSpec,
    OverlayFrame,
    StatusFields
>({
    id: "ngne-sprite-editor",
    productName: "NGNE Sprite Editor",
    about: appInfo,
    menus: MENU_BAR,
    keyContexts: {
        order: SPRITE_CONTEXTS,
        state: ["gesture", "floating"],
        focus: { timeline: TIMELINE_SELECTOR },
    },
    bottomRegion: { id: "timeline", label: "Timeline" },
    railFooterHeight: RAIL_FOOTER_HEIGHT,
    modules: {
        commands: commandModules,
        dialogs: import.meta.glob<ModuleOf<"dialogs">>("../**/*.dialog.tsx", { eager: true }),
        dock: import.meta.glob<ModuleOf<"dock">>("../**/*.dock.tsx", { eager: true }),
        contextBars: import.meta.glob<ModuleOf<"contextBars">>("../**/*.contextbar.tsx", {
            eager: true,
        }),
        tools: import.meta.glob<ModuleOf<"tools">>("../**/*.tools.{ts,tsx}", { eager: true }),
        overlays: import.meta.glob<ModuleOf<"overlays">>("../**/*.overlay.{ts,tsx}", {
            eager: true,
        }),
        statusFields: import.meta.glob<ModuleOf<"statusFields">>("../**/*.status.ts", {
            eager: true,
        }),
    },
    refreshOn: [sessionsStore, editorStore],
    beforeRun: (command) => {
        if (!keepsPlaying(command.id)) stopPlaybackForEdit();
    },
    surfaces: { preferences: PreferencesDialog },
});

/** The app's command registry: the package's commands, then every `*.commands.ts(x)` module. */
export const appCommands = editorUi.commands;

bindEditorUi(editorUi);

// The app's own stores of the state contexts and of the timeline's visibility, which modules
// loaded above read and write, follow the instance's and the instance follows them.
keyContextStore.subscribe((state) => {
    setKeyContext(editorUi, "gesture", state.gesture);
    setKeyContext(editorUi, "floating", state.floating);
});
editorUi.bottomRegion.subscribe(({ visible }) => {
    if (timelineStore.getState().visible !== visible) timelineStore.setState({ visible });
});
timelineStore.subscribe(({ visible }) => setBottomRegionVisible(editorUi, visible));
