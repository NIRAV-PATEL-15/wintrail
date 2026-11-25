<script lang="ts">
  import type { EntryView } from "../src/shared/protocol";
  import { send, fmtTime } from "./api";
  let { e, fresh = false }: { e: EntryView; fresh?: boolean } = $props();
  let editing = $state(false);
  let draft = $state("");
  const startEdit = () => { draft = e.text; editing = true; };
  function save(ev: Event) {
    ev.preventDefault();
    if (draft.trim() && draft.trim() !== e.text) send({ type: "edit", id: e.id, text: draft.trim() });
    editing = false;
  }
</script>

<div class="entry" class:star={e.star} class:fresh>
  <button class="dot" title={e.star ? "Remove highlight" : "Mark as highlight"} onclick={() => send({ type: "toggleStar", id: e.id })}>
    {#if e.star}<span class="s">⭐</span>{:else}<span class="o"></span>{/if}
  </button>
  <div class="body">
    {#if editing}
      <form onsubmit={save}><input class="field" bind:value={draft} maxlength="500" onblur={save} /></form>
    {:else}
      <div class="text" ondblclick={startEdit} role="textbox" tabindex="-1">{e.text}</div>
    {/if}
    <div class="meta">
      {[e.project, e.branch].filter(Boolean).join(" · ")}{e.project || e.branch ? " · " : ""}{fmtTime(e.at)}
      {#each e.tags as t}<span class="tag"> #{t}</span>{/each}
      {#if e.star}
        <button class="impact" class:high={e.impact === "high"} onclick={() => send({ type: "setImpact", id: e.id, impact: e.impact === "high" ? "normal" : "high" })}>
          {e.impact === "high" ? "▲ high impact" : "impact: normal"}</button>
      {/if}
    </div>
    {#if e.lockedAdd}
      <button class="locked" title="Added while Wintrail was locked. Confirm it's yours." onclick={() => send({ type: "confirm", id: e.id })}>added while locked · ✓ confirm</button>
    {/if}
  </div>
  <div class="actions">
    <button title="Edit" onclick={startEdit}>✎</button>
    <button title="Delete" onclick={() => send({ type: "delete", id: e.id })}>🗑</button>
  </div>
  {#if e.star}<span class="spark">✨</span>{/if}
</div>

<style>
  .entry { position: relative; display: flex; gap: 9px; padding: 9px 10px; border-radius: 11px; background: var(--card); border: 1px solid var(--border); margin-bottom: 6px; transition: background .15s, border-color .2s; }
  .entry:hover { background: var(--card-hover); }
  .entry.star { background: linear-gradient(135deg, color-mix(in srgb, var(--accent-2) 16%, var(--card)), color-mix(in srgb, var(--accent) 10%, var(--card))); border-color: color-mix(in srgb, var(--accent) 45%, transparent); box-shadow: 0 0 18px -10px var(--accent-2); }
  .entry.fresh { animation: glow 1.6s ease; }
  @keyframes glow { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 70%, transparent); } 40% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--ok) 25%, transparent); } }
  .dot { border: 0; background: none; padding: 0; width: 16px; flex: none; display: flex; justify-content: center; padding-top: 2px; }
  .o { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-top: 3px; transition: transform .15s; }
  .dot:hover .o { transform: scale(1.5); }
  .s { font-size: 13px; animation: twinkle 3.5s ease-in-out infinite; }
  @keyframes twinkle { 0%, 85% { transform: none; } 92% { transform: scale(1.35) rotate(18deg); } }
  .body { flex: 1; min-width: 0; }
  .text { line-height: 1.4; word-wrap: break-word; cursor: text; }
  .meta { color: var(--muted); font-size: 10.5px; margin-top: 3px; }
  .tag { color: #9aa5ff; }
  .impact { border: 0; background: none; color: var(--muted); font-size: 10px; padding: 0 0 0 6px; }
  .impact.high { color: #e0b84a; font-weight: 700; }
  .locked { margin-top: 5px; border: 1px dashed color-mix(in srgb, var(--warn) 60%, transparent); background: color-mix(in srgb, var(--warn) 8%, transparent); color: var(--warn); border-radius: 99px; font-size: 10px; padding: 1px 8px; }
  .actions { display: flex; gap: 2px; opacity: 0; transition: opacity .15s; align-self: flex-start; }
  .entry:hover .actions, .entry:focus-within .actions { opacity: 1; }
  .actions button { border: 0; background: none; color: var(--muted); border-radius: 6px; padding: 2px 5px; font-size: 12px; }
  .actions button:hover { background: var(--card-hover); color: var(--fg); }
  .spark { position: absolute; right: 8px; top: -4px; font-size: 11px; pointer-events: none; animation: float 1.8s ease-out both; }
  @keyframes float { from { transform: translateY(6px); opacity: 1; } to { transform: translateY(-14px); opacity: 0; } }
</style>
