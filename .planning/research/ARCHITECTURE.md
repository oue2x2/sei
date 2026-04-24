# Architecture Patterns

**Domain:** Minecraft AI companion (two-layer LLM + mineflayer + Electron)
**Researched:** 2026-04-24
**Overall confidence:** MEDIUM-HIGH (patterns verified across multiple real projects: Voyager, Mindcraft, AIRI; Electron/mineflayer specifics verified against official docs)

---

## 1. High-Level Recommended Architecture

Sei fits the well-established **Planner–Executor (P-t-E)** pattern, with the twist that the planner also owns personality/conversation and runs as a long-lived event loop rather than a one-shot planner.

```
┌──────────────────────────── Electron App ───────────────────────────────┐
│                                                                         │
│   ┌─────────────────┐  IPC   ┌─────────────────────┐                    │
│   │ Renderer (GUI)  │ <────> │ Main Process         │                   │
│   │ React/Vite      │ Message│ - Window mgmt        │                   │
│   │ - API key form  │ Ports  │ - Config persistence │                   │
│   │ - Personality   │        │ - Ollama lifecycle   │                   │
│   │ - Logs/Status   │        │ - Screenshot capture │                   │
│   └─────────────────┘        └──────────┬───────────┘                   │
│                                          │ MessagePort                  │
│                                          │ (utilityProcess.fork)        │
│                              ┌──────────▼───────────────────────────┐   │
│                              │ Bot UtilityProcess (Node)            │   │
│                              │                                      │   │
│                              │  ┌─────────────────────────────┐    │   │
│                              │  │  Orchestrator / Event Bus    │   │   │
│                              │  │  - Event queue (priority)    │   │   │
│                              │  │  - State machine (IDLE/      │   │   │
│                              │  │    THINKING/ACTING/CHATTING) │   │   │
│                              │  └────┬────────────┬───────────┘    │   │
│                              │       │            │                 │   │
│                              │  ┌────▼──────┐  ┌──▼───────────┐    │   │
│                              │  │Personality│  │ Movement LLM  │    │   │
│                              │  │LLM Client │→ │ Client        │    │   │
│                              │  │(Haiku 3)  │  │ (Ollama Qwen) │    │   │
│                              │  └────┬──────┘  └──┬────────────┘    │   │
│                              │       │            │                  │   │
│                              │  ┌────▼──────┐  ┌──▼──────────┐      │   │
│                              │  │ Memory    │  │ Skill/Action│      │   │
│                              │  │ Store     │  │ Registry    │      │   │
│                              │  │(SQLite +  │  │(mineflayer  │      │   │
│                              │  │ vector)   │  │ wrappers)   │      │   │
│                              │  └───────────┘  └──┬──────────┘      │   │
│                              │                     │                  │   │
│                              │                ┌────▼──────────────┐  │   │
│                              │                │ Mineflayer Bot    │  │   │
│                              │                │ (tick loop,       │  │   │
│                              │                │  events)          │  │   │
│                              │                └────┬──────────────┘  │   │
│                              └─────────────────────┼─────────────────┘   │
└────────────────────────────────────────────────────┼─────────────────────┘
                                                     │
                                                     ▼
                                             Minecraft Server
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| Renderer (GUI) | Config form, live status display, log viewer | Main (via contextBridge IPC) |
| Main Process | Window lifecycle, config persistence (electron-store), Ollama spawn/health, screenshot capture via `desktopCapturer` | Renderer (IPC), Bot (MessagePort) |
| Bot UtilityProcess | Hosts mineflayer + orchestrator + LLMs; isolated from UI crashes | Main (MessagePort), Minecraft server, Anthropic API, Ollama HTTP |
| Orchestrator | Event queue, state machine, owns the "turn" of the agent | Personality LLM, Movement LLM, Memory, Mineflayer events |
| Personality LLM Client | Sends context snapshot, parses NL instruction + chat output | Orchestrator, Memory |
| Movement LLM Client | Receives NL instruction, emits function calls | Action Registry |
| Action Registry | Validated mineflayer wrappers (Zod-schema'd, interruptible) | Mineflayer |
| Memory Store | Identity, relationships, summarized history, episodic vector store | Personality LLM (retrieval + write) |
| Mineflayer Bot | Low-level protocol, world state, tick loop | Minecraft, Action Registry, Orchestrator (events) |

**Rule of thumb:** the orchestrator is the *only* component that owns control flow. LLM clients are stateless functions. Mineflayer is a passive substrate.

---

## 2. LLM Orchestration: Event Loop & State Machine

This is the most critical design area. Naive loops deadlock, double-fire, or let LLMs talk over themselves.

### Recommended: Event-sourced loop with a finite state machine

Borrow from StateFlow / XState agent patterns and the "event log, not mutable state" model (boundaryml / 12-factor-agents). The orchestrator is a **synchronous state machine driven by an async event queue**.

**States:**
- `IDLE` — nothing pending; 10s timer armed for ambient behavior
- `PERCEIVING` — gathering snapshot (world state + screenshot + recent events)
- `THINKING` — personality LLM call in flight
- `ACTING` — movement LLM call in flight *or* mineflayer action executing
- `SPEAKING` — emitting chat message to server
- `INTERRUPTED` — high-priority event arrived mid-flight; cancel + re-plan

**Events that enter the queue (with priority):**

| Priority | Event | Source |
|----------|-------|--------|
| P0 (preempt) | `attacked`, `health_critical`, `owner_direct_message` | mineflayer |
| P1 | `chat_message`, `player_joined`, `significant_world_event` (mob spawn, inv change, block break nearby) | mineflayer |
| P2 | `movement_llm_completed` (small model finished; report back) | movement LLM |
| P3 | `idle_timeout` (10s fallback) | timer |

### The loop

```
while (running) {
  event = await queue.dequeue();      // blocks; priority-ordered
  if (state == THINKING && event.priority <= P1) {
    abortController.abort();           // preempt personality LLM
    state = INTERRUPTED;
  }
  state = PERCEIVING;
  context = buildContext(event);       // §3
  state = THINKING;
  response = await personalityLLM(context, abortController.signal);
  if (response.chat) { state = SPEAKING; bot.chat(response.chat); }
  if (response.instruction) {
    state = ACTING;
    // fire-and-forget to movement LLM; its completion becomes a P2 event
    movementLLM(response.instruction).then(r => queue.enqueue({type:'movement_llm_completed', r}, P2));
  }
  state = IDLE;
  armIdleTimer(10_000);
}
```

### How personality and movement LLMs avoid stepping on each other

1. **Strict hand-off direction:** personality → movement only, never reverse. Movement LLM never decides what to do next; it only executes.
2. **One outstanding instruction at a time:** movement LLM call is tracked by an `actionToken`. New P0/P1 events cancel the current action via `bot.pathfinder.stop()` / `AbortController` on the Ollama call, and the stale completion event is dropped by token mismatch.
3. **Movement LLM completion is itself an event**, not a blocking return. This lets the personality LLM react to "I finished chopping the tree" on its next turn rather than sitting blocked.
4. **Chat is non-blocking.** Personality LLM emits chat + instruction in the same turn; chat sends immediately, instruction goes to the movement queue.

### Debouncing

Minecraft emits dozens of events per tick (block updates, entity moves). Collapse them:
- Window world-event aggregator (e.g., 500ms) emits one `world_changed` event with a diff summary, not one per block.
- Chat is never debounced — each message enqueues individually.

Confidence: HIGH (pattern corroborated by Mindcraft's Brain, AIRI's CognitiveEngine with TaskExecutor + EventBus, and StateFlow paper).

---

## 3. Lessons from Voyager / Mindcraft / AIRI

### Voyager (GPT-4, MineDojo)
- **Skill library** indexed by embedding of description — learned skills become retrievable. Sei doesn't need full skill synthesis for v1, but the *pattern* of a vector-indexed action library is directly useful for few-shot examples in the personality LLM prompt.
- **Iterative prompting with environment feedback** — execution errors are fed back as prompt context. Sei should do this: when movement LLM fails (e.g., "path not found"), the error string becomes part of the next personality LLM turn.
- **Applicable to Sei:** feedback loop yes, curriculum/auto-exploration no (Sei is reactive, not task-maximizing).

### Mindcraft (mindcraft-bots/mindcraft)
- Generates high-level JS code from LLM and executes it. **Too risky for Sei's v1** — a local 9B model generating arbitrary JS is a footgun. Prefer a fixed action registry (pattern below).
- **Context boundaries** — conversation history must be truncated or summarized. Confirms §4 approach.
- **Embedding-retrieved in-context examples** improve quality dramatically.

### AIRI (moeru-ai/airi)
- **Three-layer action system:** action definitions (with Zod schema) → ActionRegistry → TaskExecutor. This is exactly the right shape for Sei's movement LLM target.
- **Prismarine-viewer on port 3007** is free debug value — consider bundling it behind a dev flag.
- **CognitiveEngine as a mineflayer plugin** — wraps Brain + TaskExecutor + EventBus. Clean pattern: orchestrator attaches to bot as a plugin.

### Key lesson across all three
Do **not** let the LLM emit raw code. Define a **closed action set** with typed schemas, and make the movement LLM a function-caller over that set. This is what Qwen is actually good at, and it's what keeps the system debuggable.

---

## 4. Context Window Management (Personality LLM)

Haiku 3 has a 200K context window, so you're unlikely to run out of tokens mechanically. The real problem is **signal-to-noise**: stuffing 150K of junk makes Haiku dumb and expensive.

### Recommended layered context structure

Each turn, assemble a prompt with these slots (rough budget in tokens):

| Slot | Budget | Content | Source |
|------|--------|---------|--------|
| System prompt | 500 | Identity, personality, rules | Config (immutable per session) |
| Long-term memory | 1K–2K | Retrieved relevant facts via vector search on current event | SQLite + embeddings |
| Running summary | 500–1K | Rolling summary of session (LLM-generated, updated every N turns) | Summarizer |
| Recent chat (raw) | 1K–2K | Last ~20 messages verbatim | Ring buffer |
| World snapshot | 500 | Position, health, hunger, time, nearby entities (top 10), inventory summary | mineflayer current state |
| Recent events | 500 | Last ~10 world events (diffed, not raw) | Event log |
| Screenshot | ~1.5K (image tokens) | Optional, only when visually relevant (e.g., looking-around turn), not every turn | desktopCapturer |
| Trigger event | 200 | What caused this turn | Event queue |
| **Total** | **~5–8K** | Well under Haiku's limits, keeps cost predictable | |

### Summarization strategy

Use the **ConversationSummaryBufferMemory** hybrid pattern (LangChain-origin, but roll your own — don't pull in LangChain):

1. Keep a raw ring buffer of last N turns (N=20).
2. When turn N+1 arrives, the oldest turn is asynchronously fed to a summarizer (can be Haiku itself with a "compress this turn into the running summary" prompt, or cheaper: a separate tiny call).
3. Running summary is updated; raw oldest turn is discarded.
4. Long-term memory (facts about players, world progression) is extracted on a separate cadence — every ~10 turns, ask Haiku "any durable facts worth remembering?" and upsert to the memory store.

### Screenshot economics

Images cost ~1.5K tokens each. Don't send every turn. Gate screenshot inclusion on:
- Trigger event type (e.g., "player pointed at something", "idle look-around")
- Novelty (hash-compare to last sent; skip if unchanged)
- Explicit trigger from previous turn's reasoning ("I should look around")

Confidence: HIGH (pattern standard across LLM chatbots; Mindcraft and Vellum/LangChain guides align).

---

## 5. Process Architecture in Electron

### Recommendation: three processes

1. **Main process** — Electron default; owns windows, config persistence, Ollama subprocess lifecycle, screenshot capture (only the main process can use `desktopCapturer`).
2. **Renderer process** — Vite + React GUI. `contextIsolation: true`, `nodeIntegration: false`, communicates via a typed preload bridge.
3. **Bot UtilityProcess** — Spawned via `utilityProcess.fork()` from main. Runs mineflayer + orchestrator + LLM clients.

### Why utilityProcess over child_process.fork

Per Electron's official docs (verified):
- `utilityProcess` provides **MessagePort-based IPC** that can be handed directly to the renderer, enabling structured, typed communication.
- Emits proper `child-process-gone` events for crash handling (raw `child_process` does not).
- Chromium Services-backed; integrates with Electron's crash reporter.
- Electron team explicitly recommends it over `child_process.fork` for forked child work.

### Why not run mineflayer in the main process

- Mineflayer's packet parsing + pathfinder are CPU-hot; blocking the main process freezes the UI.
- A mineflayer crash (malformed packet, plugin bug) takes down the whole app.
- Isolation also makes "restart bot without restarting app" trivial.

### Why not run mineflayer in the renderer

- Renderer has Chromium sandbox restrictions, no raw TCP. Cannot connect to Minecraft servers cleanly.
- Security: you want the minecraft network socket and API keys *nowhere near* arbitrary web content.

### IPC shape

```
Renderer  <─(contextBridge IPC)─>  Main  <─(MessagePort)─>  Bot UtilityProcess
```

Typed messages (use a shared TS types package). Examples:

- `main → bot`: `{type:'start', config}`, `{type:'stop'}`, `{type:'screenshot', png}`
- `bot → main`: `{type:'log', level, msg}`, `{type:'status', state}`, `{type:'request_screenshot'}`, `{type:'chat', text}`
- `main → renderer`: forwards bot status + logs
- `renderer → main`: config changes, start/stop commands

### Ollama

Spawn as a child of the main process (not the bot process) — then the bot restarting doesn't kill Ollama (model re-load is slow). Health-check via `GET http://127.0.0.1:11434/api/tags` before telling the bot it's ready.

Confidence: HIGH (verified against Electron official docs).

---

## 6. State Management: Who Owns What

A frequent source of bugs in multi-process LLM apps is duplicated state. Single-owner rule:

| State | Owner | Notes |
|-------|-------|-------|
| User config (API key, personality, model source) | Main (electron-store on disk) | Bot gets a copy at start; re-sent on change |
| Bot runtime state (connected, health, position) | Mineflayer (inside bot process) | Bot forwards summaries to main for display |
| Orchestrator state machine | Bot process, in memory | Not persisted; rebuilt on restart |
| Event log / recent events | Bot process, in memory ring buffer | Ephemeral |
| Conversation history (raw + summary) | Bot process, mirrored to SQLite | Survives restarts |
| Long-term memory (identity, relationships, facts) | SQLite + vector store on disk | Single source of truth |
| API keys | Main (secure storage via OS keychain via `keytar` or `safeStorage`) | Never log, never send to renderer after initial entry |
| UI state (current view, form values) | Renderer only | Doesn't need persistence |

**Rule:** the renderer is a *view*, the main process is a *config store + process supervisor*, the bot process is *the agent*. Treat it like a 3-tier app.

---

## 7. Data Flow — End-to-End Example

User types "hey sei, come here" in Minecraft chat:

1. Mineflayer `chat` event fires in bot process.
2. Orchestrator enqueues `{type:'chat_message', from:'player', text:'hey sei, come here'}` at P1.
3. Orchestrator dequeues → state `PERCEIVING`. Builds context (§4): system prompt + summary + last 20 chat turns + world snapshot + recent events + this event.
4. Maybe requests screenshot: sends `{type:'request_screenshot'}` to main via MessagePort; main captures via `desktopCapturer`, returns PNG bytes; bot includes in Haiku prompt.
5. State `THINKING`. Call Haiku with `AbortController`. Haiku returns `{chat: "on my way!", instruction: "walk to the player named ouen"}`.
6. State `SPEAKING`. `bot.chat("on my way!")`. Fire-and-forget; Minecraft server sees it.
7. State `ACTING`. Movement LLM (Qwen via Ollama `/api/chat` with tools) receives instruction + available function schemas. Returns `pathfinder.goto({playerName:'ouen'})`.
8. Action Registry validates args with Zod, invokes mineflayer pathfinder. Pathfinder runs async.
9. Meanwhile Sei's position-update events are debounced and dropped (P2-or-lower; state machine ignores).
10. Pathfinder `goal_reached` event → enqueued as `{type:'movement_llm_completed', result:'arrived'}` at P2.
11. Orchestrator handles: personality LLM turn → "I'm here!" chat, no new instruction.
12. State `IDLE`, idle timer armed.

---

## 8. Patterns to Follow

### Pattern 1: Action Registry with Zod Schemas
**What:** every mineflayer capability exposed to the movement LLM is a registered action with a Zod-validated argument schema and an interruptible executor.
**When:** always — single entry point for all movement LLM function calls.
**Example:**
```typescript
const goToPlayer = defineAction({
  name: 'goto_player',
  description: 'Walk to a named player',
  schema: z.object({ playerName: z.string() }),
  perform: (bot) => async ({ playerName }, signal) => {
    const target = bot.players[playerName]?.entity;
    if (!target) throw new Error(`player ${playerName} not visible`);
    signal.addEventListener('abort', () => bot.pathfinder.stop());
    await bot.pathfinder.goto(new GoalFollow(target, 2));
  },
});
```

### Pattern 2: Event Queue + FSM
**What:** single priority queue drives a pure FSM; async work returns via new events.
**When:** always.

### Pattern 3: Plugin-shaped Orchestrator
**What:** expose the orchestrator as a mineflayer plugin (`bot.loadPlugin(orchestrator(...))`). Mirrors AIRI's CognitiveEngine.
**When:** always — gives clean attach/detach, standard mineflayer idioms.

### Pattern 4: Typed MessagePort IPC
**What:** shared TS type definitions for every message between main/renderer/bot.
**When:** always.

---

## 9. Anti-Patterns to Avoid

### Anti-Pattern 1: LLM-generated JavaScript
**What:** letting the movement LLM emit raw JS to be `eval`'d (Voyager/Mindcraft style).
**Why bad:** 9B local model will hallucinate APIs; debugging is impossible; security nightmare.
**Instead:** closed action registry with schemas.

### Anti-Pattern 2: Blocking Turn Loop
**What:** `await personalityLLM(); await movementLLM(); await mineflayerAction();` in a single synchronous chain.
**Why bad:** a 5-second pathfind blocks all chat responses; the bot feels dead.
**Instead:** each long operation returns via a queue event; loop is event-driven.

### Anti-Pattern 3: Stateful LLM Clients
**What:** LLM client holds conversation state internally.
**Why bad:** retries/restarts lose it; hard to test; conflicts with explicit context management.
**Instead:** LLM clients are pure `(context, signal) → response` functions. Orchestrator owns state.

### Anti-Pattern 4: Mineflayer in the Renderer or Main Process
**What:** running the bot in-process with the UI or the main process.
**Why bad:** UI jank, cascading crashes, sandbox conflicts.
**Instead:** `utilityProcess.fork`.

### Anti-Pattern 5: Raw Event Firehose to LLM
**What:** forwarding every mineflayer event into the personality LLM.
**Why bad:** token explosion, noise, rate-limit your own loop.
**Instead:** debounced aggregator + explicit "significant event" filter.

### Anti-Pattern 6: One Big Prompt with Everything
**What:** appending all history raw.
**Why bad:** cost, latency, attention dilution.
**Instead:** layered context with summary + recent + retrieved memory.

---

## 10. Scalability & Robustness Considerations

Sei is single-user, single-bot — "scale" here means session duration and failure modes.

| Concern | 1-hour session | 8-hour session | Multi-day |
|---------|----------------|----------------|-----------|
| Conversation history | Raw buffer fine | Summarize every ~20 turns | Summary-of-summaries; episodic memory in vector store |
| Memory store | SQLite in-process | SQLite + WAL | SQLite + scheduled compaction |
| LLM cost | Negligible | Monitor; consider caching system prompt via Anthropic prompt caching | Prompt caching essential |
| Ollama model memory | ~9GB VRAM steady | Same | Same; add auto-restart on OOM |
| Mineflayer reconnect | Manual | Exponential backoff reconnect | Same + persist "where was I" state |
| Log volume | Fine | Rotating file log in bot process | Same |

**Prompt caching:** Anthropic supports prompt caching on Haiku — pin the system prompt + long-term memory block for massive cost wins on long sessions. Design context slots so the *prefix* is stable (system + identity + running summary), with volatile content (world snapshot, trigger) at the end.

---

## 11. Build Order & Hard Dependencies

The dependency graph dictates a specific critical path:

```
┌─ A: Mineflayer bot connects to server (hello-world)
│       │
│       ▼
│  B: Action Registry (5–10 core actions: goto_player, goto_block,
│      chat, mine_block, place_block, follow, stop, look_at)
│       │
│       ▼
│  C: Event Queue + basic FSM (no LLM yet; scripted behavior)
│       │
│       ├───────────────────────────────────────────┐
│       ▼                                           ▼
│  D: Movement LLM (Ollama + Qwen              E: Personality LLM client
│     tool-calling over Action Registry)          (Haiku, no loop, just
│                                                 request/response)
│       │                                           │
│       └──────────────┬────────────────────────────┘
│                      ▼
│         F: Two-layer loop wired (minimal context: just chat history
│            + world snapshot). Real companion behavior emerges here.
│                      │
│                      ▼
│         G: Memory layer (SQLite + summaries + vector search)
│                      │
│                      ▼
│         H: Screenshot integration (desktopCapturer → Haiku)
│                      │
│                      ▼
│         I: Electron GUI shell (config, start/stop, log viewer)
│                      │
│                      ▼
│         J: Bot→UtilityProcess migration (if not done earlier)
│                      │
│                      ▼
│         K: electron-builder packaging (.exe / .app)
```

### Rationale
- **A→B→C** before any LLM. You want to verify the substrate works and actions are interruptible *without* the noise of LLM debugging. Script a dummy "walk to player, say hi" behavior first.
- **D and E parallelizable** once C exists; they're independent clients.
- **F is the integration moment** where the system first feels alive. Keep context minimal here — the payoff is seeing the loop work end-to-end, not perfect memory.
- **G (memory) before H (screenshots)** — memory has higher value per effort and screenshots compound complexity (image tokens, OS permissions, multi-monitor).
- **I (GUI) late** — headless-first means faster iteration. A CLI + config file is sufficient through F/G/H. Only build the Electron shell once the bot is actually fun.
- **J can be earlier** if you hit stability issues in dev; the IPC surface between bot and host is small enough that migration from standalone node to utilityProcess is mechanical.
- **K last** — packaging is annoying; do it once everything else is stable.

### Hard dependencies (cannot reorder)
- Action Registry before any LLM function calling.
- Event Queue/FSM before two-layer loop (otherwise the loop deadlocks on first concurrent event).
- Two-layer loop before memory (memory is useless if the loop doesn't run).
- Everything else before packaging.

### Soft dependencies (can reorder with small cost)
- GUI can come earlier for demo value; headless-first is a preference not a constraint.
- Screenshot can come before memory if visual debugging is valuable.
- UtilityProcess migration can happen any time after A.

### Early de-risking recommendations
1. Prototype the movement LLM loop against Ollama Qwen **in week 1** against 3 canned actions. This is the highest-risk subsystem — if the local 9B isn't reliably tool-calling, you need to know before building the rest.
2. Prototype screenshot → Haiku vision in parallel. OS window capture is brittle on macOS (ScreenCaptureKit permissions) and Windows (DWM quirks); knowing it works before depending on it saves weeks.
3. Stub personality LLM with a scripted responder during A–D to keep iteration fast and free.

---

## 12. Open Questions / Flags for Phase Research

- **Qwen 9B tool-calling reliability** — needs empirical validation; if weak, fallback options (Qwen2.5-Coder, Llama 3.1 with function-calling fine-tunes, or route tool-calls to Haiku at higher cost).
- **Screenshot capture on all OSes** — Electron `desktopCapturer` works cross-platform but macOS requires screen recording permission prompt; first-run UX needs design.
- **Anthropic prompt caching specifics** — verify cache-control placement for Haiku 3 in current SDK; cache-hit economics change the context budgeting in §4.
- **Chat interrupt UX** — if the bot is mid-action and the player says "stop", does the movement action cancel instantly or finish the current step? Design call, not pure architecture.
- **Memory privacy** — multi-player aware bot remembers things about non-owners; policy for what's remembered and how to forget.

---

## Sources

- [Voyager: An Open-Ended Embodied Agent with LLMs (paper)](https://arxiv.org/abs/2305.16291) — skill library, iterative prompting
- [Voyager GitHub (MineDojo)](https://github.com/MineDojo/Voyager) — reference implementation
- [Mindcraft (mindcraft-bots/mindcraft)](https://github.com/mindcraft-bots/mindcraft) — LLM + mineflayer patterns
- [AIRI Minecraft Agent (DeepWiki)](https://deepwiki.com/moeru-ai/airi/4.1-minecraft-agent) — action registry + cognitive engine plugin pattern
- [Mineflayer (PrismarineJS)](https://github.com/PrismarineJS/mineflayer) — bot API, plugin model
- [Electron utilityProcess docs](https://www.electronjs.org/docs/latest/api/utility-process) — preferred forking API
- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model) — main/renderer/utility boundaries
- [StateFlow: State-Driven LLM Workflows](https://arxiv.org/html/2403.11322v1) — state machine formalization for LLM tasks
- [Stately Agent (XState)](https://github.com/statelyai/agent) — practical FSM-driven LLM agents
- [12-factor-agents: Agentic Loop](https://deepwiki.com/humanlayer/12-factor-agents/2.1-the-agentic-loop) — event-sourced loop discipline
- [boundaryml: Event-driven agentic loops](https://boundaryml.com/podcast/2025-11-05-event-driven-agents) — event log over mutable state
- [Vellum: LLM Memory Management](https://www.vellum.ai/blog/how-should-i-manage-memory-for-my-llm-chatbot) — summary buffer patterns
- [Planner–Executor Framework](https://www.emergentmind.com/topics/planner-executor-framework) — two-layer agent formalization
- [Redis: AI Agent Architecture Patterns](https://redis.io/blog/ai-agent-architecture-patterns/) — planner/executor tradeoffs

### Confidence by claim

| Claim | Confidence | Basis |
|-------|------------|-------|
| utilityProcess over child_process.fork | HIGH | Electron official docs explicit |
| Event-queue FSM beats ad-hoc async | HIGH | Multiple papers + production frameworks |
| Closed action registry beats eval'd code | HIGH | AIRI, common wisdom; Voyager shows the opposite is hard |
| Summary-buffer hybrid memory | HIGH | Industry standard |
| Three-process Electron layout | HIGH | Matches Electron best-practices |
| 10s idle fallback is the right interval | LOW | Heuristic; needs playtesting |
| Prompt caching ROI at Sei's scale | MEDIUM | Anthropic docs support it; actual savings depend on session length |
| Qwen 9B tool-calling works reliably | LOW | Needs empirical test in phase 1 |
