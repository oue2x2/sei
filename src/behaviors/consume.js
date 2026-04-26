// src/behaviors/consume.js — eat the held food (D-22, Pitfall 3)

export const DEFAULT_TIMEOUT_MS = 4000

export async function consumeItemAction(args, bot, config) {
  const signal = config?.signal
  if (signal?.aborted) return 'aborted'

  if (args?.item) {
    const invItem = bot.inventory.items().find((i) => i.name === args.item)
    if (!invItem) return `no ${args.item}`
    try {
      await bot.equip(invItem, 'hand')
    } catch {
      return `cannot equip ${args.item}`
    }
  }

  // Pitfall 3: clear control states so eat-while-moving doesn't silently fail.
  try { bot.clearControlStates() } catch {}

  const timeoutMs = args.timeout_ms ?? config?.consume_timeout_ms ?? DEFAULT_TIMEOUT_MS
  const heldName = bot.heldItem?.name ?? args?.item ?? 'food'

  const op = bot.consume()
    .then(() => `ate ${heldName}`)
    .catch(() => 'could not eat')

  const tmo = new Promise((r) => setTimeout(() => r('timeout'), timeoutMs))

  const abrt = new Promise((r) => {
    if (!signal) return
    signal.addEventListener('abort', () => r('aborted'), { once: true })
  })

  return Promise.race([op, tmo, abrt])
}
