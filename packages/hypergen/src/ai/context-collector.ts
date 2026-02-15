/**
 * Context Collector
 *
 * Reads files, config, and previous step results to build the context
 * included in AI prompts. Enforces token budgets.
 */

import createDebug from 'debug'
import fs from 'fs'
import path from 'path'
import { glob } from 'glob'
import type { AIContextConfig } from '#/ai-config.js'
import type { StepResult } from '#/recipe-engine/types'

const debug = createDebug('hypergen:ai:context-collector')

/**
 * A collected context bundle ready for prompt assembly
 */
export interface ContextBundle {
  /** Collected file contents keyed by path */
  files: Map<string, string>
  /** Config file contents keyed by name */
  configs: Map<string, string>
  /** Previous step outputs keyed by step name */
  stepOutputs: Map<string, string>
  /** Total estimated token count */
  estimatedTokens: number
  /** Whether truncation was applied */
  truncated: boolean
}

/**
 * Rough token estimation: ~4 characters per token (conservative).
 * This is intentionally simple — real token counting requires the model's tokenizer.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Known project config file names and their typical locations
 */
const CONFIG_FILE_MAP: Record<string, string[]> = {
  tsconfig: ['tsconfig.json', 'tsconfig.build.json'],
  'package.json': ['package.json'],
  eslint: ['.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', 'eslint.config.js', 'eslint.config.mjs'],
  '.editorconfig': ['.editorconfig'],
}

export class ContextCollector {
  /**
   * Collect context files, configs, and step results based on configuration
   */
  async collect(
    config: AIContextConfig | undefined,
    projectRoot: string,
    stepResults: Map<string, StepResult>
  ): Promise<ContextBundle> {
    const bundle: ContextBundle = {
      files: new Map(),
      configs: new Map(),
      stepOutputs: new Map(),
      estimatedTokens: 0,
      truncated: false,
    }

    if (!config) return bundle

    const maxTokens = config.maxContextTokens ?? Infinity
    let currentTokens = 0

    // 1. Project config files (highest priority — smallest, most relevant)
    if (config.projectConfig) {
      const configNames = config.projectConfig === true
        ? ['tsconfig', 'package.json']
        : config.projectConfig

      for (const name of configNames) {
        const candidates = CONFIG_FILE_MAP[name] || [name]
        for (const candidate of candidates) {
          const filePath = path.resolve(projectRoot, candidate)
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8')
            const tokens = estimateTokens(content)
            if (currentTokens + tokens > maxTokens) {
              bundle.truncated = true
              debug('Skipping config %s: would exceed token budget', name)
              break
            }
            bundle.configs.set(name, content)
            currentTokens += tokens
            debug('Collected config %s (%d tokens)', name, tokens)
            break // use first found
          }
        }
      }
    }

    // 2. Previous step results
    if (config.fromSteps) {
      for (const stepName of config.fromSteps) {
        const result = stepResults.get(stepName)
        if (result?.toolResult) {
          // Serialize step result to include in context
          const content = JSON.stringify(result.toolResult, null, 2)
          const tokens = estimateTokens(content)
          if (currentTokens + tokens > maxTokens) {
            bundle.truncated = true
            debug('Skipping step output %s: would exceed token budget', stepName)
            continue
          }
          bundle.stepOutputs.set(stepName, content)
          currentTokens += tokens
          debug('Collected step output %s (%d tokens)', stepName, tokens)
        }
      }
    }

    // 3. Explicit file paths
    if (config.include) {
      for (const filePath of config.include) {
        const resolved = path.resolve(projectRoot, filePath)
        if (fs.existsSync(resolved)) {
          const content = fs.readFileSync(resolved, 'utf-8')
          const tokens = estimateTokens(content)
          if (currentTokens + tokens > maxTokens) {
            if (config.overflow === 'truncate') {
              const remainingChars = (maxTokens - currentTokens) * 4
              if (remainingChars > 100) {
                bundle.files.set(filePath, content.slice(0, remainingChars) + '\n... [truncated]')
                currentTokens = maxTokens
                bundle.truncated = true
                debug('Truncated file %s to fit budget', filePath)
              }
            } else if (config.overflow === 'error') {
              throw new Error(`Context exceeds token budget (${currentTokens + tokens} > ${maxTokens}). File: ${filePath}`)
            } else {
              bundle.truncated = true
              debug('Skipping file %s: would exceed token budget', filePath)
            }
            continue
          }
          bundle.files.set(filePath, content)
          currentTokens += tokens
          debug('Collected file %s (%d tokens)', filePath, tokens)
        } else {
          debug('Context file not found: %s', resolved)
        }
      }
    }

    // 4. Glob patterns
    if (config.files) {
      for (const pattern of config.files) {
        const matches = await glob(pattern, { cwd: projectRoot, absolute: false })
        for (const match of matches) {
          if (bundle.files.has(match)) continue // avoid duplicates
          const resolved = path.resolve(projectRoot, match)
          if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) continue

          const content = fs.readFileSync(resolved, 'utf-8')
          const tokens = estimateTokens(content)
          if (currentTokens + tokens > maxTokens) {
            bundle.truncated = true
            debug('Skipping glob match %s: would exceed token budget', match)
            continue
          }
          bundle.files.set(match, content)
          currentTokens += tokens
          debug('Collected glob match %s (%d tokens)', match, tokens)
        }
      }
    }

    bundle.estimatedTokens = currentTokens
    debug('Context collection complete: %d files, %d configs, %d step outputs, ~%d tokens, truncated=%s',
      bundle.files.size, bundle.configs.size, bundle.stepOutputs.size, currentTokens, bundle.truncated)

    return bundle
  }
}
