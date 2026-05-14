import Anthropic from '@anthropic-ai/sdk'
import { logHaikuQuery, logHaikuResponse } from './log.js'

/**
 * 260502-h6i: Stamp `cache_control: {type:'ephemeral'}` on the LAST tool entry
 * so Anthropic's prompt-cache boundary lands at the end of the tools array.
 * Marking only the last system block leaves `tools` outside the cached prefix
 * (cache_read stays at 0). Exported for the verify harness.
 */
export function stampLastToolCacheControl(tools) {
  if (!tools?.length) return undefined
  return tools.map((t, i) => i === tools.length - 1
    ? { ...t, cache_control: { type: 'ephemeral' } }
    : t)
}

/**
 * @param {{anthropic:{api_key:string,model:string,timeout_ms:number}}} config
 */
export function createAnthropicClient(config) {
  const sdk = new Anthropic({ apiKey: config.anthropic.api_key })
  const model = config.anthropic.model
  const defaultTimeoutMs = config.anthropic.timeout_ms

  /**
   * Make a Messages API call.
   * @param {object} req
   * @param {{type:'text',text:string,cache_control?:{type:'ephemeral'}}[]} req.systemBlocks  // last block carries cache_control (D-17/D-18)
   * @param {{name:string,description:string,input_schema:object}[]} req.tools
   * @param {{role:'user'|'assistant',content:string|Array<any>}[]} req.messages — content may be a `ContentBlockParam[]` per Phase 3 D-42 (text blocks, tool_use, tool_result). The SDK union accepts both `string` and block-array shapes; Loop.buildAnthropicPayload() emits the block-array form.
   * @param {AbortSignal} [req.signal]
   * @param {number} [req.timeoutMs]
   * @param {number} [req.maxTokens]
   * @param {Array<{role:string, content:Array<{type:string, name?:string, text?:string}>}>} [req.namedUserBlocks] Canonical pre-strip messages array carrying `name` fields on text blocks; used by log.js for cache-prefix hash elision. Logger-only; not sent to API.
   * @returns {Promise<{toolUses:Array<{id:string,name:string,input:any}>, text:string, usage:object, stopReason:string}>}
   */
  async function call({ systemBlocks, tools, messages, signal, timeoutMs, maxTokens = 1024, namedUserBlocks, thinking }) {
    logHaikuQuery({ messages, tools, systemBlocks, namedUserBlocks })
    // 260502-h6i: stamp cache_control on the LAST tool entry so the cache
    // boundary lands at the end of the tools array (system → tools is now
    // cached; cache_read can rise above 0).
    const _tools = stampLastToolCacheControl(tools)
    // Extended thinking: when enabled, the model emits private `thinking`
    // blocks BEFORE any text/tool_use. They are never relayed to chat but
    // MUST be preserved in conversation history when the same assistant turn
    // also produced a tool_use (Anthropic 400s otherwise). Caller gets the
    // raw content array so it can round-trip thinking blocks intact.
    // Budget is the smallest allowed (1024) by default — keeps latency low
    // while still giving the model a structured scratchpad to separate
    // private reasoning from in-character speech.
    const req = {
      model,
      max_tokens: maxTokens,
      system: systemBlocks,
      tools: _tools,
      messages,
    }
    if (thinking) req.thinking = thinking
    const resp = await sdk.messages.create(req, { signal, timeout: timeoutMs ?? defaultTimeoutMs })
    const content = resp.content ?? []
    const toolUses = content
      .filter(b => b.type === 'tool_use')
      .map(b => ({ id: b.id, name: b.name, input: b.input }))
    const text = content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
    logHaikuResponse({ text, toolUses, usage: resp.usage, stopReason: resp.stop_reason })
    return { toolUses, text, content, usage: resp.usage, stopReason: resp.stop_reason }
  }

  /**
   * Helper: build the cached system prefix array. cache_control marker stays on
   * the LAST (tool) block per D-18. Block order (D-30/D-31/D-32):
   *   1. system instructions
   *   2. personaText + '\n' + learningLine   (D-32 line glued to persona)
   *   3. capabilityParagraph                 (D-30)
   *   4. primer                              (D-31)
   *   5. tool list                           ← cache_control here
   *
   * @param {string} systemInstructions
   * @param {string} personaText
   * @param {string} capabilityParagraph
   * @param {string} primer
   * @param {string} learningLine
   * @param {{name:string,description:string,input_schema:object}[]} tools
   */
  function buildCachedSystem(systemInstructions, personaText, capabilityParagraph, primer, learningLine, tools) {
    const toolBlock = tools.length
      ? `Available actions:\n` + tools.map(t => `- ${t.name}: ${t.description}`).join('\n')
      : 'No actions available.'
    return [
      { type: 'text', text: systemInstructions },
      { type: 'text', text: `${personaText}\n${learningLine}` },
      { type: 'text', text: capabilityParagraph },
      { type: 'text', text: primer },
      { type: 'text', text: toolBlock, cache_control: { type: 'ephemeral' } },
    ]
  }

  return { call, buildCachedSystem, model }
}
