<script lang="ts">
  let { days, selected, onselect }: { days: { day: string; count: number; level: number }[]; selected: string | null; onselect: (d: string | null) => void } = $props();
  let hover = $state<{ day: string; count: number } | null>(null);
  const label = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
</script>

<div class="section-title"><span>Last 18 weeks</span>
  <span class="legend">less <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> more</span></div>
<div class="grid" role="group" aria-label="Activity heatmap" onmouseleave={() => (hover = null)}>
  {#each days as d, i (d.day)}
    <button class="cell l{d.level}" class:sel={selected === d.day} style="animation-delay:{i * 5}ms"
      aria-label="{label(d.day)}: {d.count} entries" onmouseenter={() => (hover = d)}
      onclick={() => onselect(selected === d.day ? null : d.day)}></button>
  {/each}
</div>
<div class="tip muted">{hover ? `${label(hover.day)} · ${hover.count} ${hover.count === 1 ? "entry" : "entries"}` : selected ? `Showing ${label(selected)} · click again to clear` : "Hover a day · click to filter"}</div>

<style>
  .grid { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 1fr); gap: 3px; }
  .cell { aspect-ratio: 1; border: 0; padding: 0; border-radius: 3px; animation: grow .35s cubic-bezier(.2,1.3,.4,1) both; transition: transform .12s, outline-color .12s; outline: 1.5px solid transparent; }
  .cell:hover { transform: scale(1.35); z-index: 1; }
  .cell.sel { outline-color: var(--fg); }
  .l0 { background: color-mix(in srgb, var(--fg) 8%, transparent); }
  .l1 { background: #3a4590; } .l2 { background: #4f5fd0; } .l3 { background: #6a7cff; } .l4 { background: #b38bff; }
  @keyframes grow { from { transform: scale(0); opacity: 0; } }
  .legend { display: flex; gap: 3px; align-items: center; text-transform: none; letter-spacing: 0; }
  .legend i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .tip { font-size: 10.5px; margin-top: 6px; min-height: 14px; }
</style>
