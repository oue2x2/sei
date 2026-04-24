import { stopFollow, startFollow } from './follow.js'

export function startCombat(bot, config) {
  let _inCombat = false
  let _combatTimer = null

  // mineflayer 4.x uses entityHurt(entity, source) — filter for when the bot itself is hurt
  bot.on('entityHurt', (entity, source) => {
    if (entity !== bot.entity) return
    const attacker = source ?? null
    if (!attacker) return

    bot.emit('sei:attacked', { attacker })

    // Pause follow so it doesn't cancel the attack movement
    if (!_inCombat) {
      _inCombat = true
      stopFollow()
    }

    // Immediate single retaliation hit — pvp plugin movement conflicts with follow in Phase 1
    bot.lookAt(attacker.position.offset(0, attacker.height, 0))
      .then(() => bot.attack(attacker))
      .catch(() => {})

    // Resume follow 3s after last hit
    clearTimeout(_combatTimer)
    _combatTimer = setTimeout(() => {
      _inCombat = false
      startFollow(bot, config)
    }, 3000)
  })
}
