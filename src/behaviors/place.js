// src/behaviors/place.js — place a block against a reference face (D-22)
import { Vec3 } from 'vec3'
import { resolveBlock, isStaleHandle } from '../observers/targeting.js'

export const DEFAULT_TIMEOUT_MS = 4000

export async function placeBlockAction(args, bot, config) {
  const signal = config?.signal
  if (signal?.aborted) return 'aborted'

  const itemName = args.block
  const referenceBlock = await resolveBlock(args.against ?? {}, bot)
  if (!referenceBlock) return isStaleHandle(args.against ?? {}) ? 'stale target' : 'no target'

  const invItem = bot.inventory.items().find((i) => i.name === itemName)
  if (!invItem) return `no ${itemName} in inventory`

  try {
    await bot.equip(invItem, 'hand')
  } catch {
    return 'could not equip'
  }

  const fv = args.faceVector
  const faceVector = fv
    ? new Vec3(fv.x, fv.y, fv.z)
    : new Vec3(0, 1, 0)

  const timeoutMs = args.timeout_ms ?? config?.place_timeout_ms ?? DEFAULT_TIMEOUT_MS

  const op = bot.placeBlock(referenceBlock, faceVector)
    .then(() => `placed ${itemName}`)
    .catch(() => `cannot place ${itemName}`)

  const tmo = new Promise((r) => setTimeout(() => r('timeout'), timeoutMs))

  const abrt = new Promise((r) => {
    if (!signal) return
    signal.addEventListener('abort', () => r('aborted'), { once: true })
  })

  return Promise.race([op, tmo, abrt])
}
