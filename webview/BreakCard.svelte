<script lang="ts">
  import { slide } from "svelte/transition";
  import type { BreaksView } from "../src/shared/protocol";
  import { send } from "./api";
  import BreakSettings from "./BreakSettings.svelte";
  let { breaks }: { breaks: BreaksView } = $props();
  let open = $state(false);
  const KINDS = [["eyes", "👀", "Eyes"], ["stretch", "🧘", "Stretch"], ["water", "💧", "Water"]] as const;
  const focusLeft = $derived(breaks.focusEndsAt ? Math.max(1, Math.round((breaks.focusEndsAt - Date.now()) / 60000)) : 0);
  const fmt = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${m}m`);
</script>

<div class="section-title"><span>Break Buddy · this week</span>
  <button class="gear" class:on={open} title="Break settings" aria-label="Break settings" onclick={() => (open = !open)}>⚙</button></div>
<div class="card">
  <div class="kinds">
    {#each KINDS as [k, icon, label]}
      {@const w = breaks.week[k]}
      {@const pct = w.due ? Math.round((w.taken / w.due) * 100) : 0}
      <div class="kind" class:off={!breaks.config.enabled[k]}>
        <svg viewBox="0 0 36 36" class="ring"><circle class="track" cx="18" cy="18" r="15" /><circle class="prog" cx="18" cy="18" r="15" pathLength="100" style="stroke-dashoffset:{100 - pct}" /></svg>
        <span class="ico">{icon}</span>
        <b>{w.taken}/{w.due}</b><span class="muted">{label} · {breaks.config.intervals[k]}m</span>
      </div>
    {/each}
  </div>
  <div class="focus">
    {#if breaks.focusEndsAt}
      <span>🔕 Focus mode · {focusLeft} min left</span><button class="btn" onclick={() => send({ type: "focus", minutes: 0 })}>End</button>
    {:else}
      <span class="muted">Focus mode</span>
      {#each breaks.config.focusPresets as m}<button class="btn" onclick={() => send({ type: "focus", minutes: m })}>{fmt(m)}</button>{/each}
    {/if}
  </div>
  {#if open}<div transition:slide={{ duration: 250 }}><BreakSettings config={breaks.config} /></div>{/if}
</div>

<style>
  .gear { border: 0; background: none; color: var(--muted); font-size: 14px; transition: transform .4s; }
  .gear.on, .gear:hover { color: var(--fg); transform: rotate(90deg); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--r); padding: 12px; }
  .kinds { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; text-align: center; }
  .kind { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11px; transition: opacity .2s; }
  .kind.off { opacity: .4; }
  .ring { width: 46px; height: 46px; transform: rotate(-90deg); }
  .ring circle { fill: none; stroke-width: 3.2; }
  .track { stroke: var(--border); }
  .prog { stroke: url(#g); stroke: var(--accent); stroke-dasharray: 100; stroke-linecap: round; transition: stroke-dashoffset 1s cubic-bezier(.3,1,.4,1); }
  .ico { position: absolute; top: 12px; font-size: 16px; }
  .kind b { font-variant-numeric: tabular-nums; }
  .kind .muted { font-size: 10px; }
  .focus { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); font-size: 12px; }
  .focus span { flex: 1; }
  .focus .btn { padding: 3px 10px; font-size: 11px; }
</style>
