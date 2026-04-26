// src/behaviors/drop.js — toss N of an item from inventory (D-22)

export const DEFAULT_TIMEOUT_MS = 2000

export async function dropItemAction(args, bot, config) {
  const signal = config?.signal
  if (signal?.aborted) return 'aborted'

  const { item } = args
  const count = args.count ?? 1
  const invItem = bot.inventory.items().find((i) => i.name === item)
  if (!invItem) return `no ${item}`

  const timeoutMs = args.timeout_ms ?? config?.drop_timeout_ms ?? DEFAULT_TIMEOUT_MS

  const op = bot.toss(invItem.type, null, count)
    .then(() => `dropped ${count} ${item}`)
    .catch(() => `cannot drop ${item}`)

  const tmo = new Promise((r) => setTimeout(() => r('timeout'), timeoutMs))

  const abrt = new Promise((r) => {
    if (!signal) return
    signal.addEventListener('abort', () => r('aborted'), { once: true })
  })

  return Promise.race([op, tmo, abrt])
}
