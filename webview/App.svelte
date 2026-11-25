<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import type { HostMsg, ViewState } from "../src/shared/protocol";
  import { send } from "./api";
  import Setup from "./Setup.svelte";
  import Lock from "./Lock.svelte";
  import QuickAdd from "./QuickAdd.svelte";
  import Today from "./Today.svelte";
  import Standup from "./Standup.svelte";
  import Year from "./Year.svelte";
  import Menu from "./Menu.svelte";

  let view = $state<ViewState | null>(null);
  let tab = $state<"today" | "standup" | "year">("today");
  let errors = $state<Record<string, string>>({});
  let busy = $state<Record<string, boolean>>({});
  let toasts = $state<{ id: number; text: string; kind?: string }[]>([]);
  let lastAdded = $state<string | null>(null);
  let menuOpen = $state(false);
  let toastId = 0;

  function toast(text: string, kind?: string) {
    const id = ++toastId;
    toasts = [...toasts, { id, text, kind }];
    setTimeout(() => (toasts = toasts.filter((t) => t.id !== id)), 2800);
  }

  window.addEventListener("message", (ev: MessageEvent<HostMsg>) => {
    const m = ev.data;
    switch (m.type) {
      case "state":
        view = m.state;
        if (m.state.screen !== "unlocked") menuOpen = false;
        break;
      case "toast": toast(m.text, m.kind); break;
      case "error": errors = { ...errors, [m.form]: m.text }; busy = { ...busy, [m.form]: false }; break;
      case "done": errors = { ...errors, [m.form]: "" }; busy = { ...busy, [m.form]: false }; break;
      case "tab": tab = m.tab; break;
      case "added": lastAdded = m.id; setTimeout(() => (lastAdded = null), 2500); break;
    }
  });

  const submit = (form: string) => { errors = { ...errors, [form]: "" }; busy = { ...busy, [form]: true }; };

  let lastAct = 0;
  const activity = () => { if (Date.now() - lastAct > 20_000) { lastAct = Date.now(); send({ type: "activity" }); } };

  send({ type: "ready" });
</script>

<svelte:window onclick={activity} onkeydown={activity} />

<div class="root">
  {#if !view}
    <div class="center muted">Loading…</div>
  {:else if view.screen === "setup"}
    <Setup error={errors.create} busy={busy.create} onsubmit={() => submit("create")} />
  {:else if view.screen === "locked"}
    <div class="locked-wrap" in:fade>
      <QuickAdd locked />
      <Lock remember={view.remember} throttledMs={view.throttledMs} error={errors.unlock} busy={busy.unlock}
        onsubmit={() => submit("unlock")} />
    </div>
  {:else}
    {@const s = view}
    <header class="top">
      <div class="tabs" role="tablist">
        {#each [["today", "Today"], ["standup", "Standup"], ["year", "Year"]] as [id, label]}
          <button role="tab" class:on={tab === id} aria-selected={tab === id} onclick={() => (tab = id as typeof tab)}>{label}</button>
        {/each}
        <span class="pill" style="--i:{['today', 'standup', 'year'].indexOf(tab)}"></span>
      </div>
      <button class="icon-btn" title="Menu" aria-label="Menu" onclick={() => (menuOpen = !menuOpen)}>⋯</button>
      <button class="icon-btn" title="Lock" aria-label="Lock" onclick={() => send({ type: "lock" })}>🔒</button>
    </header>
    {#if menuOpen}
      <Menu vs={s} error={errors.changePassword} busy={busy.changePassword} onclose={() => (menuOpen = false)}
        onsubmit={() => submit("changePassword")} />
    {/if}
    {#key tab}
      <main in:fly={{ y: 8, duration: 220 }}>
        {#if tab === "today"}
          <Today vs={s} {lastAdded} />
        {:else if tab === "standup"}
          <Standup standup={s.standup} />
        {:else}
          <Year year={s.year} />
        {/if}
      </main>
    {/key}
  {/if}

  <div class="toasts" aria-live="polite">
    {#each toasts as t (t.id)}
      <div class="toast {t.kind ?? ''}" in:fly={{ y: 12, duration: 200 }} out:fade={{ duration: 200 }}>{t.text}</div>
    {/each}
  </div>
</div>

<style>
  :global(:root) {
    --bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
    --fg: var(--vscode-foreground);
    --muted: var(--vscode-descriptionForeground);
    --card: color-mix(in srgb, var(--vscode-foreground) 5%, var(--bg));
    --card-hover: color-mix(in srgb, var(--vscode-foreground) 9%, var(--bg));
    --border: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
    --accent: #6a7cff;
    --accent-2: #b38bff;
    --grad: linear-gradient(135deg, var(--accent), var(--accent-2));
    --danger: var(--vscode-errorForeground, #f14c4c);
    --warn: var(--vscode-editorWarning-foreground, #cca700);
    --ok: var(--vscode-testing-iconPassed, #3fb950);
    --input: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --focus: var(--vscode-focusBorder);
    --mono: var(--vscode-editor-font-family, monospace);
    --r: 12px;
  }
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; padding: 0; background: var(--bg); color: var(--fg); font-family: var(--vscode-font-family); font-size: 13px; }
  :global(button) { font: inherit; color: inherit; cursor: pointer; }
  :global(input), :global(textarea), :global(select) { font: inherit; }
  :global(.muted) { color: var(--muted); }
  :global(.btn) { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--border); background: var(--card); border-radius: 9px; padding: 7px 12px; font-weight: 600; transition: transform .08s, background .15s, filter .15s; }
  :global(.btn:hover) { background: var(--card-hover); }
  :global(.btn:active) { transform: scale(.97); }
  :global(.btn.primary) { background: var(--grad); color: #fff; border-color: transparent; box-shadow: 0 6px 18px -8px var(--accent); }
  :global(.btn.primary:hover) { filter: brightness(1.08); }
  :global(.btn:disabled) { opacity: .55; cursor: not-allowed; }
  :global(.btn.block) { width: 100%; }
  :global(.field) { width: 100%; background: var(--input); color: var(--input-fg); border: 1px solid var(--border); border-radius: 9px; padding: 8px 10px; outline: none; transition: border-color .15s, box-shadow .15s; }
  :global(.field:focus) { border-color: var(--focus); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent); }
  :global(.error) { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); border-radius: 8px; padding: 7px 10px; font-size: 12px; margin: 8px 0; }
  :global(.section-title) { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 16px 2px 8px; display: flex; justify-content: space-between; align-items: center; }
  :global(:focus-visible) { outline: 2px solid var(--focus); outline-offset: 1px; }
  @media (prefers-reduced-motion: reduce) { :global(*) { animation: none !important; transition: none !important; } }

  .root { padding: 0 10px 40px; min-height: 100vh; }
  .center { display: grid; place-items: center; min-height: 60vh; }
  .locked-wrap { padding-top: 12px; }
  .top { position: sticky; top: 0; z-index: 5; display: flex; gap: 4px; align-items: center; padding: 10px 0 8px; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(8px); }
  .tabs { position: relative; flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); background: var(--card); border-radius: 10px; padding: 3px; }
  .tabs button { position: relative; z-index: 1; border: 0; background: none; padding: 6px 0; border-radius: 8px; color: var(--muted); font-weight: 650; font-size: 12px; transition: color .2s; }
  .tabs button.on { color: var(--fg); }
  .pill { position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / 3); border-radius: 8px; background: var(--bg); box-shadow: 0 1px 6px rgba(0,0,0,.25); transform: translateX(calc(var(--i) * 100%)); transition: transform .3s cubic-bezier(.3,1.3,.5,1); }
  .icon-btn { width: 30px; height: 30px; border: 0; background: none; border-radius: 8px; color: var(--muted); font-size: 14px; }
  .icon-btn:hover { background: var(--card-hover); color: var(--fg); }
  .toasts { position: fixed; left: 10px; right: 10px; bottom: 12px; display: flex; flex-direction: column; gap: 6px; align-items: center; pointer-events: none; z-index: 50; }
  .toast { padding: 8px 12px; border-radius: 10px; font-size: 12px; font-weight: 600; background: var(--vscode-notifications-background, var(--card)); border: 1px solid var(--border); box-shadow: 0 8px 24px -8px rgba(0,0,0,.5); }
  .toast.ok { border-color: color-mix(in srgb, var(--ok) 50%, transparent); }
  .toast.error { border-color: color-mix(in srgb, var(--danger) 60%, transparent); color: var(--danger); }
</style>
