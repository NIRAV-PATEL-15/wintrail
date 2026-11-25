<script lang="ts">
  import { fly } from "svelte/transition";
  import type { StandupView } from "../src/shared/protocol";
  import { send } from "./api";
  let { standup }: { standup: StandupView } = $props();
  let yesterday = $state(""), today = $state(""), blockers = $state("");
  let touched = $state(false);
  $effect(() => {
    const s = standup;
    if (touched) return;
    yesterday = s.yesterday.join("\n"); today = s.today; blockers = s.blockers;
  });
  const lines = $derived(yesterday.split("\n").map((l) => l.replace(/^[•\-*]\s*/, "").trim()).filter(Boolean));
  const preview = $derived(["Yesterday", ...(lines.length ? lines : ["Nothing logged"]).map((l) => "• " + l), "Today", "• " + (today.trim() || "—"), "Blockers", "• " + (blockers.trim() || "None")].join("\n"));
  let copied = $state(false);
  function copy() {
    send({ type: "copyStandup", yesterday: lines.slice(0, 10), today: today.trim(), blockers: blockers.trim() });
    copied = true; setTimeout(() => (copied = false), 1800);
  }
  const dayLabel = $derived(new Date(standup.previousDay + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" }));
</script>

<div class="wrap" in:fly={{ y: 8 }}>
  {#if standup.previousPlan}
    <div class="plan">📌 On {dayLabel} you planned: <b>{standup.previousPlan}</b></div>
  {/if}
  <div class="lbl">Yesterday <span class="muted">({dayLabel})</span></div>
  <textarea class="field" rows="4" bind:value={yesterday} oninput={() => (touched = true)} placeholder="Nothing logged — add a line per item"></textarea>
  <div class="lbl">Today</div>
  <input class="field" bind:value={today} oninput={() => (touched = true)} placeholder="What you'll work on" />
  <div class="lbl">Blockers</div>
  <input class="field" bind:value={blockers} oninput={() => (touched = true)} placeholder="None" />
  <div class="section-title"><span>Teams preview</span></div>
  <pre class="preview">{preview}</pre>
  <button class="btn primary block copy" class:done={copied} onclick={copy}>{copied ? "✓ Copied: paste into Teams" : "Copy for Teams"}</button>
  {#if touched}<button class="link" onclick={() => { touched = false; yesterday = standup.yesterday.join("\n"); today = standup.today; blockers = standup.blockers; }}>Reset draft</button>{/if}
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; }
  .plan { padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, var(--accent) 12%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); font-size: 12px; }
  .lbl { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-top: 6px; }
  textarea { resize: vertical; line-height: 1.5; }
  .preview { margin: 0; padding: 10px; border-radius: 10px; background: var(--card); border: 1px solid var(--border); font-family: var(--vscode-font-family); white-space: pre-wrap; font-size: 12px; line-height: 1.55; }
  .copy { margin-top: 6px; transition: background .3s; }
  .copy.done { background: var(--ok); animation: pulse .5s; }
  @keyframes pulse { 50% { transform: scale(1.03); } }
  .link { border: 0; background: none; color: #9aa5ff; font-size: 11px; }
</style>
