<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import { untrack } from "svelte";
  import { breakApi as vs } from "./breakApi";
  let { data }: { data: { kind: string; seconds: number; title: string; body: string; icon: string; snoozeMin: number } } = $props();
  const total = untrack(() => Math.max(1, data.seconds));
  let left = $state(total);
  const STRETCH = ["Roll your shoulders back ×5", "Tilt your head left, then right", "Interlace fingers, stretch arms up", "Stretch each wrist gently", "Stand up and take 3 deep breaths"];
  const step = $derived(data.kind === "stretch" ? STRETCH[Math.min(STRETCH.length - 1, Math.floor(((total - left) / total) * STRETCH.length))] : "");
  const t = setInterval(() => { left = Math.max(0, left - 1); if (!left) { clearInterval(t); setTimeout(() => vs.postMessage({ type: "done" }), 1200); } }, 1000);
</script>

<div class="screen" in:fade>
  <div class="orb">{data.icon}</div>
  <h1>{left ? data.title : "Nice, break done ✓"}</h1>
  <p>{data.body}</p>
  {#if step}{#key step}<div class="step" in:fly={{ y: 8 }}>{step}</div>{/key}{/if}
  <div class="count">{left}s</div>
  <div class="bar"><div style="width:{((total - left) / total) * 100}%"></div></div>
  <div class="btns">
    <button class="p" onclick={() => vs.postMessage({ type: "done" })}>Done ✓</button>
    <button onclick={() => vs.postMessage({ type: "snooze" })}>Snooze {data.snoozeMin}m</button>
    <button onclick={() => vs.postMessage({ type: "skip" })}>Skip</button>
  </div>
  <div class="hint">Breathe in as the circle grows… out as it shrinks</div>
</div>

<style>
  :global(body) { margin: 0; font-family: var(--vscode-font-family, system-ui); }
  .screen { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #fff; text-align: center; padding: 20px; background: radial-gradient(circle at 50% 38%, #2b2f6b, #14152b 70%); }
  .orb { width: 140px; height: 140px; border-radius: 50%; display: grid; place-items: center; font-size: 44px; background: radial-gradient(circle at 35% 35%, #8ea2ff, #6a4cff 60%, #4a2fd6); box-shadow: 0 0 70px #6a4cff99; animation: breathe 8s ease-in-out infinite; }
  @keyframes breathe { 0%, 100% { transform: scale(.8); } 50% { transform: scale(1.1); } }
  h1 { margin: 6px 0 0; font-size: 22px; }
  p { margin: 0; color: #aab; max-width: 420px; }
  .step { font-size: 15px; font-weight: 600; color: #d9ccff; }
  .count { font-size: 34px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .bar { width: 240px; height: 6px; border-radius: 9px; background: #ffffff22; overflow: hidden; }
  .bar div { height: 100%; background: linear-gradient(90deg, #8ea2ff, #c08bff); transition: width 1s linear; }
  .btns { display: flex; gap: 8px; margin-top: 8px; }
  button { border: 0; border-radius: 9px; padding: 8px 16px; background: #ffffff1c; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button.p { background: linear-gradient(135deg, #6a7cff, #a35bff); }
  .hint { font-size: 12px; color: #8890b0; margin-top: 6px; }
  @media (prefers-reduced-motion: reduce) { .orb { animation: none; } }
</style>
