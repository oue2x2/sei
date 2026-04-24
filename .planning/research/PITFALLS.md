# Domain Pitfalls: Sei (Minecraft AI Companion)

**Domain:** Two-layer LLM agent + mineflayer bot + Electron desktop app
**Researched:** 2026-04-24
**Overall confidence:** MEDIUM-HIGH (mineflayer & Electron pitfalls well-documented in issues; LLM agent pitfalls well-researched; Ollama production patterns MEDIUM confidence)

---

## Critical Pitfalls

Mistakes that cause rewrites, user-visible breakage on day one, or support-ticket floods.

### Pitfall 1: Mineflayer Version Pinned Too Tightly to Server Version
**What goes wrong:** Mineflayer supports Minecraft 1.8–1.21.11 (as of early 2026). If a user's server is 1.21.7 and the bot tries `version: '1.21'`, the server rejects with `"This server is version 1.21.7, you are using version 1.21, please specify the correct version in the options"`. Bot crashes on startup with an opaque protocol error. Newer Minecraft releases (e.g., 26.x) fail entirely until PrismarineJS catches up.
**Why it happens:** Non-technical users don't know their server's exact patch version. Minecraft ships frequent patches; protocol changes break wire compatibility.
**Consequences:** Bot never connects. User assumes the app is broken; no actionable error. Support burden.
**Prevention:**
- Use `version: false` (auto-detect) as the default, not a hardcoded string.
- Wrap `createBot()` in a try/catch and surface `"unsupported protocol"` / `"version mismatch"` errors to the GUI with a friendly message including the detected server version and the mineflayer-supported range.
- On startup, log the exact mineflayer `supportedVersions` list and the detected server version to the GUI's diagnostics panel.
- Ship with a "Minecraft version compatibility" doc linked from the error UI.
**Detection:** Error on `createBot` with strings: `unsupported`, `protocol`, `version`. NBT parse errors at login also indicate a version/protocol mismatch (see [issue #3669](https://github.com/PrismarineJS/mineflayer/issues/3669)).
**Phase:** Phase 1 (mineflayer wiring) — MUST be handled before any GUI release.

### Pitfall 2: Pathfinder Hangs Silently with No Timeout or Event
**What goes wrong:** `mineflayer-pathfinder` can get stuck indefinitely when:
- An unbreakable block obstructs the goal ([issue #222](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/222)) — no event, no error, no timeout.
- A computed path is partial ([issue #273](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/273)) — goal never fires `goal_reached` or `path_update`.
- Bot tries to follow a player and gets wedged next to bamboo, display cases, or chests ([issue #242, #332](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/332)).
- Bot places a block under itself while jumping/swimming in 1-deep water ([issue #54](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/54)).
**Why it happens:** Pathfinder's goal-completion model relies on events, but several failure modes produce no event at all. The small movement LLM has no way to know the last `goto` command is dead.
**Consequences:** Personality LLM thinks it gave the command and moves on; bot is frozen in the world. User sees a zombie. Worse: if the personality loop awaits movement completion, the whole agent deadlocks.
**Prevention:**
- **Always wrap pathfinder calls with a wall-clock timeout** (e.g., 30s for short, 2min for long journeys). On timeout, cancel the goal (`bot.pathfinder.setGoal(null)`) and return `{status: 'timeout', reason: 'stuck'}` to the movement LLM.
- Detect "stuck but active goal" by sampling `bot.entity.position` every 2s — if position delta < 0.1 blocks for N samples while a goal is active, treat as stuck.
- Never `await` a pathfinder promise without a timeout wrapper.
- Movement LLM function schema should make "couldn't reach destination" a first-class result, not an exception.
**Detection:** Position doesn't change for >5s while `bot.pathfinder.isMoving()` is true; no `goal_reached` event after pathfinder-estimated ETA × 3.
**Phase:** Phase 1 or 2 (movement LLM) — this WILL bite the first time it's tested.

### Pitfall 3: Two-Layer LLM Infinite Loop / Runaway Cost
**What goes wrong:** The personality LLM (Haiku) fires on "small model completion" events. If the movement LLM always completes (success or failure), and the personality LLM always reacts to the completion with another instruction, you have a **tight loop with no termination condition**. On a cloud API this = runaway token spend. LLM agents with tool-use loops are known to exhibit this; recursion limits are the standard mitigation.
**Additional modes:**
- Personality LLM asks movement LLM to do something impossible ("fly"). Movement LLM fails, personality LLM rephrases, movement LLM fails again — infinite retry spiral.
- Hallucinated function calls: small model invents a mineflayer method that doesn't exist. Error is fed back; model hallucinates a different nonexistent method.
- Context overflow: every event gets appended to history; after a long session, prompts balloon past the context window. Haiku 3 silently truncates oldest messages → bot "forgets" its owner mid-conversation.
**Why it happens:** Event-driven architectures without backpressure + LLMs optimizing to "be helpful" + no recursion cap.
**Consequences:** $$$ on Haiku API. GPU pegged by Ollama. Bot spams chat. User rage-quits.
**Prevention:**
- **Hard recursion cap per event chain** (e.g., max 5 personality→movement→personality hops before forcing a 10s idle). Treat this like LangGraph's `recursion_limit`.
- **Debounce events**: coalesce same-type events within 500ms windows. "Inventory changed" fires rapidly when looting a chest — don't invoke Haiku 20 times.
- **Whitelist of callable mineflayer functions** given to the movement LLM as a strict JSON schema. Reject unknown function names before execution; don't feed the error back to the model (that trains it to retry). Return a sanitized "unsupported action" result.
- **Context window management**: summarize history older than N turns into a compressed episodic memory entry. Always reserve ~30% of context for system prompt + current event.
- **Token budget per event loop iteration** with a hard cutoff and GUI-visible counter ("Sei used $0.12 this session").
- **Retry budget on failures**: if same action fails twice, escalate to "tell the owner I can't do this" rather than retry.
**Detection:** Count personality LLM invocations per minute; alert if >20/min sustained. Track token spend rolling 10min; alert on anomalies.
**Phase:** Phase 2-3 (LLM orchestration) — fundamental architecture concern, design in from day one.

### Pitfall 4: Native Modules Not Rebuilt for Electron ABI
**What goes wrong:** Mineflayer depends on native modules (e.g., `node-canvas` via some plugins, `sodium-native` / `node-minecraft-protocol` encryption helpers, prismarine-physics in some configs). Electron has a different Node ABI than the system Node. If you `npm install` and run under Electron without rebuilding, you get cryptic `NODE_MODULE_VERSION` mismatch errors at runtime — often only on the user's machine, not yours.
**Why it happens:** electron-builder's `install-app-deps` should handle this, but fails silently when:
- `npm v7+` hoisting breaks `prebuild-install` lookup paths ([issue #5691](https://github.com/electron-userland/electron-builder/issues/5691)).
- Cross-platform builds (building Windows binary on a Mac) can't rebuild native modules for the target platform without extra config.
- Electron ≥ 20 changed ABI expectations ([issue #7175](https://github.com/electron-userland/electron-builder/issues/7175)).
**Consequences:** App crashes on launch on end-user machines. Works fine in `npm run dev`. Classic "works on my machine."
**Prevention:**
- Use `@electron/rebuild` (modern replacement for `electron-rebuild`) in a postinstall or explicit build step.
- Configure `electron-builder.yml` with `npmRebuild: true` and `buildDependenciesFromSource: false` unless you hit prebuild issues.
- **Test packaged builds on clean VMs** for both Windows and macOS before every release — `npm start` success proves nothing.
- Pin `electron-builder` version; avoid 24.6.2 specifically ([issue #7809](https://github.com/electron-userland/electron-builder/issues/7809)). Check the changelog before upgrading.
- Use CI matrix builds (GitHub Actions macos-latest + windows-latest runners) so each platform builds its own natives.
**Detection:** First-run crash with `NODE_MODULE_VERSION` in stack trace; `require()` of a native dep throws "was compiled against a different Node.js version."
**Phase:** Phase 4-5 (packaging) — but validate early by packaging a thin prototype at end of Phase 1.

### Pitfall 5: macOS Screen Recording Permission UX Failure
**What goes wrong:** Screenshot capture (via `desktopCapturer` or a native helper) requires **Screen Recording** permission in System Settings → Privacy & Security. On first call, macOS either silently returns a black image or prompts the user — behavior differs by macOS version. macOS Sequoia (15.x) introduced **weekly re-prompts** forcing users to reaffirm access. If your app doesn't gracefully handle the "permission denied" or "black frames" case, the personality LLM gets blank visual context and hallucinates descriptions of nothing.
**Additional issues:**
- When Minecraft is minimized or behind other windows, `desktopCapturer` gets the compositor's cached frame (stale or blank). The bot will "see" old state.
- macOS only adds your app to the permission list **after the first capture attempt** — so you can't preflight-check before the user has already tried once.
- Code-signed builds and unsigned dev builds have **separate permission entries** — granting in dev doesn't carry over to production.
**Why it happens:** Apple's privacy model prioritizes user consent over DX. Electron's sandboxing and signing interact in non-obvious ways with TCC (Transparency, Consent, and Control).
**Consequences:** Bot "sees" black or stale screens, narrates hallucinations, user thinks LLM is broken. On Sequoia, previously-working installs break weekly.
**Prevention:**
- Use `mac-screen-capture-permissions` npm package to check/prompt explicitly on first setup, with a GUI screen explaining why and linking to System Settings.
- Detect black/blank frames (pixel variance < threshold) and fall back to text-only world state for that tick — don't send blank images to the LLM.
- Window-capture Minecraft specifically (by window title) rather than full-screen; degrade gracefully when Minecraft isn't the focused app.
- Document the Sequoia weekly-reprompt behavior in onboarding so users don't file "it was working yesterday" bugs.
- **Treat screenshot as optional context, not required** — bot must function end-to-end without it.
**Detection:** First launch: if `hasScreenCapturePermission() === false`, show permission UI before any bot start. Runtime: monitor frame entropy; if <5% variance for N consecutive frames, flag degraded visual mode.
**Phase:** Phase 3-4 (visual context / GUI polish) — but design the "optional visual context" abstraction earlier.

---

## Moderate Pitfalls

### Pitfall 6: Ollama Not Running / Model Not Pulled
**What goes wrong:** User selects "local Ollama" in GUI. Ollama daemon isn't running, or the Qwen 9B model isn't pulled. First function call hangs (default `ollama-js` HeadersTimeoutError after ~5min) or returns 404 for the model.
**Prevention:**
- On startup and on model-selection change: probe `GET /api/tags` (lists pulled models). If Ollama unreachable → show "Start Ollama" CTA with platform-specific instructions. If model not in list → offer one-click `ollama pull qwen2.5:9b` with a progress bar.
- **Set explicit request timeouts** on the Ollama client (don't rely on defaults). 60s for inference, 10s for connectivity probes.
- Use `OLLAMA_KEEP_ALIVE=30m` via env when spawning Ollama-backed requests to prevent cold-load on every call (first-call latency can be 10-30s for a 9B model on CPU).
- Fall back to "API-only mode" (skip movement LLM, route everything through Haiku with function-calling) when Ollama is unavailable, with a GUI warning.
**Detection:** `ECONNREFUSED` on `localhost:11434`; HTTP 404 from `/api/generate` with `model not found`; `HeadersTimeoutError` from `ollama-js` ([issue #72](https://github.com/ollama/ollama-js/issues/72)).
**Phase:** Phase 2 (Ollama integration).

### Pitfall 7: Slow Ollama Inference Blocking Bot Tick Loop
**What goes wrong:** 9B model on a user's laptop CPU can take 5-15s per completion. If the movement LLM call is awaited on the mineflayer tick (20 ticks/s), the bot stops responding to physics — falls off cliffs, drowns, gets killed by mobs it "sees."
**Prevention:**
- **Movement LLM calls run in a worker thread or separate async task**, never on the main event loop awaited synchronously with tick handlers.
- Mineflayer event handlers return immediately; any LLM work is queued and processed out-of-band.
- Short-horizon reactive behaviors (dodge, eat when hungry, flee from mob) are hardcoded reflexes, NOT LLM-driven. LLMs decide high-level goals; code handles "don't die."
**Detection:** Bot takes physical damage while "thinking"; tick handler durations > 50ms sampled.
**Phase:** Phase 2 (architecture) — this is a design decision, not a bugfix.

### Pitfall 8: Code Signing / Notarization Blockers
**What goes wrong:**
- **macOS:** Unsigned app shows "damaged, move to trash" on download. Since 10.15 Catalina, notarization is mandatory for Gatekeeper. Hardened runtime requirement can break native module loading (symbol permissions). Signing the DMG *and* the app (electron-builder <20.43) causes notarization errors.
- **Windows:** Unsigned .exe triggers SmartScreen red warning; non-technical users abandon download. EV cert required for immediate reputation (~$300/yr); standard cert builds reputation slowly.
**Prevention:**
- Budget signing certs early: Apple Developer Program ($99/yr) + Windows code-signing cert (EV preferred, ~$300/yr from Sectigo/DigiCert).
- Use `@electron/notarize` (modern replacement for `electron-notarize`) with app-specific password or API key auth; API key is more reliable in CI.
- Set `hardenedRuntime: true` and appropriate `entitlements.plist` (JIT, unsigned-executable-memory if Ollama helpers need it, audio-input: false, camera: false — keep the attack surface small).
- Don't sign the DMG; let electron-builder default handle it.
- Test notarization early — round-trips to Apple can take hours; don't discover on release day.
**Phase:** Phase 5 (distribution) — but apply for certs in Phase 1 (lead time).

### Pitfall 9: Auto-Updater Misconfiguration
**What goes wrong:** `electron-updater` silently fails on unsigned builds on macOS (won't install updates at all). Windows updates can fail if the new binary's cert subject doesn't match the old one. Delta updates can corrupt if native module files differ between versions.
**Prevention:**
- Use `autoUpdater` from `electron-updater` (not Electron's built-in, which requires a Squirrel server for macOS). Configure `generic` or GitHub Releases feed.
- Ensure every release is signed with the same cert (or a cert chain that Gatekeeper considers continuous).
- Add "Check for updates" manual UI as a fallback — don't rely solely on auto-updates.
- Ship an opt-out toggle; some users (corp networks) will have egress blocked.
**Phase:** Phase 5+ (post-MVP, probably).

### Pitfall 10: Memory Grows Unbounded
**What goes wrong:** Long-term memory (owner relationship, world progression, episodic logs) accumulates indefinitely. Every prompt load reads and re-embeds the whole file. After 100 play sessions, prompts are slow and expensive; JSON file corrupts if the app crashes mid-write.
**Prevention:**
- **Atomic writes:** write to `memory.json.tmp`, `fsync`, then rename over `memory.json`. Never write in-place.
- **Tiered memory architecture:**
  - Short-term: last N turns, full fidelity, in RAM only.
  - Mid-term: summarized session digests (Haiku produces a 200-token summary at session end).
  - Long-term: hierarchical — identity/personality (small, never trimmed), relationships (per-player, capped), world facts (vector-indexed, top-K retrieved).
- **Periodic compaction:** background task merges old episodic memories into abstracted knowledge, drops raw logs older than N days.
- **Size budget:** hard-cap memory file at e.g. 5MB. On overflow, force compaction.
**Detection:** Memory file > 5MB; prompt assembly > 1s; session startup latency climbing.
**Phase:** Phase 3-4 (memory system).

### Pitfall 11: Memory Contradicts Current World State
**What goes wrong:** Bot remembers "Shawn's house is at (100, 64, 200)." Shawn moved the house. Bot confidently leads new players there, finds nothing, hallucinates an explanation. This is the classic **world state staleness** problem — memory is useful now, stale later, and updates are expensive and risky.
**Prevention:**
- **Timestamp every memory entry.** Old memories get lower retrieval weight.
- **Verify before acting on spatial claims:** when the movement LLM is told "go to the house," it should check block existence at those coordinates via mineflayer; if empty/wrong, mark the memory as stale.
- **Conflict-aware updates:** new observations that contradict memory trigger a "confirm with owner or observation" flow, not silent overwrite.
- **Distinguish observation vs. assertion** in memory: "I built a house here" (high confidence) vs. "Shawn said his base is over there" (second-hand, decay faster).
- Let the personality LLM express uncertainty in chat ("I think your base was this way but it's been a while...") rather than confident stale claims.
**Phase:** Phase 3-4 (memory system + personality loop).

### Pitfall 12: Event Storm Overwhelms Personality Loop
**What goes wrong:** Requirements list events: chat, small model completion, attacked, hungry, mob nearby, inventory change, 10s idle. In a dense PvE fight: `entityHurt`, `health`, `entitySpawn`, `inventoryChange` all fire 10+ times per second. Without debouncing, Haiku is invoked 100×/min → rate-limited by Anthropic, blows cost budget.
**Prevention:**
- **Event coalescing**: maintain a "pending events" bucket. Flush to LLM at most once per 2s unless a critical event (chat mention by owner, low health) forces immediate flush.
- **Priority tiers**: owner chat > attacked/low-health > other players > world events > idle. Drop lower-priority events if higher-priority is pending.
- **Rate limiter** with token-bucket on personality LLM invocations: e.g., 30/min ceiling.
- **Summarize event bursts**: instead of 10 "entityHurt" events, send one "took 40% damage in last 2s from 3 zombies."
**Phase:** Phase 2-3 (event loop design).

---

## Minor Pitfalls

### Pitfall 13: Mineflayer Plugin Conflicts
**What goes wrong:** `mineflayer-pathfinder`, `mineflayer-pvp`, `mineflayer-auto-eat`, `prismarine-viewer` can conflict — e.g., pathfinder and pvp both want to control `bot.lookAt`. Plugin load order matters.
**Prevention:** Only load plugins you actually use; document load order in a single `setupBot.ts`; test plugin combinations.

### Pitfall 14: Server-Side Anti-Bot Plugins
**What goes wrong:** Servers running AntiCheat/NoCheatPlus flag mineflayer's movement as suspicious (no mouse jitter, perfect angles). Bot gets kicked or banned.
**Prevention:** Add small random jitter to look vectors; document that Sei is for user's own/private servers, not public ones.

### Pitfall 15: Chat Flooding / Mute
**What goes wrong:** Bot's personality LLM decides to narrate frequently. Server's anti-spam kicks it for sending >N messages/5s.
**Prevention:** Chat rate limiter (e.g., 1 message per 3s); queue with drop-on-stale policy; don't repeat the same sentiment within 30s.

### Pitfall 16: API Key in Plain Text
**What goes wrong:** Non-technical users paste Haiku API key into GUI; it's stored in plaintext JSON. Config file accidentally shared in a screen recording or uploaded with a bug report.
**Prevention:** Use Electron's `safeStorage` API (OS keychain wrapper: Keychain on macOS, DPAPI on Windows). Never log the key. Redact key in any diagnostic export.

### Pitfall 17: Mineflayer Bot Doesn't Reconnect on Server Restart
**What goes wrong:** Server restarts overnight; bot disconnects and stays dead. User opens app next morning → no bot in game.
**Prevention:** `bot.on('end', ...)` handler with exponential-backoff reconnect. Cap retries; surface "server unreachable" after N failures. Persist last-known auth across restarts.

### Pitfall 18: Electron Renderer Process Runs Bot Logic
**What goes wrong:** Putting mineflayer in the renderer means closing the GUI window kills the bot. Also, `nodeIntegration: true` for the renderer is a security footgun.
**Prevention:** Bot runs in **main process** or a dedicated utility process (`utilityProcess.fork`). Renderer is GUI only, communicates via IPC. Use `contextIsolation: true`, `nodeIntegration: false`, preload script for IPC bridge.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|---|---|---|
| Phase 1: Mineflayer bot skeleton | Version mismatch (#1), pathfinder hangs (#2), plugin load order (#13) | Auto-detect version, timeout wrappers on all pathfinder calls, minimal plugin set |
| Phase 2: Ollama + movement LLM | Ollama not running (#6), blocking tick loop (#7), hallucinated functions (#3) | Health-check + fallback mode, worker threads, strict function whitelist |
| Phase 2-3: Event loop + personality LLM | Infinite loop (#3), event storm (#12), context overflow (#3) | Recursion cap, event debounce, rolling summarization |
| Phase 3: Memory system | Unbounded growth (#10), world state staleness (#11), file corruption (#10) | Tiered memory, timestamps + decay, atomic writes |
| Phase 3-4: Screenshot / visual context | macOS permission UX (#5), blank frames when minimized (#5) | Preflight permission check, frame variance detection, optional-context design |
| Phase 4: Electron GUI | Bot in renderer (#18), API key plaintext (#16) | Main/utility process for bot, `safeStorage` for secrets |
| Phase 5: Packaging / distribution | Native ABI mismatch (#4), code signing (#8), auto-updater (#9) | `@electron/rebuild`, early cert procurement, signed releases only |
| Phase 5+: Production operation | Reconnect on server restart (#17), chat flood mute (#15), anti-cheat bans (#14) | Exponential backoff, chat rate limiter, movement jitter |

---

## Cross-Cutting Design Principles to Avoid These

1. **Every external call has a timeout.** Pathfinder, Ollama, Haiku, screenshot capture, mineflayer events. No unbounded `await`.
2. **Every loop has a bound.** Event chains, retries, reconnect attempts, memory accumulation. Always a cap.
3. **Every optional capability degrades gracefully.** No Ollama? API-only mode. No screenshot permission? Text-only context. No network? Local-memory replay.
4. **Separate reactive reflexes from LLM cognition.** Reflexes (eat, dodge, flee) in code; strategy (where to go, what to say) in LLM.
5. **Test the packaged build, not just the dev build.** ABI issues, signing, permissions, auto-update only surface post-package.
6. **Non-technical UX means every error needs a button.** Not "ECONNREFUSED 127.0.0.1:11434" but "Ollama isn't running. [Start Ollama] [Use cloud mode instead]."

---

## Sources

**Mineflayer / pathfinder:**
- [mineflayer version support issue #3893](https://github.com/PrismarineJS/mineflayer/issues/3893)
- [mineflayer 1.21.7 compatibility #3714](https://github.com/PrismarineJS/mineflayer/issues/3714)
- [NBT crash reports #3669](https://github.com/PrismarineJS/mineflayer/issues/3669)
- [pathfinder hangs on unbreakable block #222](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/222)
- [pathfinder partial path state #273](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/273)
- [GoalFollow halts #332](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/332)
- [water/placement stuck #54](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/54)
- [mineflayer README](https://github.com/PrismarineJS/mineflayer)

**LLM agent pitfalls:**
- [LLM-based Agents Suffer from Hallucinations: Survey (arXiv 2509.18970)](https://arxiv.org/html/2509.18970v1)
- [Mitigating LLM Hallucinations w/ Multi-Agent Framework (MDPI 2026)](https://www.mdpi.com/2078-2489/16/7/517)
- [LLM Agents and Infinite Loops](https://www.mintlify.com/JhonZacipa/rl-cycle-demo/context/llm-agents)
- [Function Calling in AI Agents (Prompt Engineering Guide)](https://www.promptingguide.ai/agents/function-calling)
- [Memory for Autonomous LLM Agents (arXiv 2603.07670)](https://arxiv.org/html/2603.07670v1)
- [Agentic Memory: Unified Long/Short-Term (arXiv 2601.01885)](https://arxiv.org/abs/2601.01885)

**Ollama:**
- [ollama-js HeadersTimeoutError #72](https://github.com/ollama/ollama-js/issues/72)
- [ollama-js timeout for long generation #103](https://github.com/ollama/ollama-js/issues/103)
- [Ollama configurable model loading timeout #4350](https://github.com/ollama/ollama/issues/4350)
- [Handling Timeout Issues in Ollama (Arsturn)](https://www.arsturn.com/blog/addressing-timeout-issues-in-ollama)

**Electron packaging / signing:**
- [Electron: Using Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [electron-builder npm v7 native rebuild #5691](https://github.com/electron-userland/electron-builder/issues/5691)
- [electron-builder Electron 20+ rebuild #7175](https://github.com/electron-userland/electron-builder/issues/7175)
- [electron-builder 24.6.2 rebuild fails #7809](https://github.com/electron-userland/electron-builder/issues/7809)
- [Electron Code Signing Docs](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [electron/notarize](https://github.com/electron/notarize)
- [Notarizing your Electron application (Kilian Valkhof)](https://kilianvalkhof.com/2019/electron/notarizing-your-electron-application/)

**macOS screenshot permissions:**
- [Electron desktopCapturer API](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [mac-screen-capture-permissions (npm)](https://www.npmjs.com/package/mac-screen-capture-permissions)
- [Electron screen recording bug on macOS #38190](https://github.com/electron/electron/issues/38190)
- [Mac Screenshot Permissions 2026 (LazyScreenshots)](https://www.lazyscreenshots.com/blog/mac-screenshot-screen-recording-permission/)
