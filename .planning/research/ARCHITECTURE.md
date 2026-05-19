# Architecture Research — v1.0 Integration

**Domain:** Electron + mineflayer + Haiku — subsequent-milestone integration
**Researched:** 2026-05-19
**Confidence:** HIGH (read directly from source; not extrapolating from training data)

> Scope: this document does NOT redesign Sei. It maps each v1.0 capability onto
> the existing three-process Electron + utilityProcess + Haiku stack and names
> integration points by file path. The roadmapper consumes this to decide
> phase boundaries and dependencies. Every recommendation preserves the
> two invariants the codebase already enforces:
>   1. mineflayer + the brain loop run in **utilityProcess only**
>   2. the **closed action registry** — the LLM may only call Zod-typed
>      actions that were explicitly registered.

---

## 1. Existing Architecture (as-built, not as-planned)

```
┌─────────────────────────────────────────────────────────────────┐
│  RENDERER  (src/renderer/, contextIsolation, no Node)           │
│   React 19 · Zustand · screens/ + components/                   │
│   talks only to window.sei (preload bridge)                     │
└────────────┬────────────────────────────────────────────────────┘
             │ contextBridge ('sei')   ← src/preload/index.ts
             │ ipcMain.handle channels ← src/shared/ipc.ts IpcChannel
┌────────────▼────────────────────────────────────────────────────┐
│  MAIN  (src/main/, Node, Electron APIs)                         │
│   • index.ts — app lifecycle, BrowserWindow                     │
│   • ipc.ts — every ipcMain.handle (single registration site)    │
│   • botSupervisor.ts — utilityProcess.fork lifecycle, owns ONE  │
│     bot at a time, MessageChannelMain port to child             │
│   • apiKeyStore.ts — safeStorage encrypt/decrypt at             │
│     <userData>/api-key.bin                                      │
│   • characterStore.ts — <userData>/characters/<id>.json + index │
│   • configStore.ts — UserConfig (mc_username, preferred_name)   │
│   • skinServer.ts + skinStore.ts + customSkinLoader.ts +        │
│     fabricInstaller.ts + mcInstallScan.ts + wizard.ts —         │
│     skin pipeline for the HOST MC client                        │
│   • personaExpansion.ts — main-side Anthropic call to expand    │
│     persona.source → persona.expanded                           │
│   • lanWatcher.ts — LAN discovery, cached port handed to child  │
│   • paths.ts — single source for <userData>/* layout            │
└────────────┬────────────────────────────────────────────────────┘
             │ utilityProcess.fork + MessagePortMain
             │ init payload: { character, apiKey, lanPort, ... }
┌────────────▼────────────────────────────────────────────────────┐
│  UTILITYPROCESS  (src/bot/, Node, mineflayer)                   │
│   • index.js — dual-mode entry (parentPort vs CLI)              │
│   • config.js — ConfigSchema (Zod) for the runtime config       │
│   • registry.js — generic createRegistry() factory              │
│   • adapter/minecraft/ — mineflayer wiring                      │
│       - registry.js: createDefaultRegistry() — 19 Zod actions   │
│       - connect.js, behaviors/*, observers/*                    │
│       - prompts.js (capability paragraph, world primer, rules)  │
│   • brain/ — game-agnostic LLM loop                             │
│       - anthropicClient.js: SDK wrapper, cache_control stamping │
│       - orchestrator.js (102KB): event-sourced FSM, P0..P3      │
│         priority queue, single outstanding action token,        │
│         AbortController, iteration_cap, memory compaction       │
│       - loop.js: canonical messages[] + buildAnthropicPayload   │
│       - memory/{player,compactor,memoryLog}.js                  │
│       - storage/{atomicWrite,fileLock}.js                       │
└─────────────────────────────────────────────────────────────────┘
```

**Key existing primitives the integration plan reuses:**

- `src/bot/registry.js` — `createRegistry()` factory. Already supports late
  registration (no build-time freeze beyond `actions.has(name)` collision
  check). Hot-loadable IF guards are added.
- `src/bot/brain/anthropicClient.js` — the **only** Anthropic call site for
  the bot loop. Returns `{ toolUses, text, content, usage, stopReason }`. The
  `usage` field already exists and is logged but not surfaced to renderer.
- `src/bot/brain/orchestrator.js:266` — `createAnthropicClient(config)` is
  constructed once and threaded through `_anthropicOverride` for tests. This
  is the dependency-injection seam for the multi-provider abstraction.
- `src/main/botSupervisor.ts:374` — init payload is the ONE place where main
  hands the bot what it needs. New fields (auth token, proxy URL, provider
  config) get added here.
- `src/main/skinServer.ts` — proves the pattern of "main owns a localhost
  HTTP server, hands `baseUrl` to the bot via init payload, the OUT-OF-PROCESS
  consumer (here the host MC client) talks to it directly." This is the
  template for player-POV screenshot ingest.
- `src/main/wizard.ts` + `src/main/fabricInstaller.ts` + `mcInstallScan.ts` —
  prove the pattern of "main process inspects and mutates the host MC
  install." Mod-compatibility ingestion lives in this layer.

---

## 2. Feature-by-feature Integration

### 2.1 User Auth (email/pw + Google)

**Where state lives:**

- **Main process** owns the auth state. Reason: tokens go through safeStorage
  (already in `apiKeyStore.ts`); refresh + token expiry are background work
  that shouldn't restart the bot; renderer must not have Node APIs.
- Renderer holds a derived, read-only `AuthSession` (email, displayName,
  isPro, expiresAt) — never the raw token. Pushed via a new `auth:state`
  channel.
- UtilityProcess (bot) receives the **current access token** in its init
  payload and on refresh. The bot only ever uses the token as a Bearer for
  proxy-mode LLM calls; it does no auth I/O.

**Token storage:** reuse Electron `safeStorage` exactly as `apiKeyStore.ts`
does. Add `src/main/authStore.ts` that encrypts/persists a small JSON blob
`{ refreshToken, accessToken, expiresAt, provider }` at
`<userData>/auth.bin`. Do **not** introduce keytar — safeStorage is already
proven, signed/notarized, and works without an extra native module.

**Google OAuth:** use the standard Electron pattern — open the system
browser via `shell.openExternal` to an auth URL, run a one-shot localhost
loopback HTTP listener on a free port (mirror `skinServer.ts` lifecycle),
catch the code redirect, exchange server-side. Avoid embedding a
`BrowserWindow` for Google because Google blocks WebView/embedded auth.

**New files:**
- `src/main/authStore.ts` — safeStorage-backed token persistence (sibling of
  `apiKeyStore.ts`).
- `src/main/authService.ts` — sign-in, sign-out, refresh, OAuth loopback
  handler; emits `auth:state` to renderer.
- `src/shared/authSchema.ts` — `AuthSession`, `AuthState` Zod schemas.

**Modified files:**
- `src/shared/ipc.ts` — add `IpcChannel.auth.{signIn,signOut,getState,state}`.
- `src/main/ipc.ts` — register `auth:*` handlers (mirror `config:*` shape).
- `src/main/botSupervisor.ts:374` — extend init payload with
  `authToken?: string | null` and a token-refresh push over the existing
  MessagePort.
- `src/preload/index.ts` — expose `auth.*` on `window.sei`.
- `src/renderer/src/lib/stores/` — add `authStore` (Zustand) mirroring
  pattern of existing stores.

**Offline behavior:** auth is **optional** for local-only API mode. The
existing `apiKeyStore.ts` keeps working untouched; the renderer's onboarding
flow picks the branch (sign-in OR enter API key). Both branches converge on
"bot can fork."

---

### 2.2 Cloud Character Library

**Boundary — definition vs runtime memory:**

| Slice                          | Today              | After v1.0                          |
|--------------------------------|--------------------|-------------------------------------|
| `Character.persona.source`     | local JSON         | **cloud-authoritative**, cached locally |
| `Character.persona.expanded`   | local JSON (LLM-generated) | **cloud-authoritative**, cached locally |
| `Character.skin` + PNG bytes   | local              | **cloud-authoritative**, cached locally |
| `Character.portrait_image`     | local              | **cloud-authoritative**, cached locally |
| `Character.is_default`, `created`, `last_launched`, `playtime_ms` | local | **stays local** — these are per-user runtime stats |
| `<userData>/memory/<id>/MEMORY.md` (DIARY) | local | **stays local** — runtime memory NEVER syncs |
| `<userData>/memory/<id>/PLAYER.md` (OWNER) | local | **stays local** — per-user, never shared |

Sharing only ever exposes the **definition** slice (persona + skin +
portrait). Runtime memory files are untouched and continue to live under
`paths.memoryDir(id)`.

**Sync model: cache-on-demand, not background sync.**

- On sign-in, fetch the user's library index (`/api/characters?owner=me`)
  and write a lightweight `<userData>/cloud-index.json`.
- On "add to mine" or first launch of a character, download the definition
  and skin PNG into the **existing local format**: `characters/<id>.json` +
  `skins/<id>.png`. This means `characterStore.ts`, `skinStore.ts`,
  `skinServer.ts`, and `botSupervisor.ts` keep working with zero changes.
- On edit/publish, push the local JSON + PNG to the API.
- Offline: anything already pulled launches normally; cloud-only characters
  show a "not cached — needs network" state in the renderer.

**New files:**
- `src/main/cloudApi.ts` — typed fetch wrapper (Bearer auth from
  `authStore`, 15s timeout, retries via existing backoff patterns).
- `src/main/cloudCharacterSync.ts` — pull/push functions that translate
  between the cloud schema and local `CharacterSchema`.
- `src/shared/cloudCharacterSchema.ts` — Zod schemas for the API surface
  (Character DTO, ListResponse, SearchResponse).

**Modified files:**
- `src/shared/ipc.ts` — add `IpcChannel.cloudChars.{listMine,browse,search,
  publish,unpublish,pullToLocal,update}`.
- `src/main/ipc.ts` — register handlers, all gated on signed-in.
- `src/renderer/src/screens/` — add `BrowseScreen.tsx`, refactor
  `HomeScreen.tsx` into "Home (mine + recent)" + "Browse (cloud)" tabs.
- `src/main/characterStore.ts` — **no breaking changes**. The local store
  stays the canonical store at runtime. Sync sits *above* it.

**Why this design:** keeps the bot completely cloud-agnostic. The
utilityProcess never makes a sync call. If cloud goes down, summon still
works for any cached character.

---

### 2.3 AI Proxy + Usage Indicator

**Where the proxy client runs:** in the **utilityProcess**, same place as
the existing Anthropic SDK. Reason: the bot's `messages[]` is large and
hot-path; round-tripping through renderer would (a) cross IPC twice per
turn, (b) defeat prompt cache locality, (c) expose chat content to the
renderer process unnecessarily.

**Mechanism:** add a "proxy mode" alongside "personal-key mode" in the
existing `anthropicClient.js`. Both modes produce the same
`{ toolUses, text, content, usage, stopReason }` return shape. The only
difference is `baseURL` and the `Authorization` header (Bearer user-auth
token instead of `x-api-key`).

Anthropic's SDK supports custom `baseURL`; **no new client library needed.**

```js
// src/bot/brain/anthropicClient.js (modified)
const sdk = new Anthropic({
  apiKey: config.anthropic.api_key,         // ignored by proxy
  baseURL: config.anthropic.base_url,       // 'https://api.anthropic.com' or 'https://proxy.sei.gg/anthropic'
  defaultHeaders: config.anthropic.auth_header
    ? { Authorization: config.anthropic.auth_header } // 'Bearer <accessToken>'
    : undefined,
})
```

**Usage telemetry → renderer:**

- Anthropic responses already include `usage: {input_tokens, output_tokens,
  cache_creation_input_tokens, cache_read_input_tokens}`. The SDK call site
  at `anthropicClient.js:59` already captures this.
- For **personal-key mode**, the bot has no quota to report — renderer shows
  the simple "personal key" badge, no % bar.
- For **proxy mode**, the proxy server is the source of truth (it bills
  against your personal Anthropic key, so it's the only honest tally). The
  proxy returns a `x-sei-usage-pct` header on every response, OR an
  embedded `{ remaining_pct, plan }` JSON field on a wrapper envelope.
- The bot forwards each `usage_update` over the existing MessagePort to
  main, which fans it out via a new `usage:state` channel to renderer.

```
Bot turn → Anthropic proxy → response includes usage_pct
   │
   ├──► continue loop (existing path)
   └──► port.postMessage({ type: 'usage_update', remaining_pct, plan })
            │
            └──► main (botSupervisor.ts:330 port.on('message'))
                    │
                    └──► webContents.send('usage:state', payload)
                            │
                            └──► renderer Zustand store ── % bar above settings icon
```

**Why server-driven percentage (not client-tallied tokens):** matches the
"friendly % bar, no token counts" requirement, lets the server adjust quota
mid-month without an app update, and is robust to abort/retry double-counts
that a client-side tally cannot resolve.

**Billing flow (in-app checkout):** main process opens the system browser
to a Stripe Checkout URL; webhook hits the proxy server; on next bot turn
the new entitlement reflects in `remaining_pct`. No special UI plumbing
needed beyond a "Manage subscription" button in `SettingsScreen.tsx`.

**New files:**
- `src/main/billingService.ts` — open Stripe Checkout via `shell.openExternal`,
  poll `/api/me/billing` on focus to refresh `isPro`.

**Modified files:**
- `src/bot/brain/anthropicClient.js` — accept `base_url` + `auth_header` from
  config; forward usage to parentPort.
- `src/bot/index.js` — extend init payload handling to include
  `proxyConfig: { baseUrl, authToken } | null`.
- `src/main/botSupervisor.ts:374` — populate `proxyConfig` from `authStore`
  + user preference (`useProxy` flag in `UserConfig`).
- `src/shared/characterSchema.ts:UserConfigSchema` — add
  `use_proxy: z.boolean().default(false)`.
- `src/shared/ipc.ts` — add `usage:state` push channel.

---

### 2.4 Multi-Provider LLM Abstraction

**The invariant to preserve:** `orchestrator.js` calls
`anthropic.call({ systemBlocks, tools, messages, signal, timeoutMs, maxTokens })`
and gets `{ toolUses, text, content, usage, stopReason }`. As long as we
keep that contract, every other invariant (closed action registry,
event-sourced FSM, iteration_cap, AbortController) holds untouched.

**Design: a `LlmProvider` interface, dependency-injected.**

```js
// src/bot/brain/llm/provider.js  (NEW)
/**
 * @typedef {Object} LlmProvider
 * @property {(req) => Promise<LlmResponse>} call
 * @property {(staticBlocks: string[], tools: Tool[]) => SystemBlock[]} buildCachedSystem
 * @property {string} model
 * @property {LlmCapabilities} capabilities
 *
 * @typedef {Object} LlmCapabilities
 * @property {boolean} promptCache       // Anthropic ephemeral, OpenAI prompt_cache_key, etc.
 * @property {boolean} toolUse           // every modern provider — sanity check
 * @property {boolean} vision            // gates the screenshot+visualize feature
 * @property {boolean} thinking          // Anthropic extended thinking, o1/o3 reasoning effort
 * @property {number}  maxContextTokens
 */
```

**One concrete provider per backend:**
- `src/bot/brain/llm/anthropicProvider.js` — rename of today's `anthropicClient.js`
- `src/bot/brain/llm/openaiProvider.js` — OpenAI Responses API or Chat Completions w/ tools
- `src/bot/brain/llm/geminiProvider.js` — Gemini function calling
- `src/bot/brain/llm/grokProvider.js` — xAI (OpenAI-compatible, can extend openaiProvider)
- `src/bot/brain/llm/openrouterProvider.js` — OpenRouter (OpenAI-compatible)
- `src/bot/brain/llm/localOpenAIProvider.js` — Ollama / vLLM / LM Studio (OpenAI-compatible base_url)

Each adapter is responsible for translating Sei's canonical content-block
shape (`{type:'text'|'tool_use'|'tool_result',...}` from `loop.js`) into and
out of the provider's native message shape — this is the only piece that
genuinely differs. The brain's `messages[]` stays Anthropic-shaped because
it's already battle-tested and Anthropic's shape is the most expressive.

**Caching per provider:**
- Anthropic — keep the existing `cache_control: {type:'ephemeral'}` stamping
  on the last tool block (`stampLastToolCacheControl`).
- OpenAI — set `prompt_cache_key` to a stable hash of the system+tools
  prefix.
- Gemini — `cachedContent` (separate API call to create the cache, then
  reference by name).
- OpenRouter / Grok — provider-specific; pass-through whatever the
  underlying model supports.
- Local — no-op (`promptCache: false`).

The capability flag drives which strategy `buildCachedSystem` uses; the
orchestrator never branches on provider.

**Closed action registry preservation:** every provider's tool-call result
gets normalized to `{ id, name, input }` (the shape `anthropicClient.js`
already returns). The orchestrator then routes through
`registry.execute(name, args, bot, config)` exactly as today. **No provider
ever sees the registry directly.** If a provider returns a tool call by an
unknown name, `registry.execute` already throws — invariant preserved.

**Provider selection:** `UserConfig.provider` already exists as
`z.enum(['anthropic'])` — extend it to the full list. Onboarding model
picker (list, not grid) lives in `src/renderer/src/screens/OnboardingScreen.tsx`.

**New files:**
- `src/bot/brain/llm/provider.js` — interface + factory
- `src/bot/brain/llm/{anthropic,openai,gemini,grok,openrouter,localOpenAI}Provider.js`
- `src/bot/brain/llm/normalize.js` — content-block ↔ provider-shape translation

**Modified files:**
- `src/bot/brain/orchestrator.js:266` — `createAnthropicClient(config)` →
  `createLlmProvider(config)`. The `_anthropicOverride` seam already
  generalizes to `_providerOverride` for the harness.
- `src/bot/brain/anthropicClient.js` — moves under `llm/anthropicProvider.js`;
  function exports preserved.
- `src/shared/characterSchema.ts:UserConfigSchema.provider` — widen enum.

---

### 2.5 Player-POV Screenshots

**The fundamental problem:** the headless mineflayer bot has no rendered
view. Screenshots must come from the **human player's running Minecraft
client**. The bot is in utilityProcess; the player's MC client is a
separate process (often on the same machine; sometimes not, if playing on a
LAN host).

**The three options the question raises, evaluated:**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| A. Companion Fabric mod → localhost socket → utilityProcess | Same-machine: native, low latency, no relay infra. Reuses existing Fabric wizard (`src/main/fabricInstaller.ts`). Mod can also expose 16-block + LOS gating server-side. | Doesn't work if player runs MC on a different machine than Sei (rare but real for LAN play). | **Primary path.** |
| B. Companion mod → relay server → bot polls | Works across machines. | Adds backend infra, latency, privacy concern (player's frames hit a server). | Defer — overkill for v1. |
| C. Out-of-band screen capture from Electron | No mod required. | macOS screen-recording permission UX is brutal; can't tell which window is MC; multi-monitor failures; only same-machine. Already flagged as "v2, brittle" in `.planning/PROJECT.md`. | Reject for v1. |

**Recommended architecture (option A):**

```
┌─────────────────────────┐         ┌─────────────────────────┐
│ Host MC client          │         │ Sei (utilityProcess)    │
│  + Sei Companion Mod    │  PNG    │                         │
│    (Fabric)             │ ─────►  │  screenshotIngest.js    │
│  • observes camera pos  │  WS     │  • buffers frames       │
│  • does 16-block LOS    │         │  • exposes getLatest()  │
│  • POSTs png+meta to    │         │                         │
│    ws://127.0.0.1:PORT  │         │ Brain calls visualize → │
└─────────────────────────┘         │ getLatest() → vision-   │
                                    │ capable provider        │
                                    └─────────────────────────┘
```

**Where it lives:**

- **Sei Companion Mod** — a new Fabric mod (deliverable beyond TypeScript).
  Lives in a sibling repo OR `mods/sei-companion/` in this repo. The
  existing `src/main/customSkinLoader.ts` proves we already ship mod
  artifacts via the wizard; reuse that distribution pipeline.
- **Server endpoint** — the utilityProcess hosts a tiny WebSocket on
  `127.0.0.1` (bound to ephemeral port at fork time). Mineflayer is fine
  with us having an extra server; this is just an inbound socket. The port
  is **passed to the mod** via the existing wizard config file (the same
  one `customSkinLoader.ts` writes), so the mod knows where to send frames.
- **Gating** — the mod owns the 16-block-radius + line-of-sight check
  because it has the player's exact camera pose. The bot trusts the mod's
  pre-filter but re-validates against its own world state (bot can
  cross-check via `bot.entity.position` and existing observers) before
  feeding the frame to a VLM call.
- **Cross-machine fallback** — if the wizard detects the MC install is on
  a different host than Sei (rare; explicitly flagged), the screenshot
  feature simply degrades gracefully (renderer shows "vision not available
  — host MC client must be on this machine"). Defer remote-relay to v2.

**New files:**
- `src/bot/brain/vision/screenshotIngest.js` — WS server, frame buffer with
  TTL (≤10s old frames discarded).
- `src/bot/adapter/minecraft/behaviors/visualize.js` — Zod action handler
  that calls `screenshotIngest.getLatest()`, feeds the PNG into the
  current provider's vision channel via `provider.call({...image_block})`,
  and returns the textual description as the tool_result.
- `src/main/companionModInstaller.ts` — mirrors `customSkinLoader.ts` for
  the Sei companion mod jar. Reuses `wizard.ts`.
- `mods/sei-companion/` (or sibling repo) — Fabric mod source.

**Modified files:**
- `src/bot/adapter/minecraft/registry.js` — register `visualize` as a new
  Zod action behind a `capabilities.vision` capability check (no-op
  registration when active provider lacks vision).
- `src/bot/brain/orchestrator.js` — add an idle-tick hook that auto-pulls a
  frame for VLM-capable providers (P3 idle priority; gated by 10s debounce
  to avoid spamming the mod).
- `src/main/wizard.ts` — extend install pipeline to drop the companion mod
  jar alongside CustomSkinLoader; extend wizard-state schema with
  `companionModInstalled` per install.

**Why a new Zod action and not a side-channel:** preserves the closed
action registry invariant. `visualize` is explicit — the LLM asks for a
view, the registry validates input, the handler returns a `tool_result`.
Auto-idle is a separate orchestrator-internal feature that injects a
synthetic "you just saw this" event-text into the next snapshot, not a
tool call — also preserves the invariant.

---

### 2.6 Mod Adapter Ingestion Pipeline → Hot-Loaded Zod Actions

**This is the only feature that genuinely tensions the "closed action
registry" invariant. Resolve it explicitly.**

**The invariant clarified:**
- "Closed" means **the LLM cannot register or invent actions**. The LLM may
  only call actions in the registry at the time of the call.
- It does **not** mean "static at build time." Today's
  `createDefaultRegistry()` is a runtime construction. The registry is a
  Map populated at bot-start.
- Therefore: **registering more actions before the bot starts (or between
  bot sessions) does NOT violate the invariant.** What WOULD violate it is
  letting the in-flight LLM loop mutate the registry, or letting LLM output
  determine what gets registered without human-in-the-loop validation.

**Pipeline design:**

```
1. Mod scan         (main, src/main/modAdapterScan.ts)
     └─ inspect <mcDir>/mods/ → enumerate jars, version, modid
2. Diff vs baseline (main, src/main/modAdapterDiff.ts)
     └─ baseline = vanilla 1.21.1 item/keybind manifest (bundled JSON)
     └─ output: new items, removed items, changed keybinds, modded blocks
3. LLM generation   (main, src/main/modAdapterGenerator.ts)
     └─ feed diff into Haiku; ask for:
          (a) a knowledge.md text summary appended to system prompt
          (b) ZERO OR MORE action proposals as JSON: {name, description,
              zodSchemaSrc, handlerSrc}
4. Validation gate  (main, src/main/modAdapterValidator.ts)
     └─ static analysis on handlerSrc:
        • parse with acorn; reject if AST contains require/import,
          process.*, fs.*, child_process, eval, Function, network APIs
        • whitelist only: bot.<method>, args.<x>, return string|object
        • zodSchemaSrc must parse and yield a z.ZodObject
5. Human review     (renderer, ModAdapterReviewScreen.tsx)
     └─ user sees each proposed action, can accept / reject / edit
6. Persist          (main, <userData>/mod-adapters/<modId>.json)
7. Load on summon   (bot, src/bot/adapter/minecraft/registry.js)
     └─ after createDefaultRegistry(), iterate accepted adapters and call
        registry.register(...) for each
```

**Hot-loading vs restart:** **require a bot restart** to pick up new
actions. The registry is read at fork time; a re-fork is cheap (the
supervisor already does it for character switching). Avoid in-flight
registry mutation entirely — it's not worth the testing burden and the
user's mental model is "I added a mod, I restart the bot."

**Safety architecture for generated handlers:**
- Generated handlers run in the utilityProcess (already isolated from
  renderer). They have access to `bot`, `args`, `config` — no fs or
  network. The static-analysis gate enforces this. Anything that fails
  the AST whitelist is rejected before the user even sees it.
- Each adapter ships as a small JSON manifest, NOT a `.js` file. The
  validator compiles `zodSchemaSrc` + `handlerSrc` via `new Function(...)`
  inside a closure that only exposes the whitelist. This is the same
  pattern Cloudflare Workers / Vercel use for untrusted JS, scaled down.
- Each adapter is **versioned and signed** with a hash so a user who shares
  a config can opt-in trust the same adapter set.

**New files:**
- `src/main/modAdapterScan.ts`, `modAdapterDiff.ts`, `modAdapterGenerator.ts`,
  `modAdapterValidator.ts`, `modAdapterStore.ts`
- `src/shared/modAdapterSchema.ts` — Zod for the manifest format
- `src/bot/adapter/minecraft/loadModAdapters.js` — read `<userData>/mod-adapters/`
  on bot start, hand to registry
- `src/renderer/src/screens/ModAdapterReviewScreen.tsx`
- `resources/mc-baseline/1.21.1-items.json` — bundled vanilla manifest

**Modified files:**
- `src/bot/adapter/minecraft/registry.js:createDefaultRegistry()` — accept
  optional `extraAdapters` arg; iterate and `register(...)` after the
  built-in 19 actions.
- `src/bot/index.js` — load mod adapters from disk after init payload,
  pass to `createDefaultRegistry({ extraAdapters })`.
- `src/main/botSupervisor.ts:374` — extend init payload with the path to
  the accepted-adapters directory (so the bot reads its own manifest list
  without main needing to ship handler source over the port).

---

## 3. Process Boundary Audit

| Concern | Process | File path |
|---|---|---|
| Mineflayer instance | **utilityProcess only** | `src/bot/adapter/minecraft/connect.js` |
| Anthropic SDK / LLM providers | utilityProcess (bot loop) **and** main (persona expansion) | `src/bot/brain/anthropicClient.js`, `src/main/personaExpansion.ts` |
| safeStorage (apiKey, authToken) | **main only** | `src/main/apiKeyStore.ts`, new `authStore.ts` |
| Cloud API (character library, billing) | **main only** | new `cloudApi.ts`, `billingService.ts` |
| Stripe checkout, OAuth loopback | **main only** | new `billingService.ts`, `authService.ts` |
| Screenshot WS server | **utilityProcess** | new `src/bot/brain/vision/screenshotIngest.js` |
| Skin server (existing) | main | `src/main/skinServer.ts` |
| Mod adapter generation (LLM call + validator) | **main only** | new `modAdapterGenerator.ts` |
| Mod adapter execution (sandboxed handler) | utilityProcess | new `loadModAdapters.js` |
| All renderer code | renderer (contextIsolation) | `src/renderer/` |

**Invariant: anything that calls `mineflayer.createBot()` or imports from
`mineflayer-pathfinder` stays in utilityProcess.** New features (auth, cloud,
billing, mod-gen LLM, OAuth) never touch the bot process — they go through
main and feed the bot via init payload extensions.

---

## 4. Data Flow Diagrams

### 4.1 Sign-in → Cloud Character → Summon

```
Renderer (Browse)         Main                            Cloud API
       │                    │                                │
       │  cloudChars:browse │                                │
       ├───────────────────►│                                │
       │                    │  GET /characters?q=...         │
       │                    ├───────────────────────────────►│
       │  list              │  list                          │
       │◄───────────────────┤◄───────────────────────────────┤
       │                                                     │
       │  cloudChars:pullToLocal(id)                         │
       ├───────────────────►│                                │
       │                    │  GET /characters/:id           │
       │                    ├───────────────────────────────►│
       │                    │◄───── definition + skin PNG ───┤
       │                    │                                │
       │                    │ writes characters/<id>.json   │
       │                    │ writes skins/<id>.png         │
       │  ok                │                                │
       │◄───────────────────┤
       │
       │  bot:summon(id)                  (existing flow, untouched)
       ├───────────────────►supervisor──fork──►utilityProcess
```

### 4.2 Bot Turn → Proxy Provider → Usage Bar

```
utilityProcess                    main                        renderer
     │                              │                            │
     │ provider.call(req)           │                            │
     ├───► proxy.sei.gg/anthropic   │                            │
     │◄───response + usage_pct      │                            │
     │                              │                            │
     │ port.postMessage(            │                            │
     │   {type:'usage_update',      │                            │
     │    remaining_pct, plan})     │                            │
     ├─────────────────────────────►│                            │
     │                              │ webContents.send(          │
     │                              │   'usage:state', payload)  │
     │                              ├───────────────────────────►│
     │                              │                            │ Zustand
     │                              │                            │ → % bar
```

### 4.3 Player-POV Screenshot

```
Host MC client            utilityProcess                Brain loop
  + Sei mod
       │                       │                            │
       │ player presses key /  │                            │
       │ idle auto-trigger     │                            │
       │ runs LOS gate         │                            │
       │ POST ws://...         │                            │
       ├──────────────────────►│ screenshotIngest           │
       │                       │   .pushFrame(png, meta)    │
       │                       │                            │
       │                       │ visualize action requested │
       │                       │◄───────────────────────────┤
       │                       │ ingest.getLatest() →       │
       │                       │ provider.call({image_block})│
       │                       │ → tool_result text         │
       │                       ├───────────────────────────►│
```

---

## 5. Build Order (Dependency-Driven)

```
Phase A — Auth foundation
   authStore.ts → authService.ts → ipc/preload/renderer auth surface
   (No other feature depends on a specific provider for sign-in
    semantics; can ship before cloud library by gating cloud UI on
    "signed in".)

Phase B — Cloud character library
   cloudApi.ts → cloudCharacterSync.ts → BrowseScreen
   Requires: Auth (Bearer token)
   Independent of: proxy, providers, vision, mod-gen

Phase C — Multi-provider abstraction
   provider.js interface + anthropicProvider refactor (no functional change)
   → add openai/gemini/grok/openrouter/local providers one by one
   Requires: nothing (pure refactor in-process)
   Unblocks: vision, proxy mode (proxy is just another Anthropic baseURL)

Phase D — AI proxy + usage indicator
   billingService.ts → proxyConfig wiring → usage:state channel → % bar
   Requires: Auth (Bearer token), provider abstraction (proxy is an
             anthropic-provider variant — but trivially shippable before
             the full multi-provider work lands; just adds baseURL +
             defaultHeaders to the existing anthropicClient).
   Independent of: cloud library, vision

Phase E — Player-POV vision
   companionModInstaller.ts + mod jar + screenshotIngest.js +
   visualize action
   Requires: provider abstraction with capabilities.vision flag
             (so visualize registers only when active provider supports it)
   Independent of: cloud library, auth

Phase F — Mod adapter ingestion
   modAdapterScan/Diff/Generator/Validator + ModAdapterReviewScreen
   Requires: nothing strictly, but benefits from the multi-provider
             abstraction (so the generator LLM call uses whichever
             provider the user prefers) and from vision (a VLM can read
             screenshots of mod GUIs to better infer keybinds).
   Last in queue — touches the registry invariant; safest to ship after
   the abstraction layer is stable.
```

**Critical path:** **Auth → Proxy → Provider abstraction → Vision** is the
revenue-relevant path. **Cloud library** and **mod ingestion** are
parallelizable with the critical path once Auth lands.

**Cheap early win:** Phase D (proxy) can ship as a *baseURL override* in
the existing `anthropicClient.js` BEFORE the full Phase C refactor; the
refactor then absorbs proxy mode as a special case. This decouples revenue
from the larger abstraction work.

---

## 6. Anti-Patterns to Avoid

### A.1 Letting the renderer hold the access token
**Wrong:** convenient for direct fetch() from React.
**Why:** renderer has contextIsolation and no Node — but token still leaks
via DevTools / extensions / future XSS. Today every secret lives in main.
**Do:** main owns tokens; renderer gets a derived `AuthSession` push only.

### A.2 Cloud-syncing runtime memory
**Wrong:** "let users keep their character's memory across machines."
**Why:** memory contains personal chat content + persona drift; it's per-
device per-user runtime state, not part of the shareable definition. Worse,
two devices syncing the same character race on compaction.
**Do:** sync the **definition** only. Document it. Offer "export memory"
later if asked.

### A.3 Bot process making HTTPS calls for non-LLM purposes
**Wrong:** "bot can hit the proxy for usage stats since it's already
talking to the proxy for LLM calls."
**Why:** breaks the rule that bot has one job (run the loop). Auth refresh,
billing webhooks, cloud library — all of those should live in main.
**Do:** usage piggybacks on the LLM response that the bot is making anyway.
Everything else stays in main.

### A.4 Hot-loading mod adapters inside an in-flight loop
**Wrong:** "the user added a mod, register the new action mid-session."
**Why:** breaks the locked-tool-prefix that anthropic prompt-cache assumes;
risks an in-flight loop calling an action whose handler was just replaced.
**Do:** require a bot restart after accepting a new adapter.

### A.5 Generic "LLM provider" that takes raw prompts as strings
**Wrong:** flatten messages to a single string per provider call.
**Why:** loses the structured `content[]` (tool_use, tool_result, image
blocks); makes prompt caching impossible; conflates personality LLM with
provider LLM.
**Do:** keep `messages[]` Anthropic-shaped (already battle-tested in
`loop.js`); each provider adapter translates that shape into and out of
its native format.

---

## 7. Integration Summary — New vs Modified

### New files (by feature)

| Feature | New file(s) |
|---|---|
| Auth | `src/main/authStore.ts`, `authService.ts`; `src/shared/authSchema.ts` |
| Cloud library | `src/main/cloudApi.ts`, `cloudCharacterSync.ts`; `src/shared/cloudCharacterSchema.ts`; renderer `BrowseScreen.tsx` |
| Proxy | `src/main/billingService.ts` (the proxy itself is server-side, out of repo) |
| Providers | `src/bot/brain/llm/provider.js`, `normalize.js`, `{anthropic,openai,gemini,grok,openrouter,localOpenAI}Provider.js` |
| Vision | `src/bot/brain/vision/screenshotIngest.js`; `src/bot/adapter/minecraft/behaviors/visualize.js`; `src/main/companionModInstaller.ts`; `mods/sei-companion/` |
| Mod ingest | `src/main/modAdapterScan.ts`, `modAdapterDiff.ts`, `modAdapterGenerator.ts`, `modAdapterValidator.ts`, `modAdapterStore.ts`; `src/bot/adapter/minecraft/loadModAdapters.js`; renderer `ModAdapterReviewScreen.tsx`; `resources/mc-baseline/1.21.1-items.json` |

### Modified files (every feature passes through these)

| File | Modification |
|---|---|
| `src/shared/ipc.ts` | Add `IpcChannel.auth`, `cloudChars`, `usage`, `modAdapter`; widen `UserConfigSchema.provider`; new push channels for `auth:state`, `usage:state` |
| `src/preload/index.ts` | Expose new `auth.*`, `cloudChars.*`, `modAdapter.*` namespaces under `window.sei` |
| `src/main/ipc.ts` | Register new handlers; gate cloud handlers on `authStore.isSignedIn()` |
| `src/main/botSupervisor.ts:374` | Extend init payload: `{ authToken, proxyConfig, modAdaptersDir, vlmCapable }` |
| `src/bot/index.js` | Read extended init payload; load mod adapters from disk; pass `proxyConfig` to provider factory |
| `src/bot/brain/anthropicClient.js` | Renamed under `llm/`; add `base_url` + `auth_header` config; forward `usage` event to parentPort |
| `src/bot/brain/orchestrator.js:266` | `createAnthropicClient(config)` → `createLlmProvider(config)`; the `_anthropicOverride` test seam generalizes to `_providerOverride` |
| `src/bot/adapter/minecraft/registry.js` | `createDefaultRegistry({ extraAdapters })`; register `visualize` when `provider.capabilities.vision` |
| `src/shared/characterSchema.ts` | Widen `UserConfigSchema.provider` enum; add `use_proxy` boolean |
| `src/renderer/src/screens/OnboardingScreen.tsx` | Model picker grid → list; add proxy-vs-personal-key branch |
| `src/renderer/src/screens/SettingsScreen.tsx` | Sign-in section; manage subscription; provider picker; usage bar anchor |

---

## 8. Open Questions for Roadmapper

1. **Mod jar distribution:** ship the Sei companion mod inside the .dmg/.exe
   (like CustomSkinLoader today) or fetch on demand from sei.gg? The
   existing wizard pattern points to the former.
2. **Proxy backend:** out of scope for this research; assumed to exist as a
   simple Cloudflare Worker / Node server that forwards to Anthropic and
   tallies usage. Architecturally only the response-header contract
   matters to the client.
3. **Local OpenAI-compatible discovery:** does the onboarding picker
   probe `127.0.0.1:11434` (Ollama) and `127.0.0.1:1234` (LM Studio)
   automatically, or require the user to enter a base URL? Probing is
   friendlier but slows onboarding.
4. **Mod adapter sharing:** v1 = per-user only. Sharing accepted adapters
   between users is a v2 question — would extend the cloud library DTO.

---

*Architecture integration plan for: Sei v1.0 commercializable MVP*
*Researched: 2026-05-19 — source-read from the v0.1.1 release codebase*
