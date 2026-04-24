import { loader as autoEat } from 'mineflayer-auto-eat'

export function startAutoEat(bot) {
  bot.loadPlugin(autoEat)
  bot.autoEat.setOpts({
    priority: 'foodPoints',
    minHunger: 14,
    bannedFood: [],
  })
  bot.autoEat.enableAuto()
}
