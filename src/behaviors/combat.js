import { plugin as pvp } from 'mineflayer-pvp'

export function startCombat(bot) {
  bot.loadPlugin(pvp)

  bot.on('hurtByEntity', (attacker) => {
    if (!attacker) return
    // Emit event for FSM to handle at P0 priority; also immediately defend
    bot.emit('sei:attacked', { attacker })
    bot.pvp.attack(attacker)
  })
}
