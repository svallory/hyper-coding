/**
 * AI Collector
 *
 * Singleton that accumulates AI block data (@ai/@context/@prompt/@output)
 * across all templates during a single generation run.
 *
 * In the 2-pass system:
 *   Pass 1 (collect mode): Templates render but @ai blocks collect their
 *          data here instead of producing output. No files are written.
 *   Pass 2 (answers mode): Templates resolve @ai blocks from provided
 *          answers. Files are written normally.
 */

import createDebug from 'debug'

const debug = createDebug('hypergen:ai:collector')

/**
 * Data collected from a single @ai block in a template
 */
export interface AiBlockEntry {
  /** JSON property name the LLM fills in (from @ai({ key })) */
  key: string

  /** Rendered @context bodies within this @ai block */
  contexts: string[]

  /** Rendered @prompt body */
  prompt: string

  /** Rendered @output body (format description) */
  outputDescription: string

  /** Advisory type hint for the output (e.g. 'jsx-fragment', 'sql', 'json') */
  typeHint: string

  /** Rendered @example bodies (concrete examples of expected output) */
  examples: string[]

  /** Which template file this block came from */
  sourceFile: string
}

/**
 * Accumulates AI block data across all templates in a single run.
 * Follows the same singleton pattern as AiService.
 */
export class AiCollector {
  private static instance: AiCollector | null = null

  /** Whether we're in Pass 1 (collecting) or not */
  collectMode = false

  private globalContexts: string[] = []
  private entries = new Map<string, AiBlockEntry>()

  private constructor() {}

  static getInstance(): AiCollector {
    if (!AiCollector.instance) {
      AiCollector.instance = new AiCollector()
    }
    return AiCollector.instance
  }

  static reset(): void {
    AiCollector.instance = null
  }

  addGlobalContext(text: string): void {
    if (text.trim()) {
      this.globalContexts.push(text.trim())
      debug('Added global context (%d chars)', text.length)
    }
  }

  addEntry(entry: AiBlockEntry): void {
    if (this.entries.has(entry.key)) {
      debug('Warning: duplicate AI block key "%s" — overwriting (source: %s)', entry.key, entry.sourceFile)
    }
    this.entries.set(entry.key, entry)
    debug('Added AI block entry "%s" from %s', entry.key, entry.sourceFile)
  }

  hasEntries(): boolean {
    return this.entries.size > 0
  }

  getGlobalContexts(): string[] {
    return [...this.globalContexts]
  }

  getEntries(): Map<string, AiBlockEntry> {
    return new Map(this.entries)
  }

  clear(): void {
    this.globalContexts = []
    this.entries.clear()
    this.collectMode = false
    debug('Collector cleared')
  }
}
