/**
 * PLAYER.md store — YAML-frontmatter + freeform `# Notes` body.
 *
 * PLAYER.md is the canonical record of the human player you share the world
 * with — identity (uuid + username), session counters, cosmetic preferences,
 * and a freeform notes body. The bot is a fellow player, not a servant; this
 * file is just "who is the other person in here with me."
 *
 *   - `player_uuid` (source of truth for recognition)
 *   - `player_username` (current display name; not used for recognition)
 *   - `first_seen`, `last_seen` (ISO timestamps)
 *   - `total_sessions` (integer counter)
 *   - `preferred_name`, `pronouns` (cosmetic)
 *   - `# Notes` body (freeform, LLM-managed)
 *
 * Lazy-create: `loadPlayer` on a missing file returns `{ exists: false, ... }`
 * — it does NOT create the file. Files are only created via `savePlayer`
 * (which goes through atomicWrite).
 *
 * Frontmatter parser is a flat regex (`^([a-z_]+):\s*(.*)$`); no `js-yaml`
 * dep needed. Tolerant of unknown keys and malformed lines.
 */

import { readFile } from 'node:fs/promises'
import { atomicWrite } from '../storage/atomicWrite.js'
import { withFileLock } from '../storage/fileLock.js'

const FRONT_DELIM = '---'
const KNOWN_KEYS = [
  'player_uuid',
  'player_username',
  'first_seen',
  'last_seen',
  'total_sessions',
  'preferred_name',
  'pronouns',
]

/**
 * @typedef {Object} PlayerData
 * @property {string|null} player_uuid
 * @property {string|null} player_username
 * @property {string|null} first_seen
 * @property {string|null} last_seen
 * @property {number}      total_sessions
 * @property {string|null} preferred_name
 * @property {string|null} pronouns
 * @property {string}      notes
 * @property {boolean}     exists
 */

function freshPlayerData() {
  return {
    player_uuid: null,
    player_username: null,
    first_seen: null,
    last_seen: null,
    total_sessions: 0,
    preferred_name: null,
    pronouns: null,
    notes: '',
    exists: false,
  }
}

/**
 * Read and parse PLAYER.md at `path`. Returns a fresh placeholder
 * (`exists: false`) if the file does not exist (never creates the file).
 * @param {string} path
 * @returns {Promise<PlayerData>}
 */
export async function loadPlayer(path) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return freshPlayerData()
    throw err
  }
  return parsePlayer(raw)
}

function parsePlayer(raw) {
  const data = freshPlayerData()
  data.exists = true

  // Detect frontmatter delimiters: leading `---\n` and a closing `---\n` later.
  const lines = raw.split(/\r?\n/)
  let bodyStart = 0
  if (lines[0] === FRONT_DELIM) {
    let i = 1
    while (i < lines.length && lines[i] !== FRONT_DELIM) {
      const m = /^([a-z_]+)\s*:\s*(.*)$/.exec(lines[i])
      if (m) {
        const key = m[1]
        const val = m[2]
        if (KNOWN_KEYS.includes(key)) {
          if (key === 'total_sessions') {
            const n = Number(val)
            data.total_sessions = Number.isFinite(n) ? Math.trunc(n) : 0
          } else {
            data[key] = val === '' ? null : val
          }
        }
      }
      i++
    }
    bodyStart = (i < lines.length && lines[i] === FRONT_DELIM) ? i + 1 : i
  }

  let body = lines.slice(bodyStart).join('\n')
  body = body.replace(/^\s*\n/, '')
  body = body.replace(/^# Notes\s*\n/, '')
  body = body.replace(/\s+$/, '')
  data.notes = body

  return data
}

async function _writePlayerSerialized(path, data) {
  const lines = [FRONT_DELIM]
  for (const key of KNOWN_KEYS) {
    let v = data[key]
    if (key === 'total_sessions') {
      v = Number.isFinite(v) ? Math.trunc(v) : 0
      lines.push(`${key}: ${v}`)
    } else {
      lines.push(`${key}: ${v == null ? '' : String(v)}`)
    }
  }
  lines.push(FRONT_DELIM)
  lines.push('# Notes')
  lines.push(data.notes ?? '')
  lines.push('')
  await atomicWrite(path, lines.join('\n'))
}

/**
 * Atomically write PLAYER.md at `path` from `data`. Wrapped in withFileLock
 * so concurrent savePlayer calls do not interleave with appendNote /
 * setPreferredName mutations on the same file.
 */
export async function savePlayer(path, data) {
  return withFileLock(path, () => _writePlayerSerialized(path, data))
}

const PREFERRED_NAME_MAX = 64
const NOTE_MAX = 256

/**
 * Atomically set PLAYER.md's `preferred_name:` frontmatter field.
 * The entire load→mutate→write sequence runs inside withFileLock so a
 * concurrent appendNote / savePlayer cannot read the same baseline and
 * overwrite our update. Calls _writePlayerSerialized directly (NOT
 * savePlayer) to avoid same-path lock re-entry.
 */
export async function setPreferredName(filePath, name) {
  const safe = String(name ?? '').trim().slice(0, PREFERRED_NAME_MAX)
  return withFileLock(filePath, async () => {
    const player = await loadPlayer(filePath)
    const next = {
      ...player,
      exists: true,
      preferred_name: safe,
    }
    await _writePlayerSerialized(filePath, next)
  })
}

/**
 * Atomically append `- [ISO timestamp] note` under the `## Notes` heading.
 * Wrapped in withFileLock so two concurrent appendNote calls cannot both
 * read the same baseline notes body and overwrite each other.
 */
export async function appendNote(filePath, note) {
  const safe = String(note ?? '').replace(/\s*\n+\s*/g, ' ').trim().slice(0, NOTE_MAX)
  if (!safe) return
  const t = new Date().toISOString()
  const line = `- [${t}] ${safe}`
  return withFileLock(filePath, async () => {
    const player = await loadPlayer(filePath)
    const existingNotes = player.notes ?? ''
    const nextNotes = existingNotes ? `${existingNotes}\n${line}` : line
    const next = { ...player, exists: true, notes: nextNotes }
    await _writePlayerSerialized(filePath, next)
  })
}

/**
 * Format PLAYER.md as the seed_player markdown block injected into every
 * Loop's first user turn. Frontmatter (recognition fields) is always
 * preserved; the notes body is truncated at the byte boundary if the total
 * exceeds budget.
 * @param {PlayerData} player
 * @param {number} budgetBytes
 * @returns {string}
 */
export function formatPlayerSeedBlock(player, budgetBytes) {
  if (!player || !player.exists) {
    return '# Player\n(no player recorded yet)\n'
  }

  const headerLines = ['# Player', '']
  for (const key of KNOWN_KEYS) {
    const v = player[key]
    headerLines.push(`${key}: ${v == null ? '' : String(v)}`)
  }
  headerLines.push('')
  headerLines.push('## Notes')
  const headerStr = headerLines.join('\n') + '\n'
  const headerBytes = Buffer.byteLength(headerStr, 'utf8')

  const notes = player.notes ?? ''
  if (!notes) return headerStr

  const fullBytes = headerBytes + Buffer.byteLength(notes + '\n', 'utf8')
  if (fullBytes <= budgetBytes) {
    return headerStr + notes + '\n'
  }

  const marker = '\n…(truncated)\n'
  const markerBytes = Buffer.byteLength(marker, 'utf8')
  const remaining = Math.max(0, budgetBytes - headerBytes - markerBytes)
  const buf = Buffer.from(notes, 'utf8')
  const truncated = buf.subarray(0, remaining).toString('utf8')
  return headerStr + truncated + marker
}
