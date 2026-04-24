import { plugin as pvp } from 'mineflayer-pvp'

export function startCombat(bot) {
  bot.loadPlugin(pvp)

  // mineflayer 4.x uses entityHurt(entity, source) — filter for when the bot itself is hurt
  bot.on('entityHurt', (entity, source) => {
    if (entity !== bot.entity) return
    const attacker = source ?? null
    if (!attacker) return
    // Don't restart the PVP sequence if already targeting this entity — rapid hits reset the attack timer
    if (bot.pvp.target === attacker) return
    bot.emit('sei:attacked', { attacker })
    bot.pvp.attack(attacker)
  })
}
