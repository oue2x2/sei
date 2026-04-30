// src/behaviors/attack.js — single-swing attack on an entity (D-22, Pitfall 5)
import { resolveEntity, isStaleHandle } from '../observers/targeting.js'
import { reason } from '../llm/errStrings.js'

export const DEFAULT_TIMEOUT_MS = 6000
const REACH = 3.5

export async function attackEntityAction(args, bot, config) {
  const signal = config?.signal
  if (signal?.aborted) return 'aborted'

  const entity = resolveEntity(args, bot)
  if (!entity) return isStaleHandle(args) ? 'stale target' : 'target gone'

  // Refuse Players — REQUIREMENTS Out-of-Scope: Auto-PvP.
  if (entity.type === 'player' || entity.username) return 'cannot attack player'

  const name = entity.name ?? entity.displayName ?? 'entity'
  const dist = bot.entity?.position?.distanceTo?.(entity.position)
  if (typeof dist === 'number' && dist > REACH) {
    return `target out of reach (${dist.toFixed(1)}m, need ≤${REACH}) ${name}`
  }

  const timeoutMs = args.timeout_ms ?? config?.attack_timeout_ms ?? DEFAULT_TIMEOUT_MS

  const op = Promise.resolve()
    .then(() => { bot.attack(entity); return `attacked ${name}` })
    .catch((err) => {
      const r = reason(err)
      return r ? `attack failed (${name}): ${r}` : `attack failed (${name})`
    })

  const tmo = new Promise((r) => setTimeout(() => r(`timeout attacking ${name}`), timeoutMs))

  const abrt = new Promise((r) => {
    if (!signal) return
    signal.addEventListener('abort', () => r('aborted'), { once: true })
  })

  return Promise.race([op, tmo, abrt])
}
