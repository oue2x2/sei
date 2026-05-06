# Phase 03.1 Validation

**Validated:** 2026-05-06
**Method:** Static (grep) checks for code-path presence + automated test runs (postProcessSay, firstTurnSay, affectLog, progressCadence). Live-session replays for behavior verification are deferred to Task 2 checkpoint (the "Live verdict" column is intentionally empty and gets populated when the user replays the four scenarios in-game).

Source logs cited (under `logs/` — gitignored, not in this repo's tree but referenced by the four findings files under `.planning/phases/03.1-.../log-analysis/`): wood.txt (10 defects), explore.txt (10 defects), hunt+sand.txt (11 defects), memory.txt (6 defects). 37 cited defects total.

Tests are housed at `scripts/test-*.mjs` (NOT `test/...` — `test/` is gitignored at project root, line 6). This is the established convention from Plans 03 + 04 + 05 SUMMARY files.

---

## Refactor invariants

| Invariant | Check | Result |
|---|---|---|
| `brain/` has zero `mineflayer` references | `grep -rln 'mineflayer' src/brain/` | exit=1 (no matches) — PASS |
| `brain/` has zero `adapter/minecraft` references | `grep -rln 'adapter/minecraft' src/brain/` | exit=1 (no matches) — PASS |
| All Adapter members implemented | (see "Adapter members" table below) | 14/14 PRESENT — PASS |
| Cache prefix md5 stable since Plan 04 | `node -e "<harness — see Plan 02 SUMMARY 'Cache Prefix BEFORE/AFTER'>"` | BEFORE (Plan 02 baseline): `c7b24c5c0529cfdb787799e971f8bd2b` (7000B). AFTER (Plan 03 cache-bust): `5ca24ca374e40f1d3b371886ad353d2f` (6120B). CURRENT (post-Plan-05): `b939e481e9dbaa1aaeaa9f2970f5ff54` (6320B). Verdict: Plan 03 paid one intentional cache rebuild; Plan 04 added persona bytes (NOTE_TO_SELF_GUIDANCE) inside the same window per Plan 04 SUMMARY decision #6. Plan 05 did NOT bust the prefix (per Plan 05 SUMMARY "Cache Impact" — DIG_DESCRIPTION rebuild lands inside the Plan-03 window; idle/loop_end addenda + soft nudge are dynamic per-turn user content). The 200B Plan-03→current delta (+200B) is consistent with the Plan 04 NOTE_TO_SELF_GUIDANCE sentence + the noteToSelf tool-description block addition. |
| `node scripts/test-firstTurnSay.mjs` | run + record exit | "firstTurnSay: all 7 cases passed" — exit=0 — PASS |
| `node scripts/test-postProcessSay.mjs` | run + record exit | "postProcessSay: all cases passed" — exit=0 — PASS |
| `node scripts/test-affectLog.mjs` | run + record exit | "affectLog + owner: all cases passed" — exit=0 — PASS |
| `node --test scripts/test-progressCadence.mjs` | run + record exit | tests 5 / pass 5 / fail 0 — exit=0 — PASS |

### Adapter members (14 from src/brain/types.js — all checked against src/adapter/minecraft/index.js)

| # | Member | grep `<member>` src/adapter/minecraft/index.js | Result |
|---|---|---|---|
| 1 | `listActions` | match | PRESENT |
| 2 | `getActionSchema` | match | PRESENT |
| 3 | `getActionDescription` | match | PRESENT |
| 4 | `executeAction` | match | PRESENT |
| 5 | `createSnapshotComposer` | match | PRESENT |
| 6 | `worldPrimer` | match | PRESENT |
| 7 | `attach` | match | PRESENT |
| 8 | `chat` | match | PRESENT |
| 9 | `setInflightProvider` | match | PRESENT |
| 10 | `closeAnySessions` | match | PRESENT |
| 11 | `supportsAutoEat` | match | PRESENT |
| 12 | `supportsFollow` | match | PRESENT |
| 13 | `botUsername` | match | PRESENT |
| 14 | `getKnownPlayers` | match | PRESENT |

All 14 contract members from the JSDoc Adapter typedef in `src/brain/types.js` are present in `src/adapter/minecraft/index.js`. None MISSING.

---

## Defect verdict table — wood.txt (10 defects)

| ID | Title | Plan(s) | Code-path check | Live verdict | Notes |
|---|---|---|---|---|---|
| D-W-1 | Bot self-assigns task | 05 | `grep -q "Settle\|settle.*no need" src/brain/orchestrator.js` → MATCH | | static: FIXED — sei:loop_end addendum: "Settle, no need to start a new task..." |
| D-W-2 | 10-call dig fan-out | 05 | `grep -q "only one dig per turn" src/brain/orchestrator.js` → MATCH | | static: FIXED — parallel-dig cap=1 dispatch |
| D-W-3 | Out-of-range dig retry | 05 | `grep -q "SEARCH RADIUS" src/adapter/minecraft/behaviors/dig.js` → MATCH | | static: FIXED — DIG_DESCRIPTION rewrite |
| D-W-4 | Re-narrating inventory | 05 | empty-text guard in say() (`src/brain/orchestrator.js:958` → `if (line && line.trim().length > 0)` immediately above `convoMemory.recentChat.pushSelf`) — MATCH (visual confirmation, regex-grep too narrow) | | static: FIXED — empty say() lines no longer enter self-buffer |
| D-W-5 | text leaks player-prose | DEFERRED | per CONTEXT D-3 | DEFERRED | DEFERRED — item 3 deferred per user |
| D-W-6 | #N indices change | 05 | `grep -q "rotate every snapshot" src/adapter/minecraft/behaviors/dig.js` → MATCH | | static: FIXED — DIG_DESCRIPTION includes rotation warning + `{block:...}` hint |
| D-W-7 | Path oscillates as owner walks | 05 | `grep -q "closest=" src/adapter/minecraft/behaviors/pathfind.js` → MATCH | | static: FIXED — cant_reach now reports closest distance |
| D-W-8 | Bot fails progress chat under pressure | 05 | first-turn-say enforcement (`shouldRepromptForFirstTurnSay` predicate, 7 unit cases pass) covers chat-triggered loops | PARTIAL | static: PARTIAL — re-attack mid-loop case may still drop ack — note in live verdict |
| D-W-9 | Diary purple prose | 04 | `grep -q "Maximum 80 words" src/brain/compaction.js` → MATCH | | static: FIXED — SUMMARY_PROMPT_INTRO rewrite: 80-word cap + anti-pattern examples |
| D-W-10 | dropItem 10 sand silent | 05 | `grep -q "dropping 4+ items requires" src/brain/orchestrator.js` → MATCH | | static: FIXED — dropItem(>=4) without paired say() reprompts |

## Defect verdict table — explore.txt (10 defects)

| ID | Title | Plan(s) | Code-path check | Live verdict | Notes |
|---|---|---|---|---|---|
| D-E-1 | goTo flails inland | 05 | `grep -q "closest=" src/adapter/minecraft/behaviors/pathfind.js` → MATCH; SYSTEM_INSTRUCTIONS "Pathfinder rule: if goTo returns cant_reach twice for the same destination, ask for help in say() instead of trying again" (Plan 03 AFTER text) | | static: FIXED — combined fix: hint + ask-for-help rule |
| D-E-2 | text→say verbatim | DEFERRED | per CONTEXT D-3 (text leakage skipped) | DEFERRED | DEFERRED |
| D-E-3 | "you/me" framing | 03 | `grep -q "FRAMING_LINE\|partners" src/brain/persona.js` → MATCH | | static: FIXED — FRAMING_LINE constant in persona; renderPersona now appends "we"/"us"/"the owner" line |
| D-E-4 | Redundant clarifying questions | PARTIAL | OWNER.md `## Notes` can record "appreciates action" via `noteToSelf` (`appendNote` in src/brain/memory/owner.js — MATCH from Plan 04) but not enforced | PARTIAL | static: PARTIAL — rely on noteToSelf usage; surface in live verdict |
| D-E-5 | Ignores "come here" partially | 05 | `closest=` hint (D-E-1) + ask-for-help rule (Plan 03 AFTER text) — MATCH | | static: FIXED — combined fix |
| D-E-6 | Snapshot scenery generic | 03 | `grep -q "casually acknowledge" src/brain/orchestrator.js` → MATCH | | static: FIXED — SYSTEM_INSTRUCTIONS entity-richness rule added |
| D-E-7 | Coord talk leaks | NOT-PLANNED | partially mitigated by D-7 say() strip; raw coords in `text` field not addressed | PARTIAL | static: NOT-PLANNED / PARTIAL — postProcessSay strips terminals/dashes/quotes from say() but `text` field passes through unfiltered; D-7 leak path is closed for the user-visible channel |
| D-E-8 | Idle = nag | 05 | `grep -q "silence is fine" src/brain/orchestrator.js` → MATCH | | static: FIXED — sei:idle addendum |
| D-E-9 | 9-iter loop without progress narration | 05 | `node --test scripts/test-progressCadence.mjs` → 5/5 PASS + `grep -q "iterationsSinceLastSay" src/brain/orchestrator.js` → MATCH | | static: FIXED — _advanceIterationCadence helper + soft nudge after SILENT_ITERATIONS_BEFORE_NUDGE (=4) silent iterations |
| D-E-10 | Diary not internalized | 04 | new compaction prompt (`Maximum 80 words` + anti-pattern examples — MATCH) + AFFECT.md two-tier persistence — quality verdict requires live test | | static: PARTIAL — content quality is downstream of prompt rewrite |

## Defect verdict table — hunt+sand.txt (11 defects)

| ID | Title | Plan(s) | Code-path check | Live verdict | Notes |
|---|---|---|---|---|---|
| D-H-1 | First-turn say omitted | 05 | `node scripts/test-firstTurnSay.mjs` → "all 7 cases passed" exit=0 PASS | | static: FIXED — shouldRepromptForFirstTurnSay predicate + runIterations call site |
| D-H-2 | text addresses player 2nd person | DEFERRED | per CONTEXT D-3 | DEFERRED | DEFERRED |
| D-H-3 | Tone "you/me" not "we" | 03 | `grep -q "FRAMING_LINE" src/brain/persona.js` → MATCH | | static: FIXED — FRAMING_LINE in persona |
| D-H-4 | Punctuation everywhere | 03 | `node scripts/test-postProcessSay.mjs` → "postProcessSay: all cases passed" exit=0 PASS | | static: FIXED — postProcessSay strip set: terminals, dashes, quotes, backticks; preserves apostrophes |
| D-H-5 | 7-way dig barrage | 05 | `grep -q "only one dig per turn" src/brain/orchestrator.js` → MATCH | | static: FIXED — parallel-dig cap=1 (same dispatch as D-W-2) |
| D-H-6 | follow returns "target gone" | 05 | `grep -q "already pursuing" src/brain/orchestrator.js` → MATCH | | static: FIXED — follow + attackEntity same-turn collapse: follow becomes no-op |
| D-H-7 | Snapshot #N inter-turn | 05 | `grep -q "rotate every snapshot" src/adapter/minecraft/behaviors/dig.js` → MATCH | | static: FIXED — DIG_DESCRIPTION warns about rotation (same fix as D-W-6) |
| D-H-8 | PLAYER INTERRUPT double-fire | 05 | `grep -q "_lastPreservedSig" src/brain/orchestrator.js` → MATCH | | static: FIXED — shouldPreserveInterrupt helper + `${username}:${text}:${Math.floor(ts/500)}` signature dedup |
| D-H-9 | goTo cant_reach default-range | 05 | `grep -q "isCoordsAtKnownPlayer" src/adapter/minecraft/registry.js` → MATCH | | static: FIXED — isCoordsAtKnownPlayer detector + `range = 2` when coords match a known player within 1.5 blocks |
| D-H-10 | Empty say() on action turns | 05 | first-turn-say enforcement covers this — `grep -c "shouldRepromptForFirstTurnSay" src/brain/orchestrator.js` → 2 PASS | | static: FIXED — predicate + runtime call site (one reprompt max per loop) |
| D-H-11 | 26s of silent combat | 05 | first-turn-say covers start (Task 1) + progress-cadence covers mid-task silence (Task 4) — `node --test scripts/test-progressCadence.mjs` → 5/5 PASS | | static: FIXED — layered: first-turn ack + soft nudge after 4 silent iterations |

## Defect verdict table — memory.txt (6 defects)

| ID | Title | Plan(s) | Code-path check | Live verdict | Notes |
|---|---|---|---|---|---|
| D-M-1 | Praise/affect never persisted | 04 | `grep -q "loopHasAffect" src/brain/sessionState.js` → MATCH + AFFECT.md (gitignored runtime artifact, cold-created on first noteToSelf emission) | | static: FIXED — OR-gate (mutation OR affect) on cadence-cap and session-end flushes |
| D-M-2 | Diary entries are blobs | 04 | structured AFFECT.md + new compaction prompt (`Maximum 80 words` + anti-pattern examples — MATCH) | PARTIAL | static: PARTIAL — structural fix shipped; content quality requires live test |
| D-M-3 | Seed loader FIFO-only | DEFERRED-WITH-RATIONALE | Plan 04 §deferred_with_rationale documents the trace: AFFECT.md satisfies CONTEXT D-4's "durable high-signal entries reachable across sessions" intent; seed-loader algorithm change deferred to v2 | DEFERRED | DEFERRED |
| D-M-4 | OWNER.md ## Notes empty | 04 | `grep -q "appendNote" src/brain/memory/owner.js` → MATCH + noteToSelf `kind:'preference'` branch in orchestrator dispatch | | static: FIXED — structured `appendNote` helper + `setPreferredName` for kind='name' |
| D-M-5 | Hallucinated denial | PARTIAL | with AFFECT.md present, model has positive evidence; closed-world reasoning rule could help (NOT-PLANNED) | PARTIAL | static: PARTIAL — gap surfaced for follow-up (closed-world reasoning rule NOT-PLANNED) |
| D-M-6 | loopHistory crowds out diary | 03 | `grep -nE "LOOP_HISTORY_CAPACITY.*=.*10\b" src/brain/convoMemory.js` → line 30 MATCH; `grep -nE "LOOP_HISTORY_CAPACITY.*=.*20\b" src/brain/convoMemory.js` → 0 hits | | static: FIXED — cap reduced 20 → 10 (Trim 4) |

---

## Summary

Total cited defects: 37
- FIXED (code-path verified): (pending live verdicts)
- PARTIAL (some sub-issue not covered): (pending live verdicts)
- DEFERRED (per CONTEXT or RESEARCH): (pending live verdicts)
- NOT-PLANNED (surfaced for follow-up): (pending live verdicts)
- STATIC ONLY (Option B): (pending checkpoint)

Static-check tally (informational, pre-live-verdict):
- Static MATCH (defect-fix code path proven present): D-W-1, D-W-2, D-W-3, D-W-4, D-W-6, D-W-7, D-W-9, D-W-10, D-E-1, D-E-3, D-E-5, D-E-6, D-E-8, D-E-9, D-E-10, D-H-1, D-H-3, D-H-4, D-H-5, D-H-6, D-H-7, D-H-8, D-H-9, D-H-10, D-H-11, D-M-1, D-M-2, D-M-4, D-M-6 = **29 defects with affirmative static evidence**
- PARTIAL (structural fix only; content/behavior verdict requires live replay): D-W-8, D-E-4, D-E-7, D-M-5 = **4 defects**
- DEFERRED (per CONTEXT D-3 / Plan 04 §deferred_with_rationale): D-W-5, D-E-2, D-H-2, D-M-3 = **4 defects**

29 + 4 + 4 = 37. Live verdicts pending Task 2 checkpoint.

Refactor invariants: 7/7 PASS (mineflayer-free brain, adapter/minecraft-free brain, all 14 Adapter members present, 4 test runners green, cache prefix accounted for).
