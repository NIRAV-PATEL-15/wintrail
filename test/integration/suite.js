// Runs inside a real VS Code extension host. Plain JS, no framework.
const vscode = require("vscode");
const assert = require("assert");

exports.run = async function () {
  const log = (m) => console.log("[it] " + m);
  try {
    const ext = vscode.extensions.getExtension("NiravPatel15.wintrail");
    assert.ok(ext, "extension found");
    const { session: s, breaks, view } = await ext.activate();
    const cmds = await vscode.commands.getCommands(true);
    for (const c of ["wintrail.quickAdd", "wintrail.writeStandup", "wintrail.exportAppraisal", "wintrail.focus", "wintrail.lock"]) {
      assert.ok(cmds.includes(c), "command registered: " + c);
    }
    log("commands registered");

    assert.strictEqual((await view.buildState()).screen, "setup");
    await s.create("integration-pass");
    await s.lock();
    assert.strictEqual((await view.buildState()).screen, "locked");
    await view.quickAdd("!Shipped the integration test #testing");
    log("quick-add while locked works");

    await s.unlock("integration-pass");
    const st = await view.buildState();
    assert.strictEqual(st.screen, "unlocked");
    assert.strictEqual(st.entries.length, 1);
    assert.ok(st.entries[0].lockedAdd && st.entries[0].star, "locked add marked and starred");
    assert.deepStrictEqual(st.entries[0].tags, ["testing"]);
    assert.strictEqual(st.heatmap.length, 126);
    assert.ok(typeof st.standup.today === "string" && Array.isArray(st.standup.yesterday));
    assert.ok(!JSON.stringify(st).includes("macKey"), "no key material in view state");
    log("unlock + dashboard state ok");

    await view.handle({ type: "confirm", id: st.entries[0].id });
    assert.strictEqual((await view.buildState()).entries[0].lockedAdd, false);
    log("confirm works");

    await vscode.workspace.getConfiguration("wintrail.breaks").update("eyes.interval", 7, vscode.ConfigurationTarget.Global);
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(breaks.scheduler.config.intervals.eyes, 7, "break settings apply live");
    breaks.focus(30);
    assert.ok(breaks.scheduler.focusEndsAt, "focus mode on");
    log("break settings + focus ok");

    // I3: lock deletes the remembered key; a lock in another window locks this one
    await vscode.workspace.getConfiguration("wintrail").update("rememberOnThisMachine", true, vscode.ConfigurationTarget.Global);
    await s.syncRememberedKey();
    assert.ok(await s.ctx.secrets.get("wintrail.rememberedKey"), "key remembered");
    await s.lock();
    assert.strictEqual(await s.ctx.secrets.get("wintrail.rememberedKey"), undefined, "lock deletes the remembered key");
    await s.unlock("integration-pass");
    await new Promise((r) => setTimeout(r, 1100));
    const fs = require("fs"), path = require("path");
    fs.writeFileSync(path.join(s.ctx.globalStorageUri.fsPath, "lock-signal"), String(Date.now()));
    for (let i = 0; i < 40 && s.store.isUnlocked; i++) await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(s.store.isUnlocked, false, "lock signal from another window locks this one");
    await s.unlock("integration-pass");
    log("lock everywhere + remembered key cleared");

    await vscode.commands.executeCommand("wintrail.dashboard.focus");
    await new Promise((r) => setTimeout(r, 1000));
    await vscode.commands.executeCommand("wintrail.lock");
    assert.strictEqual(s.store.isUnlocked, false);
    log("ALL PASSED");
  } catch (e) {
    log("FAILED: " + (e && e.stack || e));
    throw e;
  }
};
