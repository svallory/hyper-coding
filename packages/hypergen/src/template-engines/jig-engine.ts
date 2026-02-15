/**
 * Jig Template Engine
 *
 * Singleton module wrapping @jig-lang/jig (forked from Edge.js).
 * Jig is purpose-built for code generation: no HTML escaping,
 * automatic indentation management, full JS expressions in templates,
 * and `{{ filter :: value }}` syntax.
 */

import { Edge } from '@jig-lang/jig'
import createDebug from 'debug'
import helpers from '#/helpers'
import { AiCollector } from '#/ai/ai-collector'
import { registerAiTags } from '#//ai-tags.js'

const debug = createDebug('hypergen:template:jig')

export interface JigConfig {
  /** Enable template caching (default: false) */
  cache?: boolean
}

let jig: Edge | null = null

/**
 * Track registered globals for collision warnings.
 * Maps global name -> source string (e.g. "kit:@hyper-kits/nextjs").
 */
const registeredGlobals = new Map<string, string>()

/**
 * Get the Jig (Edge) instance, creating it if needed.
 */
export function getJig(): Edge {
  if (!jig) {
    initializeJig()
  }
  return jig!
}

/**
 * Initialize (or reinitialize) the Jig template engine.
 */
export function initializeJig(config?: JigConfig): void {
  jig = Edge.create({ cache: config?.cache ?? false })
  registeredGlobals.clear()
  registerFilters(jig)
  registerAi2PassTags(jig)
  debug('Jig template engine initialized (cache=%s)', config?.cache ?? false)
}

/**
 * Render a template string with the given context.
 */
export async function renderTemplate(
  template: string,
  context: Record<string, any>,
): Promise<string> {
  const engine = getJig()
  try {
    return await engine.renderRaw(template, context)
  } catch (error: any) {
    throw new Error(`Jig template rendering failed: ${error.message}`)
  }
}

/**
 * Render a template string synchronously.
 */
export function renderTemplateSync(
  template: string,
  context: Record<string, any>,
): string {
  const engine = getJig()
  try {
    return engine.renderRawSync(template, context)
  } catch (error: any) {
    throw new Error(`Jig template rendering failed: ${error.message}`)
  }
}

/**
 * Render a template file with the given context.
 * The templateName is resolved against mounted disk paths.
 */
export async function renderFile(
  templateName: string,
  context: Record<string, any>,
): Promise<string> {
  const engine = getJig()
  try {
    return await engine.render(templateName, context)
  } catch (error: any) {
    throw new Error(`Jig file rendering failed (${templateName}): ${error.message}`)
  }
}

/**
 * Mount a directory so Jig can resolve template files from it.
 */
export function mountDirectory(dirPath: string, diskName?: string): void {
  const engine = getJig()
  if (diskName) {
    engine.mount(diskName, dirPath)
  } else {
    engine.mount(dirPath)
  }
  debug('Mounted directory: %s%s', dirPath, diskName ? ` as "${diskName}"` : '')
}

// ─── Filter Registration ──────────────────────────────────────────────

function registerFilters(edge: Edge): void {
  const { changeCase, inflection } = helpers

  // Case filters — use the change-case library for correctness
  const caseFilters: Record<string, (v: string) => string> = {
    camelCase: (v) => changeCase.camelCase(v),
    pascalCase: (v) => changeCase.pascalCase(v),
    snakeCase: (v) => changeCase.snakeCase(v),
    kebabCase: (v) => changeCase.paramCase(v),
    constantCase: (v) => changeCase.constantCase(v),
    dotCase: (v) => changeCase.dotCase(v),
    pathCase: (v) => changeCase.pathCase(v),
    paramCase: (v) => changeCase.paramCase(v),
  }

  // Inflection filters
  const inflectionFilters: Record<string, (v: string) => string> = {
    pluralize: (v) => inflection.pluralize(v),
    singularize: (v) => inflection.singularize(v),
  }

  // String filters
  const stringFilters: Record<string, (v: string) => string> = {
    capitalize: (v) => helpers.capitalize(v),
    titleize: (v) => inflection.titleize(v),
    humanize: (v) => inflection.humanize(v),
  }

  const allFilters = { ...caseFilters, ...inflectionFilters, ...stringFilters }

  for (const [name, fn] of Object.entries(allFilters)) {
    // Register as filter: {{ name :: camelCase }}
    edge.registerFilter(name, (input: any) => fn(String(input)))
    // Register as global so {{ camelCase(name) }} also works
    edge.global(name, (input: string) => fn(String(input)))
  }

  debug('Registered %d filters + globals', Object.keys(allFilters).length)
}

// ─── Helper Registration ──────────────────────────────────────────────

/**
 * Register helper functions as Jig globals.
 * Warns on collision (last registration wins).
 *
 * @param helpers  Record of name -> function
 * @param source   Human-readable source identifier for collision warnings
 */
export function registerHelpers(
  helpers: Record<string, any>,
  source?: string
): void {
  const engine = getJig()
  for (const [name, value] of Object.entries(helpers)) {
    if (typeof value === 'function') {
      if (registeredGlobals.has(name)) {
        const existingSource = registeredGlobals.get(name)
        console.warn(
          `Warning: Helper "${name}" from ${source ?? 'unknown'} overwrites existing helper from ${existingSource}`
        )
      }
      engine.global(name, value)
      registeredGlobals.set(name, source ?? 'unknown')
    }
  }
  debug('Registered %d helpers from %s', Object.keys(helpers).length, source ?? 'unknown')
}

// ─── AI Tags (2-Pass System) ──────────────────────────────────────────

function registerAi2PassTags(edge: Edge): void {
  try {
    // Register @ai, @context, @prompt, @output tags
    registerAiTags(edge)

    // Register global runtime helpers that compiled tag code calls
    const collector = AiCollector.getInstance()

    edge.global('__hypergenAiCollect', (
      key: string,
      contexts: string[],
      prompt: string,
      outputDesc: string,
      typeHint: string,
      examples: string[],
      sourceFile: string
    ) => {
      collector.addEntry({
        key,
        contexts: contexts.filter(c => c.trim()),
        prompt: prompt.trim(),
        outputDescription: outputDesc.trim(),
        typeHint: typeHint || '',
        examples: (examples || []).filter(e => e.trim()).map(e => e.trim()),
        sourceFile: sourceFile || 'unknown',
      })
    })

    edge.global('__hypergenAddGlobalContext', (text: string) => {
      collector.addGlobalContext(text)
    })

    debug('AI 2-pass tags registered')
  } catch (err) {
    debug('@ai 2-pass tag registration failed: %s', err instanceof Error ? err.message : String(err))
  }
}
