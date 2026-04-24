# Sei Research Synthesis

**Project:** Sei — Minecraft AI companion (two-layer LLM + mineflayer + Electron)
**Synthesized:** 2026-04-24
**Overall confidence:** MEDIUM-HIGH across all four research dimensions.

## Executive Summary

Sei sits at a well-documented intersection of three mature ecosystems (mineflayer, the Anthropic/Ollama LLM stack, Electron) but differentiates itself by being personality-first, non-technical-user-first, and hybrid cloud+local. Surrounding projects (Mindcraft, Voyager, AI-Player, Player2, AI_Paul) validate buildability and expose enough failure modes that the correct v1 shape is clear: a closed action registry driven by a small local tool-calling model, behind an event-sourced state machine, with a long-lived cloud personality LLM that never emits code, packaged as a three-process Electron app.

Dominant risks are operational, not novel: pathfinder hangs without events; native modules explode at packaging; macOS screen-recording permissions silently fail; two-layer LLM loops diverge into runaway cost without a hard recursion cap. All have known mitigations that must be designed in from day one.

Build order: substrate (mineflayer + action registry + FSM) with scripted behavior, then two LLM layers with minimal context, then memory, then visual context, then Electron shell, then packaging. One bot, one owner, text-only for v1.

## 1. Recommended Stack

| Layer | Choice | Version | Notes |
|---|---|---|---|
| Runtime | Node.js | 20 LTS | Matches Electron's bundled Node |
| Language | TypeScript | 5.x | Essential for IPC/tool-call schemas |
| Bot core | mineflayer | ^4.37.0 | Auto-detect server version |
| Pathfinding | mineflayer-pathfinder | ^2.4.5 | Wrap every call in a timeout |
| Combat | mineflayer-pvp | ^1.3.x | Defend self when attacked only |
| Collection | mineflayer-collectblock | ^1.4.x | High-level tool for movement LLM |
| Armor | mineflayer-armor-manager | ^2.x | Removes trivial decisions |
| Personality LLM | @anthropic-ai/sdk | ^0.90.0 | Claude Haiku 3; streaming + vision |
| Local LLM | ollama (js client) | ^0.5.x | Qwen 2.5 7B or 14B; user installs daemon |
| Desktop shell | electron | ^32.x | Three-process model |
| Packaging | electron-builder | ^25.x | Use @electron/rebuild for natives |
| Dev bundler | electron-vite | latest | HMR for GUI |
| Config store | electron-store | ^9.x | Small settings only |
| Persistence | better-sqlite3 | ^12.5.0 | Flat schema; sync API |
| Screenshot | screenshot-desktop | ^1.15.3 | Buffer→base64→Anthropic vision |
| Secrets | Electron safeStorage | — | OS keychain for API key |

Not recommended: LangChain.js, Vercel AI SDK, node-llama-cpp, Tauri, lowdb, raw child_process.fork.

## 2. Table Stakes Features

**Bot:** follow named player, respond to addressed/proximity chat, come/stop/halt, look at speaker, auto-eat/sleep, react to being attacked, path around obstacles without hangs, avoid lava near owner.

**Personality:** name + backstory + tone preset, owner awareness (UUID-keyed), consistent voice across sessions.

**Memory:** rolling session, persistent owner across restarts, recent events, graceful forgetting with hard cap.

**GUI:** API key in OS keychain, server form, personality form, Start/Stop + status, live log viewer with error translation, Microsoft auth via BrowserWindow, Ollama status + install hint, auto-reconnect, version auto-detect.

**Differentiators:** two-layer LLM with optional screenshot vision, event-driven personality loop, rate-limited idle commentary, per-player UUID-keyed memory, graceful cloud/local fallback, one-click install.

**Anti-features:** unconstrained code gen, long-horizon autonomous goals, block-breaking without permission, auto-PvP, raw system prompt editing, voice/TTS, multi-bot, LLM-picked coordinates, running JS from chat, plaintext API keys.

## 3. Key Architecture Decisions

**D1. Three-process Electron:** main (windows/config/Ollama/screenshot) ↔ renderer (React GUI, contextIsolation) ↔ utilityProcess.fork (mineflayer + orchestrator + LLMs). MessagePort main↔bot; contextBridge main↔renderer. Mineflayer cannot live in renderer or main.

**D2. Closed action registry, never LLM-generated code.** Zod-schema'd, interruptible actions (AIRI pattern). Movement LLM is a function-caller over a fixed set.

**D3. Event-sourced FSM orchestrator.** Priority queue (P0 attacked/health/owner; P1 chat/world; P2 movement completion; P3 idle). States: IDLE/PERCEIVING/THINKING/ACTING/SPEAKING/INTERRUPTED. Strict one-way hand-off. One outstanding action tracked by actionToken, cancellable via AbortController.

**D4. Layered context (~5–8K tokens):** system prompt + long-term memory (vector-retrieved) + rolling summary + recent raw chat + world snapshot + recent events + optional screenshot + trigger event. Stable prefix for Anthropic prompt caching. Async summarization on ring-buffer eviction.

**D5. Tiered memory in better-sqlite3.** Flat schema: players(uuid,...), events(id,timestamp,type,summary), bot_identity(key,value). Short-term RAM / mid-term session digests / long-term facts with timestamps + decay. Atomic writes, size cap, periodic compaction.

## 4. Critical Pitfalls (Top 5)

**P1. Pathfinder silent hangs** — wall-clock timeout every call; position-delta stuck detection; "couldn't reach" as first-class return.

**P2. Two-layer runaway loop / cost** — hard recursion cap (~5 hops), event debounce (500ms), personality LLM rate limit (30/min, token-bucket), retry budget (2 then escalate), function whitelist, early summarization.

**P3. Mineflayer version mismatch** — default `version: false` (auto-detect); translate protocol errors to plain-English GUI; log supportedVersions.

**P4. Native ABI mismatch at packaging** — `@electron/rebuild` in postinstall; electron-builder `npmRebuild: true`; CI matrix (macos-latest + windows-latest); test packaged builds on clean VMs; package a thin prototype end of Phase 1.

**P5. macOS screen recording permission** — mac-screen-capture-permissions preflight; blank-frame detection → text-only fallback; treat screenshot as optional; window-specific capture not full-screen.

**Cross-cutting principles:** every external call has a timeout; every loop has a bound; every optional capability degrades gracefully; reflexes in code, strategy in LLM; test the packaged build; every GUI error has an action button.

## 5. Suggested Phase Order

| Phase | Name | Focus | Research Flag |
|---|---|---|---|
| 1 | Substrate | mineflayer + action registry + FSM, scripted (no LLMs) | LOW |
| 2 | Two-layer LLM loop | Ollama/Qwen + Haiku, minimal context | HIGH — Qwen tool-calling spike needed |
| 3 | Memory | SQLite tiered + summaries + vector retrieval | MEDIUM |
| 4 | Visual context | Screenshot pipeline, optional capability | MEDIUM |
| 5 | Electron GUI shell | Config, logs, auth, IPC | LOW-MEDIUM |
| 6 | Packaging & distribution | Signing, notarization, auto-update | MEDIUM |

**Early de-risking (parallel with Phase 1):** Qwen tool-calling spike; native-module packaging spike; Apple Developer + Windows EV cert applications (weeks lead time).

## Confidence Assessment

| Area | Confidence | Key gaps |
|---|---|---|
| Stack | MEDIUM-HIGH | Qwen size vs. user hardware needs tuning |
| Features | MEDIUM-HIGH | Non-tech user expectations inferred, not user-tested |
| Architecture | MEDIUM-HIGH | 10s idle heuristic; prompt caching ROI needs measurement |
| Pitfalls | MEDIUM-HIGH | Ollama production patterns softest; mineflayer/Electron rock-solid |

## Open Questions for Requirements Phase

- Chat interrupt UX: cancel mid-step or finish current step?
- Memory privacy for non-owner players; forgetting triggers?
- Qwen fallback policy if tool-calling unreliable — is Haiku-as-executor acceptable cost-wise?
- Hardware floor: min VRAM; CPU-only acceptable?
- Haiku 3 vs Haiku 3.5 — vision requires 3.5; confirm model choice
