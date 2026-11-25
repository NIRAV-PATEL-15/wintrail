<script lang="ts">
  import { flip } from "svelte/animate";
  import { fly, scale } from "svelte/transition";
  import type { ViewState, EntryView } from "../src/shared/protocol";
  import { send, fmtDay } from "./api";
  import QuickAdd from "./QuickAdd.svelte";
  import StatTiles from "./StatTiles.svelte";
  import Heatmap from "./Heatmap.svelte";
  import EntryCard from "./EntryCard.svelte";
  import BreakCard from "./BreakCard.svelte";
  type U = Extract<ViewState, { screen: "unlocked" }>;
  let { vs, lastAdded }: { vs: U; lastAdded: string | null } = $props();

  let q = $state("");
  let tag = $state<string | null>(null);
  let day = $state<string | null>(null);

  const topTags = $derived.by(() => {
    const m = new Map<string, number>();
    for (const e of vs.entries) for (const t of e.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  });
  const filtered = $derived(vs.entries.filter((e) =>
    (!q || e.text.toLowerCase().includes(q.toLowerCase()) || e.project.toLowerCase().includes(q.toLowerCase()))
    && (!tag || e.tags.includes(tag)) && (!day || e.day === day)));
  const groups = $derived.by(() => {
    const out: { day: string; items: EntryView[] }[] = [];
    for (const e of filtered.slice(0, 150)) {
      const g = out[out.length - 1];
      if (g && g.day === e.day) g.items.push(e); else out.push({ day: e.day, items: [e] });
    }
    return out;
  });
</script>

<QuickAdd />

{#if vs.forgedCount > 0}
  <div class="banner danger" in:scale>⚠️ {vs.forgedCount} change{vs.forgedCount > 1 ? "s" : ""} to your log were not made by you and were ignored.</div>
{/if}
{#if vs.backupWarning}
  <button class="banner warn" in:scale onclick={() => send({ type: "chooseBackupFolder" })}>
    💾 {vs.backupWarning === "none" ? "No backup yet: choose an auto-backup folder" : "Your last backup is over 30 days old"} ›</button>
{/if}

<StatTiles streak={vs.stats.streak} stars={vs.stats.starsThisMonth} entries={vs.stats.entriesThisYear} />
<Heatmap days={vs.heatmap} selected={day} onselect={(d) => (day = d)} />

<div class="section-title"><span>Your trail</span><span>{filtered.length} {filtered.length === 1 ? "entry" : "entries"}</span></div>
<div class="filters">
  <input class="field search" placeholder="Search…" bind:value={q} />
  {#if topTags.length}
    <div class="chips">
      {#each topTags as t}
        <button class="chip" class:on={tag === t} onclick={() => (tag = tag === t ? null : t)}>#{t}</button>
      {/each}
    </div>
  {/if}
</div>

{#if !vs.entries.length}
  <div class="empty" in:fly={{ y: 10 }}>
    <div class="big">🌱</div>
    <b>Your trail starts here</b>
    <p class="muted">Log what you finish, big or small. Press <b>Ctrl+Alt+L</b> anywhere in VS Code. Start with <b>!</b> to mark something exceptional.</p>
  </div>
{:else if !filtered.length}
  <div class="empty muted">Nothing matches these filters.</div>
{/if}

{#each groups as g (g.day)}
  <div class="day" in:fly={{ y: 6, duration: 200 }}>
    <span>{fmtDay(g.day, vs.today)}</span><span>{g.items.length}</span>
  </div>
  {#each g.items as e (e.id)}
    <div animate:flip={{ duration: 280 }} in:fly={{ y: 10, duration: 380, easing: (t) => 1 - Math.pow(1 - t, 3) }}>
      <EntryCard {e} fresh={e.id === lastAdded} />
    </div>
  {/each}
{/each}

<BreakCard breaks={vs.breaks} />

<style>
  .banner { display: block; width: 100%; text-align: left; margin-top: 10px; padding: 8px 10px; border-radius: 10px; font-size: 12px; border: 1px solid; }
  .banner.warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 9%, transparent); border-color: color-mix(in srgb, var(--warn) 30%, transparent); }
  .banner.danger { color: var(--danger); background: color-mix(in srgb, var(--danger) 9%, transparent); border-color: color-mix(in srgb, var(--danger) 30%, transparent); }
  .filters { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
  .search { padding: 6px 10px; }
  .chips { display: flex; gap: 4px; flex-wrap: wrap; }
  .chip { border: 1px solid var(--border); background: var(--card); color: #9aa5ff; border-radius: 99px; padding: 2px 9px; font-size: 11px; transition: background .15s, transform .1s; }
  .chip.on { background: var(--grad); color: #fff; border-color: transparent; transform: scale(1.05); }
  .day { display: flex; justify-content: space-between; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 12px 2px 6px; }
  .empty { text-align: center; padding: 22px 10px; }
  .empty .big { font-size: 30px; animation: sway 3s ease-in-out infinite; }
  @keyframes sway { 50% { transform: rotate(8deg) translateY(-3px); } }
  .empty p { font-size: 12px; line-height: 1.5; }
</style>
