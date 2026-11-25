<script lang="ts">
  import type { BreakConfig, BreakKind } from "../src/core/breaks";
  import { untrack } from "svelte";
  import { send } from "./api";
  let { config }: { config: BreakConfig } = $props();
  let c = $state<BreakConfig>(untrack(() => structuredClone($state.snapshot(config)) as BreakConfig));
  let dirtyAt = 0;
  $effect(() => { const fresh = $state.snapshot(config) as BreakConfig; if (Date.now() - dirtyAt > 1500) c = structuredClone(fresh); });
  let timer: ReturnType<typeof setTimeout> | undefined;
  function changed() {
    dirtyAt = Date.now();
    clearTimeout(timer);
    timer = setTimeout(() => {
      const snap = $state.snapshot(c) as BreakConfig;
      const wh = snap.workHours && snap.workHours.start && snap.workHours.end ? snap.workHours : undefined;
      const { workHours: _w, ...rest } = snap;
      send({ type: "setBreaks", config: { ...rest, ...(wh ? { workHours: wh } : {}) } });
    }, 350);
  }
  const KINDS: [BreakKind, string, number, number][] = [["eyes", "👀 Eyes", 5, 120], ["stretch", "🧘 Stretch", 10, 240], ["water", "💧 Water", 15, 240]];
  let hoursOn = $state(untrack(() => !!config.workHours));
  function toggleHours() {
    hoursOn = !hoursOn;
    c.workHours = hoursOn ? (c.workHours ?? { start: "09:00", end: "18:00" }) : undefined;
    changed();
  }
</script>

<div class="settings">
  {#each KINDS as [k, label, lo, hi]}
    <div class="row">
      <label class="sw"><input type="checkbox" bind:checked={c.enabled[k]} onchange={changed} /><span></span></label>
      <span class="name">{label}</span>
      <input type="range" min={lo} max={hi} bind:value={c.intervals[k]} oninput={changed} disabled={!c.enabled[k]} />
      <span class="val">{c.intervals[k]}m</span>
    </div>
    <div class="sub">
      <select class="field mini" bind:value={c.style[k]} onchange={changed}>
        <option value="notification">Notification</option><option value="screen">Full break screen</option>
      </select>
      <button class="link" onclick={() => send({ type: "previewBreak", kind: k })}>Preview</button>
    </div>
  {/each}
  <div class="row"><span class="name wide">Eye-break length</span><input type="range" min="10" max="120" bind:value={c.eyeSeconds} oninput={changed} /><span class="val">{c.eyeSeconds}s</span></div>
  <div class="row"><span class="name wide">Stretch length</span><input type="range" min="30" max="600" step="10" bind:value={c.stretchSeconds} oninput={changed} /><span class="val">{c.stretchSeconds}s</span></div>
  <div class="row"><span class="name wide">Snooze</span><input type="range" min="1" max="60" bind:value={c.snoozeMin} oninput={changed} /><span class="val">{c.snoozeMin}m</span></div>
  <div class="row"><span class="name wide">Pause after idle</span><input type="range" min="1" max="30" bind:value={c.idleMin} oninput={changed} /><span class="val">{c.idleMin}m</span></div>
  <div class="row"><span class="name wide">Real break after</span><input type="range" min="1" max="60" bind:value={c.resetMin} oninput={changed} /><span class="val">{c.resetMin}m</span></div>
  <div class="row">
    <span class="name wide">Focus presets</span>
    {#each c.focusPresets as _, i}<input class="field num" type="number" min="15" max="480" step="15" bind:value={c.focusPresets[i]} onchange={changed} />{/each}
    <span class="val">min</span>
  </div>
  <div class="row">
    <label class="sw"><input type="checkbox" checked={hoursOn} onchange={toggleHours} /><span></span></label>
    <span class="name">Working hours only</span>
    {#if hoursOn && c.workHours}
      <input class="field time" type="time" bind:value={c.workHours.start} onchange={changed} />–<input class="field time" type="time" bind:value={c.workHours.end} onchange={changed} />
    {/if}
  </div>
  <button class="btn block" onclick={() => send({ type: "resetBreaks" })}>Reset to defaults</button>
</div>

<style>
  .settings { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 7px; }
  .row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .name { width: 70px; flex: none; } .name.wide { width: 108px; }
  .row input[type=range] { flex: 1; min-width: 0; accent-color: var(--accent); }
  .val { width: 38px; text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); font-size: 11px; }
  .sub { display: flex; gap: 8px; align-items: center; margin: -2px 0 4px 44px; }
  .mini { padding: 3px 6px; font-size: 11px; width: auto; }
  .num { width: 58px; padding: 3px 6px; }
  .time { width: auto; padding: 3px 6px; }
  .link { border: 0; background: none; color: #9aa5ff; font-size: 11px; padding: 0; }
  .sw { position: relative; width: 30px; height: 17px; flex: none; }
  .sw input { opacity: 0; width: 0; height: 0; position: absolute; }
  .sw span { position: absolute; inset: 0; border-radius: 99px; background: var(--border); transition: background .2s; }
  .sw span::before { content: ""; position: absolute; width: 13px; height: 13px; left: 2px; top: 2px; border-radius: 50%; background: #fff; transition: transform .25s cubic-bezier(.3,1.4,.5,1); }
  .sw input:checked + span { background: var(--accent); }
  .sw input:checked + span::before { transform: translateX(13px); }
</style>
