/**
 * Chat behavior: responds when owner chats or when bot name is mentioned.
 * In Phase 1, response is a scripted acknowledgement.
 * Phase 2 will replace the response body with LLM-generated text.
 */
export function startChat(bot, config) {
  bot.on('chat', (username, message) => {
    // Ignore own messages
    if (username === bot.username) return

    const ownerSpoke = username === config.owner_username
    const addressed = message.toLowerCase().includes(bot.username.toLowerCase())

    // Check proximity (within 20 blocks)
    const speaker = bot.players[username]
    const botPos = bot.entity?.position
    let nearby = false
    if (speaker?.entity && botPos) {
      nearby = speaker.entity.position.distanceTo(botPos) <= 20
    }

    if (ownerSpoke || addressed || nearby) {
      // Phase 1: scripted acknowledgement; Phase 2 replaces this with LLM call
      bot.emit('sei:chat_received', { username, message, addressed, ownerSpoke })
    }
  })
}
