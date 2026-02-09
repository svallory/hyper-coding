/**
 * @deprecated Use `ai-tags.ts` instead. This module provided inline AI generation
 * via the @ai tag. It has been replaced by the 2-pass AI generation system
 * in `ai-tags.ts` which supports @ai/@context/@prompt/@output tags.
 *
 * @ai Custom Jig Tag (Legacy)
 *
 * Inline AI generation within Jig template files.
 * Uses the same AiService as the recipe AI tool.
 *
 * Usage in templates:
 *   @ai({ model: 'claude-sonnet-4-5', temperature: 0.3, validateSyntax: true })
 *   Generate CRUD methods for a {{ name }} service.
 *   @end
 *
 * Supports options:
 *   model, provider, temperature, maxTokens, validateSyntax, fallback, stream
 */

import type { Edge } from '@jig-lang/jig'
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
 * Register the @ai tag with a Jig (Edge) instance.
 *
 * Since Jig uses Edge.js's tag contract which requires compile-time
 * code generation (not async render), we implement @ai as a tag
 * that compiles to a runtime function call.
 */
export function registerAiJigTag(edge: Edge): void {
  edge.registerTag({
    tagName: 'ai',
    block: true,
    seekable: true,

    compile(parser, buffer, token) {
      // The jsArg contains the options object literal, e.g.:
      //   { model: 'claude-sonnet-4-5', temperature: 0.3 }
      const argsExpression = token.properties.jsArg.trim()

      // Process children (the prompt body) through the parser
      // so Jig expressions inside the body are resolved at render time.
      token.children.forEach((child) => {
        parser.processToken(child, buffer)
      })

      // Wrap the body in an async call to our AI generation function.
      // The compiled output captures the rendered prompt text and passes
      // it to the AI service at render time.
      //
      // We use `out` which is the Edge template output variable, and
      // `template` which has access to the shared state.
      buffer.writeStatement(
        `const __aiOpts = ${argsExpression || '{}'};`,
        token.filename,
        token.loc.start.line
      )
      buffer.writeStatement(
        `const __aiPrompt = out;`,
        token.filename,
        token.loc.start.line
      )
      buffer.writeStatement(
        `out = '';`,
        token.filename,
        token.loc.start.line
      )
      // Note: The actual async AI call is handled via a global helper
      // registered below, because Edge.js compile-time tags can't easily
      // do async work in the compiled output. Instead we register a global
      // async function that templates can call.
    },
  })

  // Register global helper for AI generation that the @ai tag calls
  edge.global('__hypergenAiGenerate', async (prompt: string, options: AiTagOptions) => {
    return executeAiGeneration(prompt, options)
  })

  debug('Registered @ai tag')
}

/**
 * Execute AI generation with the given prompt and options
 */
async function executeAiGeneration(prompt: string, options: AiTagOptions): Promise<string> {
  debug('AI tag prompt (%d chars): %s...', prompt.length, prompt.slice(0, 100))

  try {
    const aiService = AiService.getInstance()

    // Build guardrails from options
    const guardrails: AIGuardrailConfig | undefined = options.validateSyntax
      ? {
          validateSyntax: options.validateSyntax as any,
          retryOnFailure: 1,
          onFailure: options.fallback ? 'fallback' : 'retry',
          fallback: options.fallback,
        }
      : undefined

    const projectRoot = process.cwd()

    const result = await aiService.generate({
      prompt,
      model: options.model,
      provider: options.provider,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      stream: options.stream,
      guardrails,
      projectRoot,
      stepName: 'ai-jig-tag',
    })

    debug('AI tag generated %d chars ($%.4f)', result.output.length, result.costUsd)
    return result.output
  } catch (error: any) {
    debug('AI tag failed: %s', error.message)

    // Use fallback if available
    if (options.fallback) {
      debug('Using fallback output')
      return options.fallback
    }

    throw error
  }
}
