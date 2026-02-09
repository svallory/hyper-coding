/**
 * Transport Resolution
 *
 * Maps ai.mode to the appropriate AiTransport instance.
 * Handles 'auto' mode detection based on config.
 */

import createDebug from 'debug'
import { ErrorHandler, ErrorCode } from '../../errors/hypergen-errors.js'
import { StdoutTransport } from './stdout-transport.js'
import { ApiTransport } from './api-transport.js'
import { CommandTransport } from './command-transport.js'
import type { AiServiceConfig } from '../ai-config.js'
import type { AiTransport } from './types.js'

const debug = createDebug('hypergen:ai:transport:resolve')

/** Well-known env vars checked during auto-detection */
const WELL_KNOWN_API_KEY_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
]

/**
 * Resolve the AI transport to use based on config and mode.
 *
 * Pure function — no side effects.
 */
export function resolveTransport(config: AiServiceConfig | undefined): AiTransport {
  const mode = config?.mode ?? 'auto'

  debug('Resolving transport for mode: %s', mode)

  switch (mode) {
    case 'api':
      validateApiConfig(config)
      return new ApiTransport()

    case 'command':
      validateCommandConfig(config)
      return new CommandTransport()

    case 'stdout':
      return new StdoutTransport()

    case 'off':
      // Same as stdout for now; future: interactive prompts
      return new StdoutTransport()

    case 'auto':
      return autoDetect(config)

    default: {
      // Exhaustive check
      const _never: never = mode
      throw ErrorHandler.createError(
        ErrorCode.AI_TRANSPORT_FAILED,
        `Unknown AI mode: '${_never}'`,
        {}
      )
    }
  }
}

/**
 * Auto-detect the best transport based on what's configured.
 *
 * Priority:
 * 1. Provider + API key available → ApiTransport
 * 2. ai.command set → CommandTransport
 * 3. Otherwise → StdoutTransport
 */
function autoDetect(config: AiServiceConfig | undefined): AiTransport {
  if (config && hasApiKeyAvailable(config)) {
    debug('Auto-detected: api (provider + API key available)')
    return new ApiTransport()
  }

  if (config?.command) {
    debug('Auto-detected: command (ai.command is set)')
    return new CommandTransport()
  }

  debug('Auto-detected: stdout (no API key or command configured)')
  return new StdoutTransport()
}

/**
 * Check if an API key is available for the configured provider.
 */
function hasApiKeyAvailable(config: AiServiceConfig): boolean {
  if (!config.provider) return false

  // Explicit apiKey in config
  if (config.apiKey) {
    // If it's an env var reference, check if the env var exists
    if (config.apiKey.startsWith('$')) {
      const envVar = config.apiKey.slice(1)
      return !!process.env[envVar]
    }
    // Direct value (not recommended but valid)
    return true
  }

  // Check well-known env vars
  return WELL_KNOWN_API_KEY_VARS.some(v => !!process.env[v])
}

function validateApiConfig(config: AiServiceConfig | undefined): void {
  if (!config?.provider) {
    throw ErrorHandler.createError(
      ErrorCode.AI_TRANSPORT_FAILED,
      "AI mode 'api' requires ai.provider to be set in config",
      {},
      [
        {
          title: 'Set AI provider',
          description: "Add ai.provider to hypergen.config.js (e.g., 'anthropic', 'openai')",
        },
      ]
    )
  }

  if (!hasApiKeyAvailable(config)) {
    throw ErrorHandler.createError(
      ErrorCode.AI_API_KEY_MISSING,
      `AI mode 'api' requires an API key for provider '${config.provider}'`,
      {},
      [
        {
          title: 'Set API key environment variable',
          description: 'Set the appropriate environment variable (e.g., ANTHROPIC_API_KEY)',
        },
        {
          title: 'Configure in hypergen.config.js',
          description: 'Set ai.apiKey to an env var reference like "$ANTHROPIC_API_KEY"',
        },
      ]
    )
  }
}

function validateCommandConfig(config: AiServiceConfig | undefined): void {
  if (!config?.command) {
    throw ErrorHandler.createError(
      ErrorCode.AI_TRANSPORT_FAILED,
      "AI mode 'command' requires ai.command to be set in config",
      {},
      [
        {
          title: 'Set AI command',
          description: "Add ai.command to hypergen.config.js (e.g., 'claude -p {prompt}', 'llm')",
        },
      ]
    )
  }
}
