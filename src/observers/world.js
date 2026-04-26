// src/observers/world.js — pure function of bot state
/**
 * @param {import('mineflayer').Bot} bot
 * @returns {{ pos:{x:number,y:number,z:number}, biome:string, time:{isDay:boolean,timeOfDay:number} }}
 */
export function world(bot) {
  const p = bot.entity?.position ?? { x: 0, y: 0, z: 0 }
  const pos = {
    x: Math.round(p.x),
    y: Math.round(p.y),
    z: Math.round(p.z),
  }
  let biome = 'unknown'
  try {
    const b = bot.world?.getBiome?.(p)
    if (b && typeof b === 'object' && 'name' in b) biome = b.name
    else if (typeof b === 'string') biome = b
  } catch {
    biome = 'unknown'
  }
  return {
    pos,
    biome,
    time: {
      isDay: Boolean(bot.time?.isDay),
      timeOfDay: bot.time?.timeOfDay ?? 0,
    },
  }
}
