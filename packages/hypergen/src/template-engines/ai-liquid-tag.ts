/**
 * {% ai %} Custom LiquidJS Tag
 *
 * Inline AI generation within template files.
 * Uses the same AiService as the recipe AI tool.
 *
 * Usage:
 *   {% ai model: "claude-sonnet-4-5", temperature: 0.3, validateSyntax: true %}
 *   Generate CRUD methods for a {{ name }} service.
 *   {% endai %}
 *
 * Supports options:
 *   model, provider, temperature, maxTokens, validateSyntax, fallback
 */

import { Tag, type TagToken, type Context, type TopLevelToken, type Emitter, Tokenizer } from 'liquidjs'
import createDebug from 'debug'
import { AiService } from '../ai/ai-service.js'
import type { AIGuardrailConfig } from '../ai/ai-config.js'

const debug = createDebug('hypergen:template:ai-tag')

/**
 * Parsed options from the tag's argument string
 */
interface AiTagOptions {
  model?: string
  provider?: string
  temperature?: number
  maxTokens?: number
  validateSyntax?: boolean | string
  fallback?: string
  stream?: boolean
}

/**
 * Parse tag arguments like: model: "claude-sonnet-4-5", temperature: 0.3
 */
function parseTagArgs(argsString: string): AiTagOptions {
  const options: AiTagOptions = {}
  if (!argsString || argsString.trim().length === 0) return options

  // Match key: value pairs (values can be quoted strings, numbers, or booleans)
  const pairRegex = /(\w+)\s*:\s*(?:"([^"]*?)"|'([^']*?)'|(\w+[\w.]*?))\s*(?:,|$)/g
  let match: RegExpExecArray | null

  while ((match = pairRegex.exec(argsString)) !== null) {
    const key = match[1]
    const value = match[2] ?? match[3] ?? match[4]

    switch (key) {
      case 'model': options.model = value; break
      case 'provider': options.provider = value; break
      case 'temperature': options.temperature = parseFloat(value); break
      case 'maxTokens': options.maxTokens = parseInt(value, 10); break
      case 'validateSyntax':
        options.validateSyntax = value === 'true' ? true : value === 'false' ? false : value
        break
      case 'fallback': options.fallback = value; break
      case 'stream': options.stream = value === 'true'; break
      default:
        debug('Unknown ai tag option: %s', key)
    }
  }

  return options
}

/**
 * Custom LiquidJS tag for inline AI generation.
 *
 * Register with: liquid.registerTag('ai', AiLiquidTag)
 */
export class AiLiquidTag extends Tag {
  private options: AiTagOptions
  private templates: TopLevelToken[]

  constructor(tagToken: TagToken, remainTokens: TopLevelToken[], liquid: any) {
    super(tagToken, remainTokens, liquid)

    // Parse options from the tag arguments
    this.options = parseTagArgs(tagToken.args)

    // Collect inner tokens until {% endai %}
    this.templates = []
    const stream = this.liquid.parser.parseStream(remainTokens)
    stream
      .on('tag:endai', () => stream.stop())
      .on('template', (tpl: TopLevelToken) => this.templates.push(tpl))
      .on('end', () => {
        throw new Error('{% ai %} tag requires a closing {% endai %} tag')
      })
    stream.start()
  }

  async * render(ctx: Context, emitter: Emitter): AsyncGenerator<string> {
    // Render the inner content (Liquid variables are resolved)
    const promptParts: string[] = []
    for (const tpl of this.templates) {
      const rendered = await this.liquid.renderer.renderTemplates([tpl], ctx)
      promptParts.push(rendered)
    }
    const prompt = promptParts.join('').trim()

    debug('AI tag prompt (%d chars): %s...', prompt.length, prompt.slice(0, 100))

    try {
      // Get AiService instance
      const aiService = AiService.getInstance()

      // Build guardrails from options
      const guardrails: AIGuardrailConfig | undefined = this.options.validateSyntax
        ? {
          validateSyntax: this.options.validateSyntax as any,
          retryOnFailure: 1,
          onFailure: this.options.fallback ? 'fallback' : 'retry',
          fallback: this.options.fallback,
        }
        : undefined

      // Get project root from context (set by template rendering)
      const projectRoot = (ctx.getAll() as any).__projectRoot || process.cwd()

      const result = await aiService.generate({
        prompt,
        model: this.options.model,
        provider: this.options.provider,
        temperature: this.options.temperature,
        maxTokens: this.options.maxTokens,
        stream: this.options.stream,
        guardrails,
        projectRoot,
        stepName: 'ai-liquid-tag',
      })

      debug('AI tag generated %d chars ($%.4f)', result.output.length, result.costUsd)
      yield result.output
    } catch (error: any) {
      debug('AI tag failed: %s', error.message)

      // Use fallback if available
      if (this.options.fallback) {
        debug('Using fallback output')
        yield this.options.fallback
        return
      }

      throw error
    }
  }
}

/**
 * Register the {% ai %} tag with a LiquidJS engine instance
 */
export function registerAiTag(liquid: any): void {
  liquid.registerTag('ai', AiLiquidTag)
  debug('Registered {% ai %} tag')
}
