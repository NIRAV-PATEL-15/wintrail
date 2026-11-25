<script lang="ts">
  import { send } from "./api";
  let { locked = false }: { locked?: boolean } = $props();
  let text = $state("");
  let flash = $state(false);
  function go(e: Event) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    send({ type: "quickAdd", text: t });
    text = "";
    flash = true;
    setTimeout(() => (flash = false), 700);
  }
  const star = $derived(text.trim().startsWith("!"));
</script>

<form class="quick" class:flash class:star onsubmit={go}>
  <span class="pen">{star ? "⭐" : "✎"}</span>
  <input bind:value={text} maxlength="500" placeholder="What did you just finish?" aria-label="Log a win" />
  {#if text.trim()}<button class="go" aria-label="Save">↵</button>{/if}
</form>
<div class="hint">Enter to save · start with <b>!</b> for a ⭐ highlight · <b>#tags</b>{locked ? " · works while locked" : ""}</div>

<style>
  .quick { display: flex; gap: 8px; align-items: center; background: var(--input); border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: 11px; padding: 6px 6px 6px 11px; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent); transition: box-shadow .3s, border-color .3s; }
  .quick:focus-within { box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent); }
  .quick.star { border-color: #e0b84a; box-shadow: 0 0 0 4px #e0b84a33; }
  .quick.flash { animation: flash .7s ease; }
  @keyframes flash { 30% { box-shadow: 0 0 0 7px color-mix(in srgb, var(--ok) 45%, transparent); border-color: var(--ok); } }
  .pen { color: var(--accent); width: 16px; text-align: center; transition: transform .3s; }
  .star .pen { transform: scale(1.2) rotate(-10deg); }
  input { flex: 1; min-width: 0; border: 0; outline: none; background: none; color: var(--input-fg); padding: 5px 0; }
  .go { border: 0; border-radius: 8px; background: var(--grad); color: #fff; width: 28px; height: 26px; font-weight: 700; }
  .hint { font-size: 10.5px; color: var(--muted); margin: 6px 3px 0; }
</style>
