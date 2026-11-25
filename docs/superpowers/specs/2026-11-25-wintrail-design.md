# Wintrail — Design

> Name chosen by the owner (free on the Marketplace). Extension id `NiravPatel15.wintrail`; commands and settings
> use `wintrail.*`. The name must not change after release, because it decides the `globalStorage` path that holds the log.
> Visual reference: `docs/superpowers/specs/mockups/log-ui.html` (option **B**, Dashboard + heatmap), and `docs/superpowers/specs/mockups/break-style.html`
> (option **B**, the notification, is the default; option **A**, the full break tab, is an optional per-reminder style).

## Intent
A private, password-protected **work-achievements log** inside VS Code. At appraisal time it shows the
owner everything they worked on this year and what was **exceptional, beyond normal work**. The same log
drafts the **daily standup** (a short Teams message), and a **Break Buddy** reminds them to rest eyes,
stretch and drink water during long coding sessions.

The owner wants it because their year's work otherwise disappears. It must be private, because colleagues
reading or copying the log is the threat they named ("someone reads it and teases me or copies it").
They also asked for a good-looking, interactive, animated UI.

Publisher: `NiravPatel15` (same as Authora). The repo goes on the personal GitHub account `NIRAV-PATEL-15`.
Repo: `~/workspace/extentions/wintrail`. Release flow is the same as Authora (tag → CI → Marketplace via OIDC + Open VSX + GitHub release).

## Goals
1. **Log an entry in ~3 seconds from anywhere** (hotkey → one line → Enter), **without unlocking**.
2. Entries are **unreadable without the password**: on disk, in backups, and to anyone at the machine.
3. **⭐ Highlights** mark exceptional work; **Year in Review** surfaces them and exports Markdown for appraisals.
4. **Standup** drafts a short Teams message from the log and git, editable, then copied with one click.
5. **Break Buddy** reminds based on *active* coding time, using VS Code notifications.
6. Polished animated UI: the "Dashboard + heatmap" direction the owner chose (mockup: `log-ui.html`, option B).

## Non-goals
- No cloud sync, no accounts, no network calls of any kind.
- No AI or LLM features. Standup generation is deterministic.
- No team or manager views. It is single-user and private.
- No time tracking or timesheets.
- No editing of git history, and no reading other people's commits.

## Anti-goals (failure even if it "works")
- Logging needs a password prompt or takes more than a few seconds, so the owner stops logging.
- Any entry text, tag, project name or date is readable from disk without the password.
- Break reminders feel naggy: modal dialogs, reminders while idle, or stacked duplicates.
- Data loss: the year's log corrupted or lost by a crash, a second window, or a bad import.

## Constraints
- VS Code `^1.85.0`. Runs in the extension host (Node 18+). Works on Linux, macOS and Windows.
- Reuse Authora's tested foundation (`~/workspace/extentions/authora`, MIT, same owner), copied rather than shared:
  - `envelope.ts`: Argon2id via hash-wasm, AES-256-GCM, KDF bounds checks.
  - `vault.ts` patterns: file lock (`O_EXCL` lock file), durable atomic write (fsync, `.bak`, rename), throttled unlock, read-modify-write under the lock, re-key detection across windows.
  - Session patterns: auto-lock, "remember on this machine" (SecretStorage) plus a "requires password after lock" flag, `application`-scoped settings, webview message validation, strict CSP with a nonce.
  - The hardened two-job release workflow with actions pinned to commit hashes.
- Commits carry only the owner's identity, with no Claude co-author trailer.

## Approaches considered
1. **Authora foundation, plain TypeScript UI.** Fastest, but the hand-written DOM struggles with the richer animated dashboard.
2. **Shared crypto npm package for Authora and Wintrail.** Cleanest long term, but it means re-publishing Authora and maintaining a third package first.
3. **Framework UI (Svelte or Preact).** Best UI ergonomics.

**Chosen (by the owner): 1 + 3. Authora's foundation for the host and crypto, with Svelte for the webview UI.**
Svelte compiles to small vanilla JS and has built-in `transition`, `animate:flip`, `tweened` and `spring`. The
webview is bundled with esbuild and `esbuild-svelte`. Choosing Svelte 5 versus 4 and the exact plugin versions is left to the builder.

## Design decisions (owner-approved unless marked *builder's call*)

### Storage & crypto: "write without unlocking"
- **Vault file** `globalStorage/vault.json` holds the KDF parameters (Argon2id m=64 MiB, t=3, p=1, random salt), an
  **X25519 key pair** whose private key is wrapped with AES-256-GCM under the Argon2id-derived key, and the
  public key in plaintext. Created on first run with a master password (at least 8 characters, with a strength meter, and
  "no recovery" spelled out).
- **Adding an entry** needs only the public key: ephemeral X25519, then ECDH, then HKDF-SHA256, then AES-256-GCM
  (a sealed box built from `node:crypto` primitives). So adding works while locked and never prompts.
- **Everything about an entry is inside the ciphertext**: text, timestamp, project, branch, tags, ⭐ and impact.
  Only a random record id and the sealed blob are stored outside.
- **Log file** `globalStorage/entries.jsonl` is append-only, one sealed record per line, appended under the lock file
  with fsync. Edits, ⭐ toggles and deletes are appended as sealed `edit` and `delete` records that reference the id.
  While unlocked, **compaction** rewrites the file atomically (durable write plus `.bak`) once it holds more than N
  superseded records (*builder's call*).
- **Tamper protection (owner's pick: "protect edits/deletes").** An HMAC-SHA256 key is generated next to the
  key pair and wrapped under the Argon2id key with it. Every `edit` and `delete` record, and every compacted file, carries a MAC
  made with that key, so they can only be produced by an unlocked session. Records whose MAC is missing or invalid are
  ignored during replay, and the UI shows a small warning count. **Entries added while locked cannot be authenticated**:
  they're accepted, but carry an "added while locked" mark in the UI until the owner confirms them with one click
  (confirming appends a MAC'd `confirm` record). Entries added while unlocked are MAC'd at once, so they get no mark.
- **Metadata hiding (*builder's call, settled*):** the target ids of edits and deletes go inside the ciphertext. Plaintext is
  padded to 256-byte buckets before sealing. Line count, file mtime and backup timestamps are accepted as visible.
- **Reading** needs the password, which unwraps the private key. Unlock, lock, auto-lock (default 15 min), throttling and
  "remember on this machine" all behave exactly as in Authora.
- **Multi-window:** reads re-scan the file under the lock, and a file watcher refreshes other windows. **A password change generates a NEW key pair and a NEW MAC key and re-seals
  the whole log** under the lock (atomic rewrite), so an old copied vault plus an old password can't read anything new.
  Other windows detect the new public key and lock. A quick-add that runs during the re-seal waits for the lock, then
  seals with the new public key.
- **Backups:** auto-backup to a folder the owner chooses (opt-in), copying the vault and log files. They are already
  encrypted, so a backup opens with the master password. Manual "Export encrypted backup" too. **Import backup (*builder's call, settled*): merge, never replace.** Ask for the
  backup's password; decrypt its entries; re-seal them under the current keys; skip duplicates (same text and timestamp);
  and take an automatic backup of the current log first.
  The Advisor nudges when there is no backup or the backup is older than 30 days.
- **Export for appraisal** (Markdown) is the only plaintext output. It asks for confirmation and writes an owner-only file.

### Log entry
- Fields: `text` (1 line, max 500 chars), `at` (timestamp), `project` (workspace folder name), `branch`
  (current git branch if any), `tags` (parsed from `#word` in the text), `star` (bool), `impact`
  (`normal` | `high`, only meaningful when starred).
- Quick-add: hotkey (default `Ctrl+Alt+L` / `Cmd+Alt+L`) opens a VS Code input box, and the sidebar box does the
  same. A leading `!` sets ⭐. `#tags` are parsed out but stay visible in the text.
- Entries can be edited, starred or unstarred, have their impact changed, and be deleted (with confirmation) from the timeline.

### Sidebar UI ("Dashboard + heatmap", owner's pick)
- Tabs: **Today · Standup · Year**, with animated crossfade or slide.
- **Today tab:** the quick-add box; stat tiles (🔥 day streak, ⭐ this month, entries this year) with numbers that
  tween up; an **18-week activity heatmap** with 4 intensity levels that fills in tile by tile (hover shows the date
  and count, click filters to that day); then a timeline grouped by day. Entries pop in with a spring, ⭐ entries
  glow and sparkle once, and reordering animates with `flip`. Search box and tag filter.
- **Locked state:** only the quick-add box and a "🔒 Unlock to see your log" card are visible. No counts or heatmap
  leak while locked.
- Streak means consecutive **working days** (Mon–Fri) with at least 1 entry. Weekends don't break it (*builder's call* on holidays: ignore).
- Theme: follow VS Code theme colours, with an accent gradient as in Authora. Respect `prefers-reduced-motion`.

### Standup
- The **Standup tab**, or the command "Write Standup", builds:
  - **Yesterday:** the previous **working day's** log entries (Monday covers Friday). If there are none, that day's
    git commits by the owner (`git log --author=<user.email> --since/--until`, run with `execFile`, never a shell)
    across all workspace folders that are git repos. Duplicates are merged, ⭐ entries are kept and marked, and the
    section holds at most 4 bullets.
  - **Today:** pre-filled from the current branch name (for example `feature/payments-webhooks` becomes "Continue
    payments webhooks"). Editable. It is saved as a sealed `plan` record in the log, never in plaintext, and **the next standup shows
    yesterday's plan as a small reference line above the draft** (*builder's call, settled*), so the owner can see what got done.
  - **Blockers:** defaults to "None".
- Editable in place. **Copy for Teams** puts short plain text with `•` bullets and bold-free section headers on the
  clipboard, so it pastes cleanly into a Teams chat.
- Needs the vault unlocked (it reads the log), and prompts to unlock if it's locked.

### Break Buddy
- Counts **active time** from text edits, selection changes and focused-window time. It pauses after 5 min idle
  (configurable), and a break of at least 5 min resets the counters.
- Reminders with default intervals of active time:
  - 👀 eyes (20-20-20), every 20 min
  - 🧘 stretch / posture, every 50 min
  - 💧 water, every 75 min
- **Style (owner's pick): a VS Code notification** with *Done · Snooze 10 min · Skip*. A per-reminder setting can
  switch it to a **full animated break tab** (the editor-area webview from mockup A: breathing orb, countdown, guided
  stretch steps, closing itself when done).
- Never stacks: one reminder at a time. **Focus mode** mutes everything for 1 or 2 hours or until turned off (status bar toggle).
- Weekly stats ("18/20 eye breaks taken") on the Today tab. These are not sensitive and are stored in globalState.
- **Fully customisable timing (owner's requirement).** Every value below is editable in two places: a **Break Buddy
  settings card** in the sidebar (⚙ next to the weekly stats, with live-updating sliders and number inputs, and a
  "Reset to defaults" button), and VS Code settings (`wintrail.breaks.*`, `application` scope). Changes apply immediately,
  without a restart.

  | Setting | Default | Range |
  |---|---|---|
  | Eyes interval | 20 min | 5–120 min |
  | Stretch interval | 50 min | 10–240 min |
  | Water interval | 75 min | 15–240 min |
  | Each reminder on/off | on | — |
  | Each reminder's style | notification | notification / full break screen |
  | Eye-break countdown length | 20 s | 10–120 s |
  | Stretch-break length | 60 s | 30–600 s |
  | Snooze length | 10 min | 1–60 min |
  | Idle pause threshold | 5 min | 1–30 min |
  | "Real break" reset threshold | 5 min | 1–60 min |
  | Focus-mode presets | 1 h, 2 h | any 2–3 values, 15 min–8 h |
  | Working hours (optional) | off | e.g. 09:00–18:00; no reminders outside them |

### Year in Review
- **Appraisal year is configurable (owner's pick):** setting `wintrail.yearStartMonth` (default 1 = January; for example 4 = April–March).
  All "this year" counters, the Year tab and the export use it. The export also allows a **custom date range**.
- **Year tab:** a year selector; animated per-project bars; counts by tag; a ⭐ highlights list (newest first, grouped by
  month, with an impact badge); totals (entries, projects, highlights).
- **Export for appraisal (Markdown):** highlights first (grouped by month, with project and tags), then a summary
  of all work by project. Also "Copy highlights". Plaintext with a warning, as above.

## Left to the builder
- Exact file and module layout, Svelte version and component structure, animation tuning.
- Compaction threshold; heatmap colour scale; how branch names become words.
- Exact command and setting names under `wintrail.*`.
- Test strategy beyond the following minimum, which is required: vitest tests for the crypto (seal while locked and
  open after unlock, wrong password, tampering), log replay (edit and delete), multi-window append safety, standup
  date logic (Monday → Friday), the streak, the configurable year, MAC rejection of forged edit/delete records, the key rotation on
  password change, the import merge, and Markdown export; plus an integration smoke test in real VS Code as in Authora.
