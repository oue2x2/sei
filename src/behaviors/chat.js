/**
 * Chat behavior: responds when owner chats or when bot name is mentioned.
 * In Phase 1, response is a scripted acknowledgement.
 * Phase 2 will replace the response body with LLM-generated text.
 *
 * 260502-h6i: when the owner says one of a tight set of stop verbs, short-
 * circuit BEFORE the orchestrator. We don't want to pay a Haiku round-trip
 * just to learn "stop"; we also don't want Haiku to interpret it as
 * conversation. The fast path: abort the active Loop, clear owner_goals,
 * say "stopping.", and skip dispatch.
 */
import { logChatIn } from '../log.js'

const STOP_VERBS = new Set(['stop', 'halt', 'cancel', 'nevermind', 'never mind'])

export function startChat(bot, config, orchestrator = null) {
  bot.on('chat', (username, message) => {
    // Ignore own messages
    if (username === bot.username) return
    logChatIn(username, message)

    const ownerSpoke = username === config.owner_username

    // 260502-h6i: stop-verb pre-LLM hard cancel. Whole-message exact match
    // (case-insensitive, trimmed) — "don't stop" / "stop please" do NOT match.
    if (ownerSpoke && orchestrator) {
      const trimmed = String(message).trim().toLowerCase()
      if (STOP_VERBS.has(trimmed)) {
        // (a) abort the active Loop, if any.
        try { orchestrator.currentLoop?.abortController?.abort() } catch {}
        // (b) clear owner_goals via the existing goal store API.
        try {
          const owner = orchestrator.goals?.snapshot?.()?.owner_goals ?? []
          for (const g of owner) {
            try { orchestrator.goals.remove?.('owner', g) } catch {}
          }
        } catch {}
        // (c) confirm with a single chat line — cheap, no LLM.
        try { bot.chat('stopping.') } catch {}
        // (d) skip dispatch.
        return
      }
    }

    const addressed = message.toLowerCase().includes(bot.username.toLowerCase())

    // Check proximity (within 20 blocks)
    const speaker = bot.players[username]
    const botPos = bot.entity?.position
    let nearby = false
    if (speaker?.entity && botPos) {
      nearby = speaker.entity.position.distanceTo(botPos) <= 20
    }

    if (ownerSpoke || addressed || nearby) {
      const payload = { username, message, addressed, ownerSpoke }
      if (bot._seiDebouncer) {
        bot._seiDebouncer.debounce(`chat:${username}`, payload, (p) => bot.emit('sei:chat_received', p))
      } else {
        bot.emit('sei:chat_received', payload)
      }
    }
  })
}
