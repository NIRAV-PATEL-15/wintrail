<script lang="ts">
  import { fly } from "svelte/transition";
  import { Tween } from "svelte/motion";
  import { cubicOut } from "svelte/easing";
  import type { YearView } from "../src/shared/protocol";
  import { send, monthName } from "./api";
  let { year }: { year: YearView } = $props();
  const total = new Tween(0, { duration: 900, easing: cubicOut });
  const stars = new Tween(0, { duration: 900, easing: cubicOut });
  $effect(() => { total.target = year.total; stars.target = year.highlights.length; });
  const max = $derived(Math.max(1, ...year.byProject.map(([, n]) => n)));
  const months = $derived.by(() => {
    const out: { label: string; items: typeof year.highlights }[] = [];
    for (const h of year.highlights) {
      const label = monthName(h.at);
      const g = out[out.length - 1];
      if (g && g.label === label) g.items.push(h); else out.push({ label, items: [h] });
    }
    return out;
  });
</script>

<div class="hero">
  <div class="sel">
    <button class="nav" onclick={() => send({ type: "selectYear", offset: Math.max(-50, year.offset - 1) })} aria-label="Previous year">‹</button>
    {#key year.label}<h2 in:fly={{ y: -6, duration: 250 }}>Your {year.label} at work ✨</h2>{/key}
    <button class="nav" disabled={year.offset >= 0} onclick={() => send({ type: "selectYear", offset: Math.min(0, year.offset + 1) })} aria-label="Next year">›</button>
  </div>
  <div class="nums"><span><b>{Math.round(total.current)}</b> entries</span><span><b>{year.projects}</b> projects</span><span><b>{Math.round(stars.current)}</b> highlights</span></div>
  {#key year.label}
    <div class="bars">
      {#each year.byProject as [name, n], i}
        <div class="bar-row"><span class="pname">{name}</span><span class="n">{n}</span></div>
        <div class="bar" style="--w:{(n / max) * 100}%; animation-delay:{i * 90}ms"></div>
      {/each}
      {#if !year.byProject.length}<div class="muted">No entries in this period yet.</div>{/if}
    </div>
  {/key}
</div>

{#if year.byTag.length}
  <div class="section-title"><span>Tags</span></div>
  <div class="tags">{#each year.byTag as [t, n], i}<span class="tag" style="animation-delay:{i * 40}ms">#{t} <b>{n}</b></span>{/each}</div>
{/if}

<div class="section-title"><span>⭐ Highlights</span><span>{year.highlights.length}</span></div>
{#each months as m}
  <div class="month">{m.label}</div>
  {#each m.items as h, i}
    <div class="hl" in:fly={{ x: -10, delay: i * 60, duration: 300 }}>
      <span>⭐</span><div><div>{h.text}</div><div class="muted meta">{h.project}{h.tags.length ? " · " + h.tags.map((t) => "#" + t).join(" ") : ""}{h.impact === "high" ? " · ▲ high impact" : ""}</div></div>
    </div>
  {/each}
{:else}
  <div class="muted empty">Start an entry with <b>!</b> (or tap its dot) to mark exceptional work. It will show up here for your appraisal.</div>
{/each}

<div class="actions">
  <button class="btn primary" onclick={() => send({ type: "exportAppraisal", offset: year.offset })}>Export for appraisal (Markdown)</button>
  <button class="btn" onclick={() => send({ type: "copyHighlights", offset: year.offset })}>Copy highlights</button>
</div>

<style>
  .hero { margin-top: 8px; padding: 14px; border-radius: 14px; color: #e6e6ff; background: radial-gradient(circle at 30% 0, #2b2f6b, #141428 75%); box-shadow: 0 12px 30px -18px #6a4cff; }
  .sel { display: flex; align-items: center; gap: 6px; }
  .sel h2 { flex: 1; margin: 0; font-size: 15px; text-align: center; color: #fff; }
  .nav { border: 0; background: #ffffff18; color: #fff; width: 26px; height: 26px; border-radius: 8px; font-size: 15px; }
  .nav:disabled { opacity: .3; }
  .nums { display: flex; justify-content: space-around; margin: 10px 0 12px; font-size: 11px; color: #aab; }
  .nums b { display: block; font-size: 18px; color: #fff; text-align: center; font-variant-numeric: tabular-nums; }
  .bar-row { display: flex; justify-content: space-between; font-size: 11.5px; }
  .n { color: #aab; }
  .bar { height: 7px; border-radius: 9px; background: linear-gradient(90deg, #6a7cff, #b38bff); width: var(--w); margin: 3px 0 8px; animation: grow 1.2s cubic-bezier(.2,1,.3,1) both; }
  @keyframes grow { from { width: 0; } }
  .tags { display: flex; flex-wrap: wrap; gap: 5px; }
  .tag { font-size: 11px; padding: 2px 9px; border-radius: 99px; background: var(--card); border: 1px solid var(--border); color: #9aa5ff; animation: pop .4s both; }
  @keyframes pop { from { transform: scale(.7); opacity: 0; } }
  .month { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 10px 2px 5px; }
  .hl { display: flex; gap: 8px; padding: 8px 10px; margin-bottom: 5px; border-radius: 10px; background: linear-gradient(135deg, color-mix(in srgb, var(--accent-2) 14%, var(--card)), var(--card)); border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); font-size: 12.5px; }
  .meta { font-size: 10.5px; margin-top: 2px; }
  .empty { font-size: 12px; padding: 8px 2px; line-height: 1.5; }
  .actions { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; }
</style>
