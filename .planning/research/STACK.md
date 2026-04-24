# Technology Stack — Sei

**Project:** Sei (Minecraft AI companion with two-layer LLM architecture)
**Researched:** 2026-04-24
**Overall confidence:** MEDIUM-HIGH (verified against npm/official docs; some plugin versions inferred from npm metadata)

---

## Recommended Stack

### Runtime & Language

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | 20 LTS (or 22 LTS) | Runtime for bot + Electron main | Required by `@anthropic-ai/sdk`; current non-EOL LTS; matches Electron's bundled Node |
| TypeScript | 5.x | Type safety across bot/GUI boundary | Tool-calling schemas, IPC message shapes, and mineflayer's rich event API all benefit massively from types |

### Minecraft Bot Layer

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `mineflayer` | ^4.37.0 | Core bot API (world state, chat, inventory, movement) | Already in repo; PrismarineJS maintained; supports MC 1.8–1.21.11; 6.5k+ GitHub stars; active 2026 releases |
| `mineflayer-pathfinder` | ^2.4.5 | A* pathfinding with dynamic/composite goals | De facto standard; the `Movements` + `goals.*` API is what 99% of bot tutorials use; required for any "go to player" behavior |
| `mineflayer-pvp` | ^1.3.x | Combat target tracking, attack timing | Simplifies "defend owner" / "fight mob" requests from the movement LLM into one-call intents |
| `mineflayer-collectblock` | ^1.4.x | High-level "collect N of block X" | Wraps pathfinder + dig/place logic; perfect abstraction for movement-LLM tool calls |
| `mineflayer-armor-manager` | ^2.x | Auto-equips best armor on pickup | Removes a whole category of trivial decisions from the LLM — quality-of-life the user will expect |
| `prismarine-viewer` (optional, dev only) | latest | Browser-based world debug viewer | Useful during development to sanity-check pathfinder; do NOT ship in production bundle |

**NOT recommended:**
- `@nxg-org/mineflayer-pathfinder` / `@nxg-org/mineflayer-custom-pvp` — forks with advanced features (strafing, bow prediction) but lower maintenance velocity; stick with PrismarineJS-official plugins for a stable v1
- Writing pathfinding from scratch — mineflayer-pathfinder took years to tune; don't

### LLM Layer — Cloud (Personality)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@anthropic-ai/sdk` | ^0.90.0 | Claude Haiku 3 API client | Official SDK; current version as of April 2026; supports tool use, streaming, vision (needed for screenshot input) |

**Key API surface to use:**
- `client.messages.stream()` — stream tokens for responsiveness; don't block on full completion
- Content blocks with `type: "image"` + base64 — feed OS screenshots as vision context
- Tool use — optional here since personality LLM hands off to movement LLM via natural language, but could be used for structured "call small model" invocation

**NOT recommended:**
- `@ai-sdk/anthropic` (Vercel AI SDK) — nice abstraction, but adds a dep layer and obscures the native tool-use API; use the official SDK directly since you control both LLM calls
- Haiku 3.5 or Sonnet — the project explicitly specifies Haiku 3 for cost; keep it

### LLM Layer — Local (Movement/Function Calling)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `ollama` (JS client) | ^0.5.x | Node client for local Ollama daemon | Official library from the Ollama team; thin wrapper over Ollama's HTTP API; supports streaming + tool calls natively |
| Ollama daemon | latest stable | Local model runtime (user-installed) | Users install separately — do NOT bundle; detect presence at startup and fall back to API-only mode if absent |
| Model: `qwen2.5:7b` or `qwen2.5:14b` | — | Function-calling workhorse | Qwen 2.5 14B+ is the 2026 community recommendation for reliable tool-selection; 7B is viable on consumer hardware. PROJECT.md says "Qwen 9B" — closest official tag is `qwen2.5:7b` or `qwen2.5:14b`; pick based on hardware budget |

**Function-calling pattern with ollama-js:**
```ts
const response = await ollama.chat({
  model: 'qwen2.5:14b',
  messages: [...],
  tools: [{ type: 'function', function: { name, description, parameters } }]
});
// Read response.message.tool_calls[] and dispatch to mineflayer handlers
```

**NOT recommended:**
- LangChain.js — adds heavy abstraction; the project's two-layer design is already the orchestration, you don't need another framework on top
- `node-llama-cpp` (fully embedded models) — bundle size would balloon past any reasonable executable size; Ollama's "user installs daemon separately" story is cleaner
- Running the model in-process — blocks the event loop; Ollama's HTTP daemon gives you free process isolation

### Desktop Shell (GUI + Packaging)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `electron` | ^32.x (latest stable) | Desktop shell + process manager | Already chosen; ~8k Mac App Store apps, mature ecosystem |
| `electron-builder` | ^25.x | Cross-platform packaging (.exe, .dmg, .AppImage) | ~2.1M weekly npm downloads; de facto standard; handles code signing, auto-update, NSIS installers |
| `electron-vite` (or Vite + Electron plugin) | latest | Dev server + TS/JSX bundling | Fast HMR for the GUI; handles main/preload/renderer entry points cleanly |
| React (or Svelte) | 18+ / 4+ | GUI framework for config screen | Config UI is small — either works. React has more Electron boilerplates; Svelte ships smaller bundles. Pick based on team familiarity |
| `electron-store` | ^9.x | Small persistent config (API key, personality settings) | Wraps JSON on disk with migration support; perfect for settings — not for bot memory |

**Process architecture (recommended):**
- **Main process** — Electron lifecycle, window management, spawns bot
- **Renderer process** — React GUI (config, status, logs)
- **`utilityProcess`** (NOT `child_process.fork`) — runs the mineflayer bot; Electron's 2024+ recommended API, built on Chromium Services; gives Node.js + MessagePorts for structured IPC
- **IPC pattern** — `MessageChannelMain` between main and utilityProcess for structured bot events (chat, state, errors); `ipcMain`/`ipcRenderer` between main and renderer for GUI updates

**NOT recommended:**
- `child_process.spawn` / `fork` for the bot — works, but `utilityProcess` is the modern Electron-blessed path and handles packaging quirks better
- `electron-packager` — older, less featured than electron-builder; no auto-update story
- Tauri — smaller bundles, but forces a Rust core and rewrites all the Node.js bot glue; not worth it when Electron is already specified

### Screenshot Capture

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `screenshot-desktop` | ^1.15.3 | Full-desktop screenshot, cross-platform | Most downloaded, stable API, returns a Buffer directly (pipe to base64 → Anthropic vision) — simplest integration |

**Rationale & caveats:**
- Project explicitly notes screenshot capture is "brittle but desired" — start with the simplest working option
- Full desktop is fine for v1; window-specific capture (finding the Minecraft window) is a wart for later
- On macOS, triggers the Screen Recording permission prompt on first use — handle this in the Electron onboarding flow
- Feed to Anthropic as: `{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: buf.toString('base64') } }`

**NOT recommended (but considered):**
- `node-screenshots` (nashaofu) — native/zero-dep, faster, but less battle-tested; good fallback if screenshot-desktop proves insufficient
- `win-screenshot` — Windows-only, doesn't fit cross-platform goal
- Electron's `desktopCapturer` — returns a video stream meant for `<video>` tags; awkward for single-frame capture into a Buffer, and the renderer-process dependency complicates the utilityProcess architecture

### Memory & Persistence

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `better-sqlite3` | ^12.5.0 | Long-term memory (player relationships, world events, bot identity log) | Synchronous API = dead simple code paths; 2.3M weekly downloads; by far the fastest Node SQLite binding; transactional; handles the "remembers you across sessions" requirement cleanly |
| `electron-store` | ^9.x | Small settings blob (API key, personality config, model source toggle) | Already listed above; don't overload SQLite for 5 config fields |

**Schema recommendation (keep it flat for v1):**
- `players(uuid, name, first_seen, last_seen, relationship_notes TEXT)`
- `events(id, timestamp, type, player_uuid, summary TEXT)` — append-only
- `bot_identity(key, value)` — single-row settings (name, backstory, current_mood, etc.)

**Rationale for SQLite over JSON:**
- Memory will grow unbounded over months of play — JSON file rewrites get slow
- Structured queries ("what did player X do last session?") matter for personality LLM context injection
- `better-sqlite3` is synchronous, which is actually a feature here: no async plumbing for simple reads/writes
- Works offline, zero external services, fits the desktop app model

**electron-builder caveat:** `better-sqlite3` is a native module — must be rebuilt against Electron's Node ABI using `electron-rebuild` or electron-builder's postinstall hook. Budget one full day to get this working in the packaged build; it's a known sharp edge.

**NOT recommended:**
- `lowdb` — great for prototyping, but rewrites the entire JSON file on every mutation; will degrade as memory grows
- `sqlite3` (the original) — async-only, slower, needs more boilerplate; `better-sqlite3` supersedes it in 2026
- `pouchdb` / `rxdb` — sync/replication features you don't need; too heavy
- Vector DBs (Chroma, LanceDB) — not needed for v1; if semantic memory retrieval becomes a requirement later, revisit

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Bot framework | mineflayer | Direct minecraft-protocol | Would rewrite years of ecosystem work |
| Pathfinding | mineflayer-pathfinder | @nxg-org fork | Lower maintenance; stay on official |
| Anthropic client | @anthropic-ai/sdk | @ai-sdk/anthropic (Vercel) | Adds abstraction; want direct control |
| Local LLM runtime | Ollama + ollama-js | node-llama-cpp | Bundle bloat; no process isolation |
| LLM orchestration | Hand-rolled two-layer loop | LangChain.js | Over-engineered; your architecture IS the orchestration |
| Packaging | electron-builder | electron-packager / Tauri | Builder has auto-update; Tauri forces Rust rewrite |
| Bot subprocess | Electron utilityProcess | child_process.fork | utilityProcess is the modern Electron-blessed API |
| Screenshot | screenshot-desktop | node-screenshots, desktopCapturer | Simplest Buffer-out API |
| Persistence | better-sqlite3 | lowdb, sqlite3 | Perf + sync API beats JSON at scale |

---

## Installation (expected `package.json` deps)

```bash
# Core runtime
npm install mineflayer mineflayer-pathfinder mineflayer-pvp \
            mineflayer-collectblock mineflayer-armor-manager

# LLM layer
npm install @anthropic-ai/sdk ollama

# Desktop shell
npm install electron-store
npm install --save-dev electron electron-builder electron-vite

# Persistence & screenshots
npm install better-sqlite3 screenshot-desktop

# Post-install (native module rebuild for Electron)
npm install --save-dev @electron/rebuild
npx electron-rebuild
```

Ollama itself: **user-installed** (document in onboarding). Detect via HTTP ping to `http://localhost:11434` at startup.

---

## Stack-Level Risks to Flag for Roadmap

1. **Native module rebuild** — `better-sqlite3` + electron-builder is a known friction point. Plan a dedicated packaging spike early.
2. **Screenshot permissions** — macOS Screen Recording permission flow must be handled in onboarding or the vision feature silently fails.
3. **Ollama dependency detection** — Must gracefully fall back to API-only mode (personality LLM does everything) when Ollama isn't running. This is the #1 "it works on my machine" trap.
4. **utilityProcess IPC shape** — Design the bot↔main message protocol up front (typed events: `chat`, `state`, `error`, `command`). Retrofitting is painful.
5. **Qwen model size vs. user hardware** — 14B needs ~10GB VRAM; 7B runs on CPU. Consider letting the GUI detect and recommend.

---

## Sources

- [mineflayer on npm](https://www.npmjs.com/package/mineflayer)
- [PrismarineJS/mineflayer GitHub](https://github.com/PrismarineJS/mineflayer)
- [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)
- [mineflayer-pvp](https://github.com/PrismarineJS/mineflayer-pvp)
- [mineflayer-collectblock](https://www.npmjs.com/package/mineflayer-collectblock)
- [mineflayer-armor-manager](https://www.npmjs.com/package/mineflayer-armor-manager)
- [Mineflayer Plugin List](https://thedudefromci.github.io/Mineflayer-Plugin-List/)
- [ollama/ollama-js](https://github.com/ollama/ollama-js)
- [Ollama Tool Calling Docs](https://docs.ollama.com/capabilities/tool-calling)
- [Red Hat: Tool use with Node.js and Ollama](https://developers.redhat.com/blog/2024/09/10/quick-look-tool-usefunction-calling-nodejs-and-ollama)
- [Ollama Qwen docs](https://qwen.readthedocs.io/en/latest/run_locally/ollama.html)
- [@anthropic-ai/sdk on npm](https://www.npmjs.com/package/@anthropic-ai/sdk)
- [anthropic-sdk-typescript GitHub](https://github.com/anthropics/anthropic-sdk-typescript)
- [Electron utilityProcess API](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [How to Build and Distribute an Electron App in 2026](https://dev.to/raxxostudios/how-to-build-and-distribute-an-electron-desktop-app-in-2026-24nk)
- [screenshot-desktop on npm](https://www.npmjs.com/package/screenshot-desktop)
- [node-screenshots](https://github.com/nashaofu/node-screenshots)
- [better-sqlite3 vs lowdb npm trends](https://npmtrends.com/better-sqlite3-vs-electron-store-vs-lowdb-vs-nodb-vs-sqlite3)
- [better-sqlite3 + Electron guide](https://dev.to/arindam1997007/a-step-by-step-guide-to-integrating-better-sqlite3-with-electron-js-app-using-create-react-app-3k16)
