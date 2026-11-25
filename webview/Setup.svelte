<script lang="ts">
  import { fly } from "svelte/transition";
  import { send, strength } from "./api";
  let { error = "", busy = false, onsubmit }: { error?: string; busy?: boolean; onsubmit: () => void } = $props();
  let pw = $state(""), pw2 = $state(""), local = $state("");
  const s = $derived(strength(pw));
  function go(e: Event) {
    e.preventDefault();
    local = pw.length < 8 ? "Use at least 8 characters" : pw !== pw2 ? "Passwords don't match" : "";
    if (local) return;
    onsubmit();
    send({ type: "create", password: pw });
  }
</script>

<form class="auth" onsubmit={go} in:fly={{ y: 12, duration: 350 }}>
  <div class="logo">✨</div>
  <h1>Start your Wintrail</h1>
  <p class="muted">A private trail of your work wins, for standups and appraisals. Your log is encrypted with this password and never leaves this machine.</p>
  <input class="field" type="password" placeholder="Choose a password" bind:value={pw} autocomplete="new-password" />
  <div class="meter"><div style="width:{pw ? 10 + s.score * 22.5 : 0}%" class="s{s.score}"></div></div>
  {#if pw}<div class="meter-label muted">{s.label}</div>{/if}
  <input class="field" type="password" placeholder="Repeat password" bind:value={pw2} autocomplete="new-password" />
  <div class="note">⚠️ There is no password recovery. Turn on auto-backup after setup.</div>
  {#if local || error}<div class="error">{local || error}</div>{/if}
  <button class="btn primary block" disabled={busy}>{busy ? "Creating…" : "Create my log"}</button>
</form>

<style>
  .auth { max-width: 330px; margin: 0 auto; padding: 40px 6px; display: flex; flex-direction: column; gap: 10px; }
  .logo { font-size: 38px; text-align: center; animation: bob 3s ease-in-out infinite; }
  @keyframes bob { 50% { transform: translateY(-4px) rotate(6deg); } }
  h1 { font-size: 18px; margin: 0; text-align: center; }
  p { margin: 0 0 6px; text-align: center; font-size: 12px; line-height: 1.5; }
  .meter { height: 5px; border-radius: 9px; background: var(--border); overflow: hidden; margin-top: -4px; }
  .meter div { height: 100%; transition: width .3s, background .3s; }
  .s0, .s1 { background: var(--danger); } .s2 { background: var(--warn); } .s3, .s4 { background: var(--ok); }
  .meter-label { font-size: 11px; margin-top: -6px; text-align: right; }
  .note { font-size: 11.5px; color: var(--warn); background: color-mix(in srgb, var(--warn) 10%, transparent); border-radius: 8px; padding: 7px 10px; }
</style>
