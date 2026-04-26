// src/behaviors/dig.js — single-flight dig with timeout + abort (D-22, Pitfall 2)
import { resolveBlock, isStaleHandle } from '../observers/targeting.js'

export const DEFAULT_TIMEOUT_MS = 8000

/**
 * Dig a block. Single-flight; refuses if another dig is in flight.
 * Returns deterministic *what*-only result strings (D-35).
 */
export async function digAction(args, bot, config) {
  const signal = config?.signal
  if (signal?.aborted) return 'aborted'

  const block = await resolveBlock(args, bot)
  if (!block) return isStaleHandle(args) ? 'stale target' : 'no target'

  // Single-flight guard (Pitfall 2: re-entry into mineflayer dig is fatal).
  if (bot.targetDigBlock != null) return 'busy digging'

  if (typeof bot.canDigBlock === 'function' && !bot.canDigBlock(block)) {
    return `cannot dig ${block.name}`
  }

  const timeoutMs = args.timeout_ms ?? config?.dig_timeout_ms ?? DEFAULT_TIMEOUT_MS
  const blockName = block.name

  const op = bot.dig(block)
    .then(() => `dug ${blockName}`)
    .catch(() => `cannot dig ${blockName}`)

  const tmo = new Promise((r) => setTimeout(() => {
    try { bot.stopDigging() } catch {}
    r('timeout')
  }, timeoutMs))

  const abrt = new Promise((r) => {
    if (!signal) return
    signal.addEventListener('abort', () => {
      try { bot.stopDigging() } catch {}
      r('aborted')
    }, { once: true })
  })

  return Promise.race([op, tmo, abrt])
}
