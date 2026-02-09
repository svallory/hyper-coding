/**
 * Model Router
 *
 * Resolves AI provider + model, manages fallback chains,
 * and dynamically imports Vercel AI SDK provider packages.
 */

import createDebug from 'debug'
import { ErrorHandler, ErrorCode } from '../errors/hypergen-errors.js'
import type { AiServiceConfig, AIModelRef } from './ai-config.js'

const debug = createDebug('hypergen:ai:model-router')

/**
 * A resolved provider instance that can be passed to Vercel AI SDK
 */
export interface ResolvedModel {
  /** The Vercel AI SDK model instance */
  model: any
  /** Provider name */
  provider: string
  /** Model name */
  modelName: string
}

/**
 * Infer provider name from model string.
 * e.g., 'claude-sonnet-4-5' → 'anthropic', 'gpt-4o' → 'openai'
 */
function inferProvider(model: string): string {
  if (model.startsWith('claude')) return 'anthropic'
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return 'openai'
  if (model.startsWith('gemini')) return 'google'
  if (model.startsWith('llama') || model.startsWith('mistral') || model.startsWith('codellama')) return 'ollama'
  return 'openai' // fallback assumption
}

/**
 * Resolve API key from config.
 * Strings starting with '$' are resolved from environment variables.
 */
function resolveApiKey(apiKey: string | undefined, provider: string): string | undefined {
  if (!apiKey) {
    // Try common env var names
    const envVarNames: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    }
    const envVar = envVarNames[provider]
    if (envVar) {
      return process.env[envVar]
    }
    return undefined
  }

  if (apiKey.startsWith('$')) {
    const envVar = apiKey.slice(1)
    return process.env[envVar]
  }

  return apiKey
}

/**
 * Dynamically import a Vercel AI SDK provider and create a model instance
 */
async function createModelInstance(provider: string, modelName: string, apiKey?: string): Promise<any> {
  debug('Creating model instance: provider=%s, model=%s', provider, modelName)

  switch (provider) {
    case 'anthropic': {
      try {
        // @ts-ignore - Optional dependency, will be checked at runtime
        const { createAnthropic } = await import('@ai-sdk/anthropic')
        const anthropic = createAnthropic({ apiKey })
        return anthropic(modelName)
      } catch (e: any) {
        if (e.code === 'ERR_MODULE_NOT_FOUND' || e.code === 'MODULE_NOT_FOUND') {
          throw ErrorHandler.createError(
            ErrorCode.AI_PROVIDER_UNAVAILABLE,
            `Anthropic provider not installed. Run: bun add @ai-sdk/anthropic`,
            {}
          )
        }
        throw e
      }
    }

    case 'openai': {
      try {
        // @ts-ignore - Optional dependency, will be checked at runtime
        const { createOpenAI } = await import('@ai-sdk/openai')
        const openai = createOpenAI({ apiKey })
        return openai(modelName)
      } catch (e: any) {
        if (e.code === 'ERR_MODULE_NOT_FOUND' || e.code === 'MODULE_NOT_FOUND') {
          throw ErrorHandler.createError(
            ErrorCode.AI_PROVIDER_UNAVAILABLE,
            `OpenAI provider not installed. Run: bun add @ai-sdk/openai`,
            {}
          )
        }
        throw e
      }
    }

    default:
      throw ErrorHandler.createError(
        ErrorCode.AI_PROVIDER_UNAVAILABLE,
        `Unsupported AI provider: "${provider}". Install and configure the @ai-sdk/${provider} package.`,
        {}
      )
  }
}

export class ModelRouter {
  constructor(private readonly config: AiServiceConfig) {}

  /**
   * Resolve a model instance for a given step, with fallback chain.
   *
   * @param stepProvider Provider override from step config
   * @param stepModel Model override from step config
   * @param stepApiKey API key override from step config
   * @returns ResolvedModel ready for Vercel AI SDK
   */
  async resolve(stepProvider?: string, stepModel?: string, stepApiKey?: string): Promise<ResolvedModel> {
    const modelName = stepModel || this.config.model
    if (!modelName) {
      throw ErrorHandler.createError(
        ErrorCode.AI_PROVIDER_UNAVAILABLE,
        'No AI model configured. Set ai.model in hypergen.config.js or specify model in the AI step.',
        {}
      )
    }

    const provider = stepProvider || this.config.provider || inferProvider(modelName)
    const apiKey = resolveApiKey(stepApiKey || this.config.apiKey, provider)

    // Try primary model
    try {
      const model = await createModelInstance(provider, modelName, apiKey)
      return { model, provider, modelName }
    } catch (primaryError: any) {
      debug('Primary model failed: %s', primaryError.message)

      // Try fallback models
      const fallbacks = this.config.fallbackModels || []
      for (const fallback of fallbacks) {
        try {
          const fallbackApiKey = resolveApiKey(fallback.apiKey, fallback.provider)
          const model = await createModelInstance(fallback.provider, fallback.model, fallbackApiKey)
          debug('Using fallback model: %s/%s', fallback.provider, fallback.model)
          return { model, provider: fallback.provider, modelName: fallback.model }
        } catch (fallbackError: any) {
          debug('Fallback model %s/%s failed: %s', fallback.provider, fallback.model, fallbackError.message)
        }
      }

      // All models failed
      throw primaryError
    }
  }
}
