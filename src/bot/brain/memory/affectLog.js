/**
 * AFFECT.md store — append-only timestamped log of moments worth remembering
 * across sessions (Phase 03.1 Plan 04 / RESEARCH "Memory write-side fix
 * design" Change 2 + Change 3).
 *
 * Why this exists (defect D-M-1):
 *   sessionState.loopHasMutation gates diary writes on world-mutating actions.
 *   Pure-chat sessions — where praise, name reveals, and stated preferences
 *   happen — never mutate the world, so they never produced a diary entry.
 *   AFFECT.md is the immediate-write companion to DIARY.md: each entry is
 *   one short line, the file stays tiny by construction, and it is loaded
 *   in FULL into every Loop's seed user turn (no budget needed).
 *
 * Format (one line per entry, append-only):
 *   - [ISO8601 timestamp] (kind) summary
 *
 * Kinds (mirror noteToSelf tool enum):
 *   praise | preference | name | milestone | moment
 *
 * Concurrency: writes serialize via withFileLock from ../storage/fileLock.js
 * (Plan 03.1-08 WR-06). The atomic-write primitive still guards partial-write
 * at the OS layer; the in-process mutex prevents two concurrent
 * read-modify-write sequences from clobbering each other's appends.
 */

import { readFile } from 'node:fs/promises'
import { atomicWrite } from '../storage/atomicWrite.js'
import { withFileLock } from '../storage/fileLock.js'

const HEADER =
  '# Affect Log\n' +
  '\n' +
  'Append-only record of moments worth remembering across sessions.\n' +
  'Format: `- [ISO timestamp] (kind) summary`\n' +
  '\n'

/**
 * Factory shape — mirrors createDiary / createOwnerStore so call sites can
 * inject one object reference and not pass paths around.
 *
 * @param {Object} opts
 * @param {string} opts.path  Absolute or workspace-relative path to AFFECT.md.
 * @returns {{
 *   path: string,
 *   append: (entry: {kind:string, summary:string, when?:Date|string}) => Promise<void>,
 *   readAll: () => Promise<string>,
 * }}
 */
export function createAffectLog({ path: filePath } = {}) {
  if (!filePath) throw new Error('createAffectLog: path is required')
  return {
    path: filePath,
    append: (entry) => appendAffect(filePath, entry),
    readAll: () => readAffectFull(filePath),
  }
}

/**
 * Append a single entry to AFFECT.md atomically. Cold-creates the file
 * with a HEADER if it does not exist (RESEARCH: "AFFECT.md is loaded in
 * FULL into every seed turn — start with the header so the LLM sees a
 * coherent block on day one").
 *
 * @param {string} filePath
 * @param {{kind:string, summary:string, when?:Date|string}} entry
 */
export async function appendAffect(filePath, { kind, summary, when } = {}) {
  let whenDate
  if (when instanceof Date) whenDate = when
  else if (typeof when === 'string') whenDate = new Date(when)
  else whenDate = new Date()
  const t = whenDate.toISOString()
  const safeKind = String(kind ?? 'moment')
  // Strip newlines so each entry is exactly one line — preserves the
  // append-only line-record shape downstream readers depend on.
  const safeSummary = String(summary ?? '').replace(/\s*\n+\s*/g, ' ').trim()
  const line = `- [${t}] (${safeKind}) ${safeSummary}\n`

  return withFileLock(filePath, async () => {
    let existing = ''
    try {
      existing = await readFile(filePath, 'utf8')
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        existing = HEADER
      } else {
        throw err
      }
    }
    if (!existing.startsWith('# Affect Log')) {
      // Defensive: if a hand-edited file lost the header, prepend it so the
      // seed-turn block stays well-formed.
      existing = HEADER + existing
    }
    await atomicWrite(filePath, existing + line)
  })
}

/**
 * Read AFFECT.md in full, cold-creating the file with HEADER if missing.
 * The file is small by construction; we never truncate.
 *
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function readAffectFull(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      await atomicWrite(filePath, HEADER)
      return HEADER
    }
    throw err
  }
}
