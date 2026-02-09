/**
 * Prompt Assembler
 *
 * Takes AiCollector data and produces a self-contained markdown document
 * that an AI agent (or human) can read, answer, and save as JSON.
 *
 * The output includes:
 * - Global and per-block context
 * - Each prompt with its expected output format
 * - A response format section with JSON schema
 * - A callback instruction for Pass 2
 */

import createDebug from 'debug'
import type { AiCollector } from './ai-collector.js'

const debug = createDebug('hypergen:ai:prompt-assembler')

export interface AssemblerOptions {
  /** The original command that was run (for the callback instruction) */
  originalCommand: string

  /** Suggested path for the answers JSON file */
  answersPath?: string
}

export class PromptAssembler {
  assemble(collector: AiCollector, options: AssemblerOptions): string {
    const parts: string[] = []
    const globalContexts = collector.getGlobalContexts()
    const entries = collector.getEntries()
    const answersPath = options.answersPath || './ai-answers.json'

    parts.push('# Hypergen AI Generation Request\n')

    // Context section
    if (globalContexts.length > 0 || this.hasBlockContexts(entries)) {
      parts.push('## Context\n')

      if (globalContexts.length > 0) {
        parts.push('### Global Context\n')
        for (const ctx of globalContexts) {
          parts.push(ctx)
          parts.push('')
        }
      }

      for (const [key, entry] of entries) {
        if (entry.contexts.length > 0) {
          parts.push(`### Context for \`${key}\`\n`)
          for (const ctx of entry.contexts) {
            parts.push(ctx)
            parts.push('')
          }
        }
      }
    }

    // Prompts section
    parts.push('## Prompts\n')

    for (const [key, entry] of entries) {
      parts.push(`### \`${key}\`\n`)
      parts.push(entry.prompt)
      parts.push('')

      if (entry.outputDescription.trim()) {
        parts.push('**Expected output format:**\n')
        parts.push(entry.outputDescription)
        parts.push('')
      }
    }

    // Response format section
    parts.push('## Response Format\n')
    parts.push('Respond with a JSON object:\n')
    parts.push('```json')

    const schema: Record<string, string> = {}
    for (const [key, entry] of entries) {
      schema[key] = entry.outputDescription.trim() ? '<see format above>' : '<your answer>'
    }
    parts.push(JSON.stringify(schema, null, 2))

    parts.push('```\n')

    // Instructions section
    parts.push('## Instructions\n')
    parts.push(`Save your response as JSON to a file and run:\n`)
    parts.push('```')
    parts.push(`${options.originalCommand} --answers ${answersPath}`)
    parts.push('```\n')

    const result = parts.join('\n')
    debug('Assembled prompt (%d chars, %d entries)', result.length, entries.size)
    return result
  }

  private hasBlockContexts(entries: Map<string, { contexts: string[] }>): boolean {
    for (const entry of entries.values()) {
      if (entry.contexts.length > 0) return true
    }
    return false
  }
}
