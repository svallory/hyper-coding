/**
 * Prompt Assembler
 *
 * Takes AiCollector data and produces a self-contained markdown document
 * that an AI agent (or human) can read, answer, and save as JSON.
 *
 * Uses a Jig template internally — the same engine Hypergen users write
 * templates in.  A custom template path can be provided via the
 * `ai.promptTemplate` config key or `--prompt-template` CLI flag.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import createDebug from 'debug'
import { renderTemplateSync } from '../template-engines/jig-engine.js'
import type { AiBlockEntry, AiCollector } from './ai-collector.js'

const debug = createDebug('hypergen:ai:prompt-assembler')

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Path to the built-in prompt template shipped with Hypergen */
const DEFAULT_TEMPLATE_PATH = path.join(__dirname, 'prompt-template.jig')

export interface AssemblerOptions {
  /** The original command that was run (for the callback instruction) */
  originalCommand: string

  /** Suggested path for the answers JSON file */
  answersPath?: string

  /**
   * Path to a custom Jig prompt template.
   * When provided, this template is used instead of the built-in one.
   */
  promptTemplate?: string
}

export class PromptAssembler {
  assemble(collector: AiCollector, options: AssemblerOptions): string {
    const globalContexts = collector.getGlobalContexts()
    const entriesMap = collector.getEntries()
    const answersPath = options.answersPath || './ai-answers.json'

    // Convert Map to array for Jig @each iteration
    const entries: (AiBlockEntry & { hasOutputDesc: boolean; hasExamples: boolean })[] = []
    for (const [, entry] of entriesMap) {
      entries.push({
        ...entry,
        hasOutputDesc: !!entry.outputDescription.trim(),
        hasExamples: (entry.examples && entry.examples.length > 0) || false,
      })
    }

    // Build the JSON response schema
    const schema: Record<string, string> = {}
    for (const entry of entries) {
      schema[entry.key] = (entry.hasOutputDesc || entry.hasExamples) ? '<see format above>' : '<your answer>'
    }
    const responseSchema = JSON.stringify(schema, null, 2)

    const hasContext = globalContexts.length > 0 || entries.some(e => e.contexts.length > 0)

    const templatePath = options.promptTemplate || DEFAULT_TEMPLATE_PATH
    const templateSource = this.loadTemplate(templatePath, !!options.promptTemplate)

    const context = {
      globalContexts,
      entries,
      responseSchema,
      hasContext,
      originalCommand: options.originalCommand,
      answersPath,
    }

    try {
      const result = renderTemplateSync(templateSource, context)
      debug('Assembled prompt (%d chars, %d entries)', result.length, entries.length)
      return result
    } catch (error: any) {
      throw new Error(`Failed to render prompt template: ${error.message}`)
    }
  }

  private loadTemplate(templatePath: string, isCustom: boolean): string {
    try {
      return fs.readFileSync(templatePath, 'utf-8')
    } catch {
      if (isCustom) {
        throw new Error(
          `Custom prompt template not found: ${templatePath}\n` +
          `Provide an absolute path or a path relative to the working directory.`
        )
      }
      throw new Error(`Built-in prompt template missing: ${templatePath}`)
    }
  }
}
