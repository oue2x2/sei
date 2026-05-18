# Sei Launcher

An AI companion that plays games with you. Summon a character into your world and they play alongside you as a real player — not a chatbot, not an NPC. They see what you see, hear what you say, remember what happens between you.

Download at [sei.gg](https://sei.gg).

---

## Shipped — v0.1

- **Desktop launcher** (macOS + Windows) — Electron app with character creation, persona editor, skin picker, and live logs.
- **Minecraft adapter** — connects to LAN-opened single-player worlds via Fabric + CustomSkinLoader; auto-detects vanilla and CurseForge installations.
- **Character system** — author personas in plain English; the launcher expands them into full behavioral prompts. Per-character persistent memory.
- **One-call AI brain** — single Claude Haiku 4.5 call combines reasoning + tool dispatch over a closed action registry (chat, movement, combat, building, inventory).
- **Three default characters** shipped — Sui, Lyra, Clawd.
- **Local skin server + Mojang username lookup** — bring any in-game skin to your character.
- **First-launch setup wizard** — installs Fabric + CustomSkinLoader into each detected Minecraft install.
- **In-app update notifications** — checks `sei.gg/version.json` on startup.

## Roadmap

### Next
- **Online character sharing + cloud play.** Upload personas to a public gallery, summon other people's characters, and run the brain on Sei's hosted backend so users don't need their own API key. Paid tiers gate cloud playtime; self-host stays free.
- **In-game vision.** Pixel-level world understanding via a vision-capable model so the character can read signs, recognize structures, and react to what's actually on screen — closing the gap between "knows the data" and "sees the game."

### After
- **Modded Minecraft adapters.** First targets: Pixelmon, Create, Better Minecraft. Each mod's blocks/items/entities exposed to the action registry so characters can play modpacks fluently.
- **Adapters for other games.** Skyrim is next on the list. The brain is game-agnostic; each adapter is a new translation layer between game state and the action registry.

---

## Architecture (one paragraph)

Three processes: Electron main (UI + IPC + safe storage), renderer (React), and a utility process running the mineflayer bot + brain. A single Haiku 4.5 call reasons over the world state and emits Zod-typed actions from a closed registry — no code generation, no shell access. Every external call is wall-clock bounded. Memory is event-sourced and LLM-compacted at semantic boundaries.

See `ARCHITECTURE.md` for the full picture.
