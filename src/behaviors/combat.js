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
  let _target = null
  let _attackLoop = null
  let _exitTimer = null

  function startAttacking(target) {
    _target = target
    clearInterval(_attackLoop)
    clearTimeout(_exitTimer)

    // Attack every 600ms — stays within Minecraft's 1.9+ sword cooldown
    _attackLoop = setInterval(() => {
      if (!_target?.position || !bot.entity?.position) return
      const dist = bot.entity.position.distanceTo(_target.position)
      if (dist <= 4) {
        try {
          bot.lookAt(_target.position.offset(0, _target.height ?? 1.6, 0), true)
          bot.attack(_target)
          bot.swingArm()
        } catch (_) {}
      }
    }, 600)
  }

  function stopAttacking() {
    clearInterval(_attackLoop)
    clearTimeout(_exitTimer)
    _attackLoop = null
    _target = null
    startFollow(bot, config)
  }

  bot.on('entityHurt', (entity, source) => {
    if (entity !== bot.entity) return
    const attacker = source ?? null
    if (!attacker) return

    const target = findNearestAttacker(bot, attacker)
    if (!target) return

    bot.emit('sei:attacked', { attacker: target })

    if (_target !== target) {
      stopFollow()
      startAttacking(target)
    }

    // Exit combat 3s after last hit
    clearTimeout(_exitTimer)
    _exitTimer = setTimeout(stopAttacking, 3000)
  })

  // Clean up if target entity is removed from world
  bot.on('entityGone', (entity) => {
    if (entity === _target) stopAttacking()
  })
}
