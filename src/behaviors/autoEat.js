import { loader as autoEat } from 'mineflayer-auto-eat'

export function startAutoEat(bot) {
  bot.loadPlugin(autoEat)
  bot.autoEat.options.priority = 'foodPoints'
  bot.autoEat.options.startAt = 14  // eat when food level <= 14 (out of 20)
  bot.autoEat.options.bannedFood = []
  bot.autoEat.enable()
}
