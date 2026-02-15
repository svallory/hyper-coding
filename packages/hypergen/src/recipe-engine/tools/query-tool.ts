/**
 * Query Tool Implementation for Recipe Step System
 *
 * Reads structured data files (JSON, YAML, TOML, .env) and evaluates
 * dot-path checks or expressions against them. Results can be exported
 * to recipe variables for use in subsequent steps.
 */

import fs from 'node:fs'
import path from 'node:path'
import createDebug from 'debug'
import { Tool, type ToolValidationResult } from '#/base.js'
import type {
  QueryStep,
  QueryExecutionResult,
  StepContext,
  StepResult,
  StepExecutionOptions,
} from '#/recipe-engine/types'

const debug = createDebug('hypergen:v8:recipe:tool:query')

/**
 * Auto-detect file format from extension
 */
function detectFormat(filePath: string): QueryStep['format'] {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.json':
      return 'json'
    case '.yml':
    case '.yaml':
      return 'yaml'
    case '.toml':
      return 'toml'
    case '.env':
      return 'env'
    default:
      return undefined
  }
}

/**
 * Parse a .env file into a flat key-value record
 */
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

/**
 * Resolve a dot-path against an object.
 * Supports keys with dots/special chars via bracket-like segments if needed,
 * but the primary use case is simple dot-separated paths like "dependencies.drizzle-orm".
 */
function resolveDotPath(data: any, dotPath: string): { exists: boolean; value: any } {
  const segments = dotPath.split('.')
  let current = data
  for (const segment of segments) {
    if (current == null || typeof current !== 'object') {
      return { exists: false, value: undefined }
    }
    if (!(segment in current)) {
      return { exists: false, value: undefined }
    }
    current = current[segment]
  }
  return { exists: true, value: current }
}

/**
 * Parse file content based on format
 */
async function parseFile(content: string, format: string): Promise<any> {
  switch (format) {
    case 'json':
      return JSON.parse(content)
    case 'yaml': {
      const { parse } = await import('yaml')
      return parse(content)
    }
    case 'toml': {
      // Use a dynamic import; TOML parsing is optional
      try {
        // @ts-ignore -- optional dependency, only needed for TOML files
        const { parse } = await import('smol-toml')
        return parse(content)
      } catch {
        throw new Error('TOML parsing requires the "smol-toml" package. Install it with: bun add smol-toml')
      }
    }
    case 'env':
      return parseEnvFile(content)
    default:
      throw new Error(`Unsupported format: ${format}`)
  }
}

export class QueryTool extends Tool<QueryStep> {
  constructor(name: string = 'query-tool', options: Record<string, any> = {}) {
    super('query', name, options)
  }

  protected async onValidate(step: QueryStep, context: StepContext): Promise<ToolValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const suggestions: string[] = []

    if (!step.file) {
      errors.push('File path is required')
    }

    if (!step.checks && !step.expression) {
      errors.push('Either "checks" or "expression" must be specified')
    }

    if (step.checks && step.expression) {
      warnings.push('Both "checks" and "expression" are specified; both will be evaluated')
    }

    if (step.checks) {
      for (let i = 0; i < step.checks.length; i++) {
        const check = step.checks[i]
        if (!check.path) {
          errors.push(`Check at index ${i} must have a "path"`)
        }
        if (!check.export && !check.exportExists) {
          warnings.push(`Check at index ${i} has no "export" or "exportExists" — result will be discarded`)
        }
      }
    }

    if (step.format && !['json', 'yaml', 'toml', 'env'].includes(step.format)) {
      errors.push(`Unsupported format: ${step.format}. Must be one of: json, yaml, toml, env`)
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions,
      estimatedExecutionTime: 100,
      resourceRequirements: {
        memory: 5 * 1024 * 1024,
        disk: 0,
        network: false,
        processes: 0,
      },
    }
  }

  protected async onExecute(
    step: QueryStep,
    context: StepContext,
    options?: StepExecutionOptions,
  ): Promise<StepResult> {
    const startTime = new Date()
    this.debug('Querying file: %s', step.file)

    try {
      const filePath = path.resolve(context.projectRoot, step.file)
      const format = step.format || detectFormat(step.file)

      if (!format) {
        throw new Error(`Cannot detect format for "${step.file}". Specify "format" explicitly.`)
      }

      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${step.file}`)
      }

      const content = fs.readFileSync(filePath, 'utf-8')
      const data = await parseFile(content, format)

      const queryResult: QueryExecutionResult = {
        file: step.file,
        format,
      }

      const outputVars: Record<string, any> = {}

      // Evaluate checks
      if (step.checks) {
        queryResult.checks = []
        for (const check of step.checks) {
          const resolved = resolveDotPath(data, check.path)
          queryResult.checks.push({
            path: check.path,
            exists: resolved.exists,
            value: resolved.value,
          })
          if (check.export) {
            outputVars[check.export] = resolved.value
          }
          if (check.exportExists) {
            outputVars[check.exportExists] = resolved.exists && resolved.value != null && resolved.value !== false
          }
        }
      }

      // Evaluate expression
      if (step.expression) {
        try {
          const func = new Function('data', `return ${step.expression}`)
          queryResult.value = func(data)
          queryResult.expression = step.expression
        } catch (err: any) {
          throw new Error(`Expression evaluation failed: ${err.message}`)
        }
      }

      const endTime = new Date()
      return {
        status: 'completed',
        stepName: step.name,
        toolType: 'query',
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        retryCount: 0,
        dependenciesSatisfied: true,
        toolResult: queryResult,
        output: Object.keys(outputVars).length > 0 ? outputVars : queryResult.value !== undefined ? { value: queryResult.value } : undefined,
      }
    } catch (error: any) {
      const endTime = new Date()
      return {
        status: 'failed',
        stepName: step.name,
        toolType: 'query',
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        retryCount: 0,
        dependenciesSatisfied: true,
        error: {
          message: error.message,
          code: 'QUERY_FAILED',
          cause: error,
        },
      }
    }
  }
}

export class QueryToolFactory {
  create(name: string = 'query-tool', options: Record<string, any> = {}): QueryTool {
    return new QueryTool(name, options)
  }

  getToolType(): 'query' {
    return 'query'
  }

  validateConfig(config: Record<string, any>): ToolValidationResult {
    return {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: [],
    }
  }
}

export const queryToolFactory = new QueryToolFactory()
