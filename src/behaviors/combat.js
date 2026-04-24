import { stopFollow, startFollow } from './follow.js'

const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'witch',
  'blaze', 'ghast', 'slime', 'phantom', 'drowned', 'husk', 'stray',
  'pillager', 'vindicator', 'evoker', 'ravager', 'enderman', 'endermite',
  'silverfish', 'guardian', 'elder_guardian', 'wither_skeleton', 'hoglin',
  'piglin_brute', 'zoglin',
])

function resolveAttacker(bot, source) {
  const live = source?.id != null ? bot.entities[source.id] : null
  if (live && HOSTILE_MOBS.has(live.name)) return live
  if (source?.name && HOSTILE_MOBS.has(source.name)) return source
  for (const e of Object.values(bot.entities)) {
    if (e === bot.entity) continue
    if (HOSTILE_MOBS.has(e.name)) return e
  }
  return null
}

export function startCombat(bot, config) {
  let _target = null
  let _attackLoop = null
  let _exitTimer = null

  function startAttacking(target) {
    _target = target
    clearInterval(_attackLoop)
    clearTimeout(_exitTimer)

    _attackLoop = setInterval(() => {
      if (!_target) return
      const live = bot.entities[_target.id]
      if (!live) return

      // Knockback packets occasionally corrupt velocity → NaN position; heal in place.
      const vel = bot.entity?.velocity
      if (vel && (!Number.isFinite(vel.x) || !Number.isFinite(vel.y) || !Number.isFinite(vel.z))) {
        vel.x = 0; vel.y = 0; vel.z = 0
      }
      const pos = bot.entity?.position
      if (pos && (!Number.isFinite(pos.x) || !Number.isFinite(pos.z)) && live.position) {
        pos.x = live.position.x
        pos.z = live.position.z
      }

      try {
        // Zombies face their target — inverting their yaw is cheaper and more reliable
        // than computing ours from bot position (which may still be stale).
        if (Number.isFinite(live.yaw)) bot.look(live.yaw + Math.PI, 0, true)
        bot.attack(live)
        bot.swingArm()
      } catch (_) {}
    }, 250)
  }

  function stopAttacking() {
    clearInterval(_attackLoop)
    clearTimeout(_exitTimer)
    _attackLoop = null
    _target = null
    try { bot.pathfinder?.stop() } catch (_) {}
    startFollow(bot, config)
  }

  bot.on('entityHurt', (entity, source) => {
    if (entity !== bot.entity) return

    const target = resolveAttacker(bot, source)
    if (!target) return

    bot.emit('sei:attacked', { attacker: target })

    if (_target?.id !== target.id) {
      stopFollow()
      startAttacking(target)
    }

    clearTimeout(_exitTimer)
    _exitTimer = setTimeout(stopAttacking, 1000)
  })

  bot.on('entityGone', (entity) => {
    if (_target && entity.id === _target.id) stopAttacking()
  })
}
