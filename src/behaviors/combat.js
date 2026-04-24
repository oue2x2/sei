import { stopFollow, startFollow } from './follow.js'

const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'witch',
  'blaze', 'ghast', 'slime', 'phantom', 'drowned', 'husk', 'stray',
  'pillager', 'vindicator', 'evoker', 'ravager', 'enderman', 'endermite',
  'silverfish', 'guardian', 'elder_guardian', 'wither_skeleton', 'hoglin',
  'piglin_brute', 'zoglin',
])

/** source from entityHurt may be a weapon/item entity — resolve to the nearest real mob */
function findNearestAttacker(bot, source) {
  // If source looks like a real mob, use it directly
  if (source?.name && HOSTILE_MOBS.has(source.name)) return source
  // Otherwise find nearest hostile mob within 8 blocks
  let nearest = null
  let minDist = 8
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue
    if (!HOSTILE_MOBS.has(entity.name)) continue
    const dist = bot.entity.position.distanceTo(entity.position)
    if (dist < minDist) { minDist = dist; nearest = entity }
  }
  return nearest
}

export function startCombat(bot, config) {
  let _inCombat = false
  let _combatTimer = null

  // mineflayer 4.x uses entityHurt(entity, source) — filter for when the bot itself is hurt
  bot.on('entityHurt', (entity, source) => {
    if (entity !== bot.entity) return
    const attacker = source ?? null
    if (!attacker) return

    // source from entityHurt may be a weapon/projectile entity — find the nearest real mob instead
    const target = findNearestAttacker(bot, attacker)
    if (!target) return

    bot.emit('sei:attacked', { attacker: target })

    if (!_inCombat) {
      _inCombat = true
      stopFollow()
    }

    const dist = bot.entity.position.distanceTo(target.position)
    console.log(`[sei/combat] retaliating against ${target.name ?? target.type} dist=${dist.toFixed(1)}`)
    if (dist <= 4) {
      try { bot.attack(target) } catch (e) { console.log('[sei/combat] attack err:', e.message) }
    }

    // Resume follow 3s after last hit
    clearTimeout(_combatTimer)
    _combatTimer = setTimeout(() => {
      _inCombat = false
      startFollow(bot, config)
    }, 3000)
  })
}
