<script lang="ts">
  import { slide } from "svelte/transition";
  import type { ViewState } from "../src/shared/protocol";
  import { send } from "./api";
  type U = Extract<ViewState, { screen: "unlocked" }>;
  let { vs, error = "", busy = false, onclose, onsubmit }: { vs: U; error?: string; busy?: boolean; onclose: () => void; onsubmit: () => void } = $props();
  let pwOpen = $state(false), oldPw = $state(""), newPw = $state(""), newPw2 = $state(""), local = $state("");
  function change(e: Event) {
    e.preventDefault();
    local = newPw.length < 8 ? "Use at least 8 characters" : newPw !== newPw2 ? "New passwords don't match" : "";
    if (local) return;
    onsubmit();
    send({ type: "changePassword", oldPassword: oldPw, newPassword: newPw });
    oldPw = newPw = newPw2 = "";
  }
</script>

<div class="menu" transition:slide={{ duration: 220 }}>
  <button class="item" onclick={() => send({ type: "chooseBackupFolder" })}>💾 <span>Auto-backup folder<small>{vs.autoBackupFolder || "not set"}</small></span></button>
  {#if vs.autoBackupFolder}<button class="item" onclick={() => send({ type: "backupNow" })}>⟳ <span>Back up now</span></button>{/if}
  <button class="item" onclick={() => send({ type: "exportBackup" })}>⇩ <span>Export encrypted backup…</span></button>
  <button class="item" onclick={() => send({ type: "importBackup" })}>⇧ <span>Import backup (merge)…</span></button>
  <button class="item" onclick={() => (pwOpen = !pwOpen)}>🔑 <span>Change password</span></button>
  {#if pwOpen}
    <form class="pw" onsubmit={change} transition:slide>
      <input class="field" type="password" placeholder="Current password" bind:value={oldPw} />
      <input class="field" type="password" placeholder="New password" bind:value={newPw} />
      <input class="field" type="password" placeholder="Repeat new password" bind:value={newPw2} />
      {#if local || error}<div class="error">{local || error}</div>{/if}
      <button class="btn primary block" disabled={busy}>{busy ? "Re-encrypting…" : "Change password"}</button>
    </form>
  {/if}
  <button class="item close" onclick={onclose}>Close</button>
</div>

<style>
  .menu { background: var(--card); border: 1px solid var(--border); border-radius: var(--r); padding: 6px; margin-bottom: 8px; }
  .item { display: flex; gap: 10px; align-items: center; width: 100%; text-align: left; border: 0; background: none; padding: 8px; border-radius: 8px; }
  .item:hover { background: var(--card-hover); }
  .item span { display: flex; flex-direction: column; }
  .item small { color: var(--muted); font-size: 10.5px; word-break: break-all; }
  .pw { display: flex; flex-direction: column; gap: 6px; padding: 6px 8px 10px; }
  .close { justify-content: center; color: var(--muted); }
</style>
