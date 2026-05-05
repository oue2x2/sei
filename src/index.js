import { loadConfig } from './config.js'
import { start } from './bot.js'
import { discoverLanPort } from './lanDiscovery.js'

async function main() {
  console.log('[sei] Searching for an open LAN world...')
  const { port, motd } = await discoverLanPort({ timeoutMs: 5000 })
  console.log(`[sei] Found LAN world "${motd}" on port ${port}`)
  const config = loadConfig('./config.json')
  start(config, port)
}

main().catch((err) => {
  console.error(`[sei] Startup failed: ${err.message}`)
  process.exit(1)
})
