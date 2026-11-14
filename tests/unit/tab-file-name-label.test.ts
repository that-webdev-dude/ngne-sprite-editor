import { describe, expect, it } from "vitest";
import { documentTabs, subscribeDocumentTabs, tabLabel } from "../../src/app/tabs/tabLabel";
import type { TabInfo } from "../../src/app/tabs/tabLabel";
import { renameSpriteCommand } from "../../src/core/sprite";
import { active, answerDiscard, chosen, errors, harness, openNew, paint } from "./se-041-support";
import type { Harness } from "./se-041-support";

// Issue #6: a document tab shows its file's name (without the project extension) once the
// document has a file, and its sprite name until then; the tooltip names both. The label
// follows Open, Save, Save As (also to another file, which changes the document's id) and
// Revert, through the file workflows' `subscribe`.

/** The tabs of the harness's documents, in order. */
function tabsOf(test: Harness): TabInfo[] {
    return documentTabs(test.sessions.getState(), test.workflows);
}

/** The tab of the active document. */
function activeTab(test: Harness): TabInfo {
    const id = active(test).id;
    const tab = tabsOf(test).find((entry) => entry.id === id);
    if (!tab) throw new Error(`no tab for ${id}`);
    return tab;
}

/** Counts the calls of a tab listener on the harness. */
function countChanges(test: Harness): { readonly count: number; stop(): void } {
    let count = 0;
    const stop = subscribeDocumentTabs(test.sessions, test.workflows, () => count++);
    return {
        get count() {
            return count;
        },
        stop,
    };
}

describe("the label and tooltip rule", () => {
    it("without a file: the sprite name, as label and tooltip", () => {
        expect(tabLabel("zombie-cop-34-idle", null)).toEqual({
            label: "zombie-cop-34-idle",
            tooltip: "zombie-cop-34-idle",
        });
    });

    it("with a file: its name without the extension; the tooltip names the file and the sprite", () => {
        expect(tabLabel("zombie-cop-34-idle", "saveas_zombie-cop_34_idle.ngsprite")).toEqual({
            label: "saveas_zombie-cop_34_idle",
            tooltip: "saveas_zombie-cop_34_idle.ngsprite — sprite: zombie-cop-34-idle",
        });
    });

    it("drops the extension whatever its case; a name without it, or with nothing before it, stays whole", () => {
        expect(tabLabel("hero", "HERO.NGSPRITE").label).toBe("HERO");
        expect(tabLabel("hero", "hero.v2.ngsprite").label).toBe("hero.v2");
        expect(tabLabel("hero", "hero.zip").label).toBe("hero.zip");
        expect(tabLabel("hero", ".ngsprite").label).toBe(".ngsprite");
    });
});

describe("the tab of a document follows its file", () => {
    it("an imported document never saved shows its sprite name; renaming the sprite renames the tab", () => {
        const test = harness();
        const imported = openNew(test, "zombie-cop_34_idle");
        expect(activeTab(test)).toMatchObject({
            label: "zombie-cop_34_idle",
            tooltip: "zombie-cop_34_idle",
        });
        imported.history.execute(renameSpriteCommand("zombie cop"));
        expect(activeTab(test)).toMatchObject({ label: "zombie cop", tooltip: "zombie cop" });
    });

    it("Save As to a new name: the tab shows the file as soon as the save is done; the sprite name, the file contents and the listeners follow", async () => {
        const test = harness();
        const document = openNew(test, "zombie-cop_34_idle");
        paint(document, 2);
        const changes = countChanges(test);
        test.platform.toSave.push(test.disk.handle("saveas_zombie-cop_34_idle.ngsprite"));
        expect(await test.workflows.saveAs()).toBe(true);
        expect(changes.count).toBeGreaterThan(0);
        expect(activeTab(test)).toEqual({
            id: active(test).id,
            dirty: false,
            label: "saveas_zombie-cop_34_idle",
            tooltip: "saveas_zombie-cop_34_idle.ngsprite — sprite: zombie-cop_34_idle",
        });
        // The sprite name is the export identity: Save As leaves it as it was.
        expect(active(test).session.doc.name).toBe("zombie-cop_34_idle");
        changes.stop();
    });

    it("Save As again to another file: a new id, and the tab follows the latest file", async () => {
        const test = harness();
        openNew(test, "hero");
        test.platform.toSave.push(test.disk.handle("first.ngsprite"));
        expect(await test.workflows.save()).toBe(true);
        const first = active(test).id;
        expect(activeTab(test).label).toBe("first");

        const changes = countChanges(test);
        test.platform.toSave.push(test.disk.handle("second.ngsprite"));
        expect(await test.workflows.saveAs()).toBe(true);
        expect(active(test).id).not.toBe(first);
        expect(changes.count).toBeGreaterThan(0);
        expect(tabsOf(test)).toEqual([
            {
                id: active(test).id,
                dirty: false,
                label: "second",
                tooltip: "second.ngsprite — sprite: hero",
            },
        ]);
        changes.stop();
    });

    it("opening a project whose file name differs from its sprite name shows the file name", async () => {
        const source = harness();
        openNew(source, "hero");
        source.platform.toSave.push(source.disk.handle("level-1.ngsprite"));
        expect(await source.workflows.save()).toBe(true);
        const bytes = source.disk.files.get("level-1.ngsprite")!;

        const test = harness();
        const changes = countChanges(test);
        test.platform.toOpen.push(chosen("level-1.ngsprite", bytes, null));
        expect(await test.workflows.open()).toBe(true);
        expect(changes.count).toBeGreaterThan(0);
        expect(activeTab(test)).toMatchObject({
            label: "level-1",
            tooltip: "level-1.ngsprite — sprite: hero",
        });
        changes.stop();
    });

    it("a saved document whose sprite is renamed keeps its file's name; the tooltip shows the new sprite name", async () => {
        const test = harness();
        const document = openNew(test, "hero");
        test.platform.toSave.push(test.disk.handle("hero-v2.ngsprite"));
        expect(await test.workflows.save()).toBe(true);
        document.history.execute(renameSpriteCommand("villain"));
        expect(activeTab(test)).toMatchObject({
            label: "hero-v2",
            tooltip: "hero-v2.ngsprite — sprite: villain",
            dirty: true,
        });
    });

    it("Revert keeps the file's name", async () => {
        const test = harness();
        const document = openNew(test, "hero");
        test.platform.toSave.push(test.disk.handle("kept.ngsprite"));
        expect(await test.workflows.save()).toBe(true);
        paint(document, 5);
        const reverting = test.workflows.revert();
        await answerDiscard(test, true);
        expect(await reverting).toBe(true);
        expect(activeTab(test)).toMatchObject({ label: "kept", dirty: false });
    });

    it("a cancelled Save As picker or a failed write leaves the label as it was", async () => {
        const test = harness();
        const document = openNew(test, "hero");
        test.platform.toSave.push(test.disk.handle("hero.ngsprite"));
        expect(await test.workflows.save()).toBe(true);
        paint(document, 1);
        const before = activeTab(test);
        expect(before).toMatchObject({ label: "hero", tooltip: "hero.ngsprite — sprite: hero" });

        test.platform.toSave.push(null);
        expect(await test.workflows.saveAs()).toBe(false);
        expect(activeTab(test)).toEqual(before);

        const failing = test.disk.handle("full.ngsprite");
        failing.failWrite = new DOMException("The quota has been exceeded.", "QuotaExceededError");
        test.platform.toSave.push(failing);
        expect(await test.workflows.saveAs()).toBe(false);
        expect(errors(test)).toHaveLength(1);
        expect(activeTab(test)).toEqual(before);
    });

    it("without File System Access, the tab follows the downloaded file's name, and the sprite name stays", async () => {
        const test = harness();
        test.platform.access = false;
        const document = openNew(test, "hero walk");
        document.history.execute(renameSpriteCommand("hero: walk"));
        expect(await test.workflows.saveAs()).toBe(true);
        expect(test.platform.downloads.map((download) => download.name)).toEqual([
            "hero_ walk.ngsprite",
        ]);
        expect(activeTab(test)).toMatchObject({
            label: "hero_ walk",
            tooltip: "hero_ walk.ngsprite — sprite: hero: walk",
            dirty: false,
        });
        expect(active(test).session.doc.name).toBe("hero: walk");
    });

    it("each tab has its own label; closing a document drops its tab", async () => {
        const test = harness();
        openNew(test, "hero");
        test.platform.toSave.push(test.disk.handle("hero-file.ngsprite"));
        expect(await test.workflows.save()).toBe(true);
        const hero = active(test).id;
        const villain = openNew(test, "villain").id;
        expect(tabsOf(test).map(({ id, label }) => [id, label])).toEqual([
            [hero, "hero-file"],
            [villain, "villain"],
        ]);
        test.sessions.getState().close(hero);
        expect(tabsOf(test).map(({ id, label }) => [id, label])).toEqual([[villain, "villain"]]);
    });

    it("stops calling the listener once stopped", async () => {
        const test = harness();
        openNew(test, "hero");
        const changes = countChanges(test);
        changes.stop();
        test.platform.toSave.push(test.disk.handle("hero.ngsprite"));
        expect(await test.workflows.save()).toBe(true);
        expect(changes.count).toBe(0);
    });
});
