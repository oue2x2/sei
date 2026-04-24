# Feature Landscape

**Domain:** Minecraft AI companion bot (mineflayer + LLM, non-technical end users)
**Researched:** 2026-04-24
**Confidence:** MEDIUM-HIGH (ecosystem well-documented via Mindcraft, Voyager, AI-Player, Player2; memory patterns cross-referenced with general AI companion literature)

## Competitive Landscape (Reference Points)

| Project | What It Is | Notable For |
|---------|------------|-------------|
| **Mindcraft / Mindcraft-CE** | Node.js + Mineflayer + LLM framework ("Andy" bot) | JSON profile personality config, parameterized `!command` style tool use, multi-LLM provider support, in-context example retrieval |
| **Voyager (MineDojo)** | Research agent, GPT-4 driven | Automatic curriculum, ever-growing skill library (code stored & reused), iterative self-verification |
| **AI-Player (shasankp000)** | Fabric mod, "second player" | RAG over Minecraft wiki to reduce hallucination, high-level instruction decomposition, OpenAI-compatible provider support |
| **Player2 AI NPC** | Commercial platform + MC mod | Natural-language commands, voice, personality/appearance packs, managed service |
| **AI_Paul (SheppCrafd)** | Hobbyist mineflayer + Ollama | Local LLaMA, TTS voice, conversation memory, dynamic code generation |
| **Iron AI / ChatClef / AI Chat Mod** | Mod-level chat wrappers | System-prompt personality, passive chat only (no autonomy) |

Sei's niche: **personality-first companion** (not a task automator like Mindcraft/Voyager, not a passive chat mod like AI Chat), **non-technical packaging** (Electron vs. CLI config files), and **two-layer LLM split** (cloud personality + local movement) which none of the above do cleanly.

---

## Table Stakes

Users in 2026 have been conditioned by Mindcraft, AI-Player, and Player2. Absence of these is a dealbreaker.

### Bot Behavior

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Follow a player | Core "companion" expectation | Low | mineflayer-pathfinder `goalFollow`; must handle teleport/lost-line-of-sight |
| Respond to in-game chat directed at it | Baseline for any chat bot | Low | Name-mention trigger + proximity-based addressing |
| Come when called ("come here", "follow me") | Every comparable project has this | Low | Maps to movement LLM |
| Look at the speaker when talking | Feels alive vs. dead-eyed | Low | `bot.lookAt(player.position.offset(0,1.6,0))` |
| Stop / halt command | Safety escape hatch — if bot is stuck or spamming | Low | Must interrupt both LLM loops |
| Path around obstacles without infinite-loop hang | Documented pain in mineflayer issues (#222) | Medium | Pathfinder timeout + escalation to personality LLM |
| Avoid walking off cliffs / into lava near player | Basic survival | Low-Med | Pathfinder config + mob/hazard awareness |
| React to being attacked | Expected — silence when hit feels broken | Low | `entityHurt` event → personality LLM |
| Eat when hungry (if food available) | Expected — else bot dies | Low | Autonomous micro-behavior, not LLM-driven |
| Sleep when asked / at night | Multiplayer etiquette | Low | `bot.sleep(bed)` |

### Personality

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Name | Identity anchor | Trivial | |
| Backstory / description prompt | Every competitor supports this | Trivial | Injected into system prompt |
| Tone/trait config (cheerful, grumpy, terse) | Differentiates bots from each other | Low | Preset traits + free-text |
| Consistent voice across sessions | Breaks immersion if personality shifts | Medium | Requires stable system prompt + memory of prior style |
| Owner/primary-player awareness | "This is MY bot" feeling | Low | Config field + address-specially in prompts |

### Memory

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Remember current conversation (session) | Below this is unusable | Low | Rolling context window |
| Remember primary owner across restarts | Minimum persistence | Low | Flat file / SQLite |
| Remember recent events ("we fought a zombie yesterday") | Mindcraft/Nomi-style continuity is now expected | Medium | Summarization + persistent store |
| Forget gracefully (no infinite context bloat) | Else cost/latency explodes | Medium | Summarize + evict; RAG for recall |

### GUI / UX (Electron)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Enter API key in a field (not a .env file) | Non-technical users cannot edit .env | Low | Store in OS keychain or userData |
| Enter server IP + port + bot username | Baseline connection config | Low | Validate before launch |
| Enter personality (name, backstory, traits) via form | The "point" of the Electron wrapper | Low | Form → writes profile JSON |
| Start / Stop buttons with status indicator | Obvious for a desktop app | Low | Process lifecycle + status light |
| Live chat/log window | Users want to see what the bot is doing | Medium | Stream stdout + mineflayer chat events |
| Error messages in plain English | "ECONNREFUSED" is not acceptable for this audience | Medium | Error translation layer |
| Auto-reconnect on server disconnect | MC servers restart, Wi-Fi drops | Low | mineflayer reconnect loop |
| Offline/online account support (Microsoft auth) | 2026 MC is Microsoft-auth by default | Medium | prismarine-auth flow; handle in Electron window |
| Version selector (MC 1.20 / 1.21 / etc.) | Servers run different versions | Low | mineflayer `version` option |
| Ollama status check + install hint | Bot fails silently otherwise | Low-Med | Ping `localhost:11434`, show setup link |

---

## Differentiators

Sei-specific competitive advantages. These are where to invest.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Two-layer LLM with visual context (screenshot)** | No competitor feeds OS screenshot to personality LLM — enables commentary on what's actually on screen ("nice build!") rather than just block data | High | Brittle (OS window capture), but unique; Haiku 3.5+ is vision-capable |
| **Event-driven personality loop (not polling)** | Bot reacts *in the moment* to being attacked, new player joining, inventory change — not on a fixed tick. Feels reactive, not robotic | Medium | Already in spec; the 10s idle fallback is the right pattern |
| **Proactive idle commentary** | Bot speaks unprompted about surroundings. Mindcraft/AI-Player are reactive-only; this is what makes Sei feel *alive* | Medium | Rate-limit aggressively to avoid spam |
| **Relationship memory per player** | Remembers not just owner but *each* player's interactions, preferences, inside jokes — multiplayer-aware companion | Medium-High | Per-player memory files keyed by UUID (not username — accounts rename) |
| **Electron one-click install for non-technical users** | Every competitor requires Node.js, git clone, edit JSON. Sei targets the 95% who won't do that | Medium (packaging) | electron-builder; bundle Node runtime |
| **Cloud+Local hybrid with graceful fallback** | If Ollama isn't running, fall back to API-only mode automatically instead of failing | Medium | Requires both code paths work standalone |
| **Personality "feels in character" under pressure** | When attacked, a grumpy bot grumbles; a cheerful bot panics-cheerfully. Emergent from prompt design + event hooks | Medium | Differentiator only if well-tuned; easy to regress |
| **Mood/state memory** | Bot remembers it was *annoyed* with player earlier, carries tone forward within session | Low-Medium | Simple mood variable updated by personality LLM |

---

## Anti-Features

**Explicitly NOT building.** These are traps competitors fell into or user-frustration generators.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|--------------------|
| **Unconstrained code generation** (Voyager/AI_Paul style skill library) | Security nightmare in a distributed Electron app; LLM-generated JS running on user's machine with mineflayer access is a griefing/malware vector | Curated function list exposed to movement LLM; no `eval` |
| **Autonomous long-horizon goals** ("go mine diamonds for 2 hours") | Mindcraft/Voyager do this; causes bot to wander miles away, get stuck, grief terrain. Non-technical users hate it | Short-horizon, player-anchored behavior. Bot stays near owner unless explicitly sent |
| **Block-breaking without permission** | #1 griefing complaint in MC bot communities; YouTube search "griefing bots" is a warning sign | Whitelist: bot only breaks blocks it placed, or when owner says "break that" |
| **Auto-PvP against players** | Server-ban risk; bot misidentifies friendlies | Only defend self when attacked; never initiate PvP |
| **Raw system prompt editing in primary GUI** | Already in PROJECT.md Out of Scope — correct call. Power users edit files | Structured personality form; advanced tab at most |
| **Multiple simultaneous bots** | Already Out of Scope for v1 — correct. Compounds every bug, multiplies API cost | One bot per Electron instance |
| **Voice/TTS** | Already Out of Scope for v1 — correct. AI_Paul has it; adds huge latency + OS audio complexity | Text only for v1; revisit post-validation |
| **Pretending to be human / deceiving other players** | Ethics + server-rule violation (most servers ban bots posing as players) | Bot identifies as a bot when asked directly; owner can configure honesty level but default is truthful |
| **Unlimited chat context growth** | Token cost explosion; latency creep | Rolling summary + eviction; hard cap on context size |
| **Letting LLM pick pathfinder targets by (x,y,z) coordinates** | LLMs hallucinate coordinates; bot ends up in the void | Pathfinding targets are always entities or block-types the bot can see, never raw coords from LLM |
| **Auto-responding to every chat message** | Spam; annoys other players; bot feels needy | Only respond when addressed, in proximity, or on significant events. Rate limit |
| **Running custom JS from chat** | Mindcraft had this; trivial RCE vector | Never. Parameterized commands only |
| **Fine-tuned/custom model bundled** | Distribution size + licensing + staleness | Use stock models (Haiku via API, Qwen via Ollama); user brings their own |
| **Storing API key in plain config file** | Users share config files; keys leak | Electron safeStorage / OS keychain |
| **"Intelligent" inventory management** (auto-dropping items) | Users rage when their diamond gets tossed | Bot never drops items without explicit instruction |

---

## Feature Dependencies

```
Mineflayer integration
  ├─> Movement LLM (function calling)
  ├─> World event stream ──> Personality LLM loop
  └─> Chat I/O ─────────────┘

Personality LLM loop
  ├─> Memory system (context assembly)
  ├─> Screenshot capture (visual context)
  └─> Movement LLM (natural-language hand-off)

Memory system
  ├─> Session memory (rolling window)
  ├─> Per-player memory (UUID-keyed)
  └─> World/progression memory (shared)

Electron GUI
  ├─> Config persistence (profile JSON + keychain)
  ├─> Bot process lifecycle (spawn/kill node subprocess)
  ├─> Log/chat stream UI
  └─> Microsoft auth flow (BrowserWindow)
```

Critical ordering: mineflayer connection must work *before* LLM layers are wired; memory before differentiators; Electron last (wraps everything).

---

## MVP Recommendation

**First shippable milestone — "It feels alive for 10 minutes":**

1. Connect to a server with Microsoft auth (table stakes)
2. Follow owner, respond to chat directed at it (table stakes)
3. Personality prompt works (table stakes)
4. Session memory (within-session continuity — table stakes)
5. Event-driven reactions: attacked, mob nearby, inventory change (differentiator)
6. Electron GUI with API key + personality form + start/stop (table stakes for audience)

**Second milestone — "It remembers me":**

7. Persistent per-player memory (differentiator)
8. Idle commentary with rate limiting (differentiator)
9. Auto-reconnect, error translation, Ollama status check (table stakes polish)

**Defer past v1:**

- Screenshot/vision context (high complexity, validate text-only first)
- Mood state carryover (polish, not core)
- Long-horizon goals (anti-feature territory anyway)
- Voice, multi-bot (already Out of Scope)

---

## Sources

- [Mindcraft (mindcraft-bots/mindcraft)](https://github.com/mindcraft-bots/mindcraft) — profile JSON config, parameterized commands, multi-provider LLM
- [Mindcraft-CE](https://mindcraft-ce.com/)
- [MINDcraft (Kolby Nottingham, UCI)](https://sites.uci.edu/kolbynottingham/2024/10/30/mindcraft/) — autonomous goal-setting patterns
- [Voyager paper (MineDojo)](https://github.com/MineDojo/Voyager) + [arxiv:2305.16291](https://arxiv.org/abs/2305.16291) — skill library, curriculum, iterative self-verification
- [AI-Player mod (shasankp000)](https://github.com/shasankp000/AI-Player) — RAG, instruction decomposition, OpenAI-compatible providers
- [AI-Player on Modrinth](https://modrinth.com/mod/ai-player)
- [Player2 AI NPC](https://modrinth.com/mod/player2npc) — natural-language commands, personality packs
- [AI_Paul (SheppCrafd)](https://github.com/SheppCrafd/AI_Paul) — Ollama + TTS + memory companion
- [Iron AI mod](https://modrinth.com/mod/iron-ai), [ChatClef](https://www.curseforge.com/minecraft/mc-mods/chatclef), [AI Chat Mod](https://www.curseforge.com/minecraft/mc-mods/aimod) — passive chat baselines
- [mineflayer-pathfinder issues: hangs on unbreakable block](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/222)
- [mineflayer issue: bot freezes mid-air on knockback](https://github.com/PrismarineJS/mineflayer/issues/3887)
- [mineflayer issue: bot freezes on chat message](https://github.com/PrismarineJS/mineflayer/issues/902)
- [Griefing bots in singleplayer LAN (YouTube)](https://www.youtube.com/watch?v=tMowJX3v0io) — anti-feature rationale
- [AI companion memory architecture (Tekedia)](https://www.tekedia.com/ai-companion-chatbots-with-memory/)
- [AI Memory Systems Explained (lizlis.ai, 2026)](https://lizlis.ai/blog/ai-memory-systems-explained-2026-why-chatbots-forget-companions-remember-and-stories-evolve/) — short/working/long-term layering
- [Building AI Agents That Actually Remember (Medium, 2025)](https://medium.com/@nomannayeem/building-ai-agents-that-actually-remember-a-developers-guide-to-memory-management-in-2025-062fd0be80a1)
- [Personalized AI Companion w/ Long-Term Memory (Upstash)](https://upstash.com/blog/build-ai-companion-app)

**Confidence notes:**
- HIGH on competitor feature lists (direct README/docs inspection).
- HIGH on mineflayer pitfalls (GitHub issue tracker is authoritative).
- MEDIUM on "what non-technical users expect from Electron" — inferred from adjacent launchers (CurseForge, Prism, Modrinth App) rather than verified via user research.
- MEDIUM on anti-feature list — several items (griefing patterns, auto-PvP bans) are community wisdom; not all directly cited but consistent across multiple MC server forums.
