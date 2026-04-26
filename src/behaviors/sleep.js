// src/behaviors/sleep.js — sleep in a bed (D-22, Pitfall 4)
import { resolveBlock, isStaleHandle } from '../observers/targeting.js'

export const DEFAULT_TIMEOUT_MS = 12000

export async function sleepAction(args, bot, config) {
  const signal = config?.signal
  if (signal?.aborted) return 'aborted'

  // Pitfall 4: refuse during day BEFORE calling bot.sleep.
  if (bot.time?.isDay) return 'cannot sleep during day'

  const block = await resolveBlock(args, bot)
  if (!block) return isStaleHandle(args) ? 'stale target' : 'no target'

  const isBed = (typeof bot.isBlockBed === 'function')
    ? bot.isBlockBed(block)
    : (typeof block.name === 'string' && block.name.endsWith('_bed'))
  if (!isBed) return 'no target'

  const timeoutMs = args.timeout_ms ?? config?.sleep_timeout_ms ?? DEFAULT_TIMEOUT_MS

  const op = bot.sleep(block)
    .then(() => 'sleeping')
    .catch(() => 'cannot sleep')

  const tmo = new Promise((r) => setTimeout(() => r('timeout'), timeoutMs))

  const abrt = new Promise((r) => {
    if (!signal) return
    signal.addEventListener('abort', () => r('aborted'), { once: true })
  })

  return Promise.race([op, tmo, abrt])
}
