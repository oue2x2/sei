---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-05-05T00:37:31.487Z"
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 12
  completed_plans: 9
  percent: 75
---

# State: Sei

## Project Reference

- **Core Value:** A Minecraft companion that feels like a real character — it remembers you, reacts to the world, and acts with personality, not like a scripted bot.
- **Current Focus:** Phase 03 — memory-persistence

## Current Position

Phase: 03 (memory-persistence) — EXECUTING
Plan: 1 of 3
Next: Phase 3 — Memory & Persistence

- **Phase:** 3 — Memory & Persistence
- **Plan:** Phase 2.1 complete (2.1-01, 2.1-02, 2.1-03 all done)
- **Status:** Executing Phase 03
- **Progress:** Phases 3/4 complete (incl. 2.1)
- **Next action:** `/gsd-verify-work 2.1` to formally verify, then `/gsd-discuss-phase 3` to begin memory work.

```
[DONE] Phase 1    Bot Substrate
[DONE] Phase 2    Two-Layer LLM Loop
[DONE] Phase 2.1  Expand Actions & Game State
[____] Phase 3    Memory & Persistence    ← next
[____] Phase 4    Electron GUI & Packaging
```

## Performance Metrics

- Requirements coverage: 36/36 (100%)
- Phases defined: 4
- Plans executed: 9
- Phases complete: 3 (incl. 2.1)

## Accumulated Context

### Decisions (from PROJECT.md / research)

- Single-layer LLM: Haiku 4.5 combined personality + movement dispatch, single API call per iteration (collapsed from two-layer architecture in 260505-iqo).
- Closed Zod-typed action registry; LLM never generates code or coordinates
- Event-sourced FSM with priority queue; one outstanding action tracked by AbortController
- better-sqlite3 for persistence; LLM-directed compaction at semantic boundaries
- Three-process Electron: main ↔ renderer (React) ↔ utilityProcess (mineflayer + orchestrator)
- Screenshot / vision deferred to v2 (requires Haiku 3.5 + macOS permission UX)
- mineflayer-pathfinder goals accessed via default export interop (named ESM export unavailable)
- mineflayer-auto-eat plugin exposed as 'loader' named export, not default
- chat.js uses bot.username for addressed-check to match actual in-game bot name
- Default Anthropic model claude-haiku-4-5-20251001 (Haiku 3 retired April 2026, D-20)
- ANTHROPIC_API_KEY env-var fallback supported in loadConfig (schema stays strict)
- Anthropic cached system prefix: 3 blocks, cache_control ephemeral on LAST block (D-18)
- Hop counter is chain-scoped (keyed by _chainId) not per-dispatch — closes LLM-04 leak across FSM completion re-entries
- LLM tools: say, setGoals + full mineflayer registry (combined call). setGoals lives in registry but tools list filters it out to avoid duplication (D-04 collapsed into combined-call rules in 260505-iqo).
- API-only architecture (260505-iqo): Ollama executor + circuit breaker + handOffToMovement tool removed. Single Anthropic call per iteration with full combined tool set.

### Todos

- Plan and execute Phase 2 (Two-Layer LLM Loop)
- Parallel spike: Qwen tool-calling reliability (de-risk Phase 2)
- Parallel spike: native-module packaging (de-risk Phase 4)
- Parallel task: start Apple Developer / Windows EV cert applications (lead time)

### Roadmap Evolution

- Phase 2.1 inserted after Phase 2: Expand action registry beyond goTo/setGoals and surface inventory/surroundings/position to personality LLM as text (URGENT). Conflict-checked against Phase 3 (Memory) and Phase 4 (GUI) — no overlap; Phase 3 still owns SQLite persistence and compaction.

### Blockers

- None

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260429-nyx | API-only fallback → single combined Haiku call + leading-edge attack throttle | 2026-04-30 | 6468a3e | [260429-nyx-update-api-only-fallback-to-single-combi](./quick/260429-nyx-update-api-only-fallback-to-single-combi/) |
| 260429-ons | in_flight snapshot field + follow gates on action lifecycle + owner-chat preempts in-flight work + tighter action error strings + one-movement-type-per-turn rule | 2026-04-30 | 697f9a9 | [260429-ons-in-flight-snapshot-field-action-lifecycl](./quick/260429-ons-in-flight-snapshot-field-action-lifecycl/) |
| 260502-h6i | Sei latency + diary hallucination fixes: cache_control on last tool, no-op compaction skip, remove look tool, owner-chat preempt (sei:chat_received), stop-verb pre-LLM hard cancel | 2026-05-02 | ce7d90e | [260502-h6i-fix-sei-latency-owner-chat-preempt-stop-](./quick/260502-h6i-fix-sei-latency-owner-chat-preempt-stop-/) |
| 260503-1bu | Snapshot `recent_events:` deltas (kills, inventory gains, hp loss) + `prior_task:` interrupt-resume hint so bot resumes prior task after chat interrupt without reminder | 2026-05-03 | 1bbb67d | [260503-1bu-add-snapshot-delta-indicators-kills-inve](./quick/260503-1bu-add-snapshot-delta-indicators-kills-inve/) |
| 260503-1sk | Exposure-filter `nearby blocks:` (no more xray), add `around feet:` 5×4×5 grouped line, expand interesting set to terrain blocks (sand, sandstone, gravel, dirt, grass_block, …), and double radius when local view is sparse — fixes "get me 10 sand" failure on beach | 2026-05-03 | 5abc8a8 | [260503-1sk-snapshot-blocks-only-show-exposed-non-xr](./quick/260503-1sk-snapshot-blocks-only-show-exposed-non-xr/) |
| 260503-cli | Prod/dev chat mode split (only `say` reaches chat in prod, ≤15 words) + Sei=framework / character=Sui rebrand + light-blue `sei` CLI for onboarding/start/config + README rewrite | 2026-05-03 | cfe75b0 | [260503-cli-prod-chat-mode-rebrand](./quick/260503-cli-prod-chat-mode-rebrand/) |
| 260504-oh9 | Fix sei CLI silent exit under npx/global-install (entrypoint guard now realpath-resolves argv[1]) + first-run gate so `sei start`/`sei config` refuse without `config.json` + README switched to `npm link` + `sei` | 2026-05-04 | fdbc8ca | [260504-oh9-fix-sei-cli-entrypoint-guard-silent-exit](./quick/260504-oh9-fix-sei-cli-entrypoint-guard-silent-exit/) |

## Session Continuity

- **Last action:** Quick task 260504-oh9 — fixed `npx sei` (and global-install / `npm link`) silent-exit bug by realpath-resolving `process.argv[1]` in the entrypoint guard; added a `requireOnboarded()` gate so `sei start` and `sei config` refuse to run before onboarding has produced `config.json`; README quickstart now installs globally with `npm link` and runs as bare `sei`.
- **Next action:** `/gsd-plan-phase 3` to begin memory & persistence work.

---
*Last updated: 2026-05-04 — quick task 260504-oh9 completed.*
| 2026-05-03 | fast | attack pursues + zod entity schema cleanup | done |
