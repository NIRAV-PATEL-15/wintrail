<script lang="ts">
  import { Tween } from "svelte/motion";
  import { cubicOut } from "svelte/easing";
  let { streak, stars, entries }: { streak: number; stars: number; entries: number } = $props();
  const a = new Tween(0, { duration: 900, easing: cubicOut });
  const b = new Tween(0, { duration: 900, easing: cubicOut });
  const c = new Tween(0, { duration: 900, easing: cubicOut });
  $effect(() => { a.target = streak; b.target = stars; c.target = entries; });
</script>

<div class="tiles">
  <div class="tile"><b><span class="flame" class:lit={streak > 0}>🔥</span>{Math.round(a.current)}</b><span>day streak</span></div>
  <div class="tile"><b>⭐ {Math.round(b.current)}</b><span>this month</span></div>
  <div class="tile"><b>{Math.round(c.current)}</b><span>entries this year</span></div>
</div>

<style>
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 12px; }
  .tile { background: var(--card); border: 1px solid var(--border); border-radius: 11px; padding: 9px 4px; text-align: center; animation: pop .5s cubic-bezier(.2,1.4,.4,1) both; }
  .tile:nth-child(2) { animation-delay: .06s; } .tile:nth-child(3) { animation-delay: .12s; }
  .tile b { display: block; font-size: 19px; font-variant-numeric: tabular-nums; }
  .tile span { font-size: 10px; color: var(--muted); }
  .flame { display: inline-block; filter: grayscale(1) opacity(.5); }
  .flame.lit { filter: none; animation: flick 1.2s ease-in-out infinite alternate; }
  @keyframes flick { from { transform: scale(1) rotate(-5deg); } to { transform: scale(1.15) rotate(5deg); } }
  @keyframes pop { from { transform: translateY(8px) scale(.95); opacity: 0; } }
</style>
