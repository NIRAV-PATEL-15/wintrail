<script lang="ts">
  import { fly } from "svelte/transition";
  import { send } from "./api";
  let { remember, throttledMs = 0, error = "", busy = false, onsubmit }:
    { remember: boolean; throttledMs?: number; error?: string; busy?: boolean; onsubmit: () => void } = $props();
  let pw = $state("");
  let rem = $state(false);
  let wait = $state(0);
  $effect(() => { rem = remember; });
  $effect(() => {
    if (!throttledMs) return;
    const until = Date.now() + throttledMs;
    wait = Math.ceil(throttledMs / 1000);
    const t = setInterval(() => { wait = Math.max(0, Math.ceil((until - Date.now()) / 1000)); if (!wait) clearInterval(t); }, 250);
    return () => clearInterval(t);
  });
  function go(e: Event) {
    e.preventDefault();
    if (!pw) return;
    onsubmit();
    send({ type: "unlock", password: pw, remember: rem });
    pw = "";
  }
</script>

<form class="card" onsubmit={go} in:fly={{ y: 10, duration: 300 }}>
  <div class="orb">🔒</div>
  <div class="title">Unlock to see your log</div>
  <div class="muted sub">You can still log wins above without unlocking.</div>
  <input class="field" type="password" placeholder="Wintrail password" bind:value={pw} />
  <label class="check"><input type="checkbox" bind:checked={rem} /> Remember on this machine</label>
  {#if error}<div class="error">{error}</div>{/if}
  <button class="btn primary block" disabled={busy || wait > 0}>{wait > 0 ? `Try again in ${wait}s` : busy ? "Unlocking…" : "Unlock"}</button>
</form>

<style>
  .card { margin-top: 18px; padding: 18px 14px; border-radius: var(--r); background: var(--card); border: 1px solid var(--border); display: flex; flex-direction: column; gap: 9px; text-align: center; }
  .orb { width: 54px; height: 54px; margin: 0 auto; border-radius: 50%; display: grid; place-items: center; font-size: 22px; background: radial-gradient(circle at 35% 30%, #8ea2ff, #6a4cff 65%); box-shadow: 0 10px 30px -10px #6a4cff; animation: breathe 4s ease-in-out infinite; }
  @keyframes breathe { 50% { transform: scale(1.06); box-shadow: 0 10px 40px -6px #6a4cff; } }
  .title { font-weight: 700; font-size: 14px; }
  .sub { font-size: 11.5px; margin-top: -4px; }
  .check { display: flex; gap: 6px; align-items: center; justify-content: center; font-size: 11.5px; color: var(--muted); }
</style>
