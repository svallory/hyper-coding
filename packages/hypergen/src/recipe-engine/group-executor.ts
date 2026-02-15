/**
 * Group Executor
 *
 * Discovers recipes in a directory, builds a dependency graph based on
 * `provides` / required variables, resolves execution order via topological
 * sort, and executes batches — piping providedValues between recipes.
 */

import fs from 'fs'
import path from 'path'
import createDebug from 'debug'
import { RecipeEngine, type RecipeExecutionOptions, type RecipeExecutionResult } from '#/recipe-engine.js'
import type { RecipeConfig, RecipeProvides } from '#/types.js'
import type { TemplateVariable } from '#/config/template-parser'

const debug = createDebug('hypergen:v8:recipe:group-executor')

/**
 * A recipe discovered within a group directory
 */
export interface GroupRecipeEntry {
  /** Recipe name (directory name) */
  name: string
  /** Path to recipe.yml */
  recipeYmlPath: string
  /** Parsed recipe config (loaded lazily) */
  config?: RecipeConfig
}

/**
 * A group of recipes in a directory
 */
export interface RecipeGroup {
  /** Directory path */
  dirPath: string
  /** Discovered recipes */
  recipes: GroupRecipeEntry[]
}

/**
 * Result of a group execution
 */
export interface GroupExecutionResult {
  /** Overall success */
  success: boolean
  /** Per-recipe results, in execution order */
  recipeResults: Array<{
    name: string
    result: RecipeExecutionResult
  }>
  /** Accumulated provided values from all recipes */
  providedValues: Record<string, any>
  /** Total execution duration in ms */
  duration: number
  /** Errors across all recipes */
  errors: string[]
  /** Recipes that require external parameters (not provided by siblings) */
  externalParams: string[]
}

export class GroupExecutor {
  constructor(private readonly recipeEngine: RecipeEngine) {}

  /**
   * Discover all recipes in a directory.
   *
   * Rules:
   * - Scan immediate subdirectories
   * - If a subdirectory has recipe.yml → include it, stop recursion
   * - If a subdirectory has NO recipe.yml → recurse into it
   */
  async discoverGroup(dirPath: string): Promise<RecipeGroup> {
    const recipes: GroupRecipeEntry[] = []

    const scanDir = (dir: string) => {
      if (!fs.existsSync(dir)) return

      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const subDir = path.join(dir, entry.name)
        const recipeYml = path.join(subDir, 'recipe.yml')

        if (fs.existsSync(recipeYml)) {
          recipes.push({
            name: entry.name,
            recipeYmlPath: recipeYml,
          })
        } else {
          // Recurse — this might be a subgroup
          scanDir(subDir)
        }
      }
    }

    scanDir(dirPath)

    debug('Discovered %d recipes in group: %s', recipes.length, dirPath)
    return { dirPath, recipes }
  }

  /**
   * Load all recipe configs in a group.
   */
  async loadGroupConfigs(group: RecipeGroup): Promise<void> {
    for (const entry of group.recipes) {
      if (!entry.config) {
        const loadResult = await this.recipeEngine.loadRecipe({
          type: 'file',
          path: entry.recipeYmlPath,
        })
        entry.config = loadResult.recipe
      }
    }
  }

  /**
   * Build a dependency graph from provides/requires relationships.
   *
   * Returns:
   * - depGraph: Map<recipeName, Set<recipeName it depends on>>
   * - providesMap: Map<varName, recipeName that provides it>
   */
  buildDependencyGraph(
    recipes: GroupRecipeEntry[]
  ): {
    depGraph: Map<string, Set<string>>
    providesMap: Map<string, string>
    errors: string[]
  } {
    const providesMap = new Map<string, string>()
    const depGraph = new Map<string, Set<string>>()
    const errors: string[] = []

    // Collect all provides
    for (const entry of recipes) {
      depGraph.set(entry.name, new Set())

      if (!entry.config?.provides) continue

      for (const p of entry.config.provides) {
        if (providesMap.has(p.name)) {
          errors.push(
            `Variable '${p.name}' is provided by both '${providesMap.get(p.name)}' and '${entry.name}'`
          )
        } else {
          providesMap.set(p.name, entry.name)
        }
      }
    }

    // Build edges: if a recipe requires a variable that another provides, add a dependency
    for (const entry of recipes) {
      if (!entry.config?.variables) continue

      for (const [varName, varDef] of Object.entries(entry.config.variables)) {
        if (!varDef.required || varDef.default !== undefined) continue

        const provider = providesMap.get(varName)
        if (provider && provider !== entry.name) {
          depGraph.get(entry.name)!.add(provider)
          debug('Dependency: %s depends on %s (via %s)', entry.name, provider, varName)
        }
      }
    }

    // Detect circular dependencies
    const cycle = this.detectCycle(depGraph)
    if (cycle) {
      errors.push(`Circular dependency detected: ${cycle.join(' -> ')}`)
    }

    return { depGraph, providesMap, errors }
  }

  /**
   * Topological sort — returns batches of recipes that can run in parallel.
   */
  topologicalSort(depGraph: Map<string, Set<string>>): string[][] {
    const batches: string[][] = []
    const resolved = new Set<string>()
    const remaining = new Set(depGraph.keys())

    while (remaining.size > 0) {
      const batch: string[] = []

      for (const name of remaining) {
        const deps = depGraph.get(name)!
        const allDepsResolved = [...deps].every(d => resolved.has(d))

        if (allDepsResolved) {
          batch.push(name)
        }
      }

      if (batch.length === 0) {
        // Remaining recipes have unresolvable deps — break to avoid infinite loop
        debug('Unresolvable dependencies for: %o', [...remaining])
        break
      }

      // Sort batch alphabetically for deterministic ordering
      batch.sort()
      batches.push(batch)

      for (const name of batch) {
        resolved.add(name)
        remaining.delete(name)
      }
    }

    return batches
  }

  /**
   * Execute all recipes in a group with dependency resolution.
   */
  async executeGroup(
    group: RecipeGroup,
    baseVars: Record<string, any>,
    options: RecipeExecutionOptions = {}
  ): Promise<GroupExecutionResult> {
    const startTime = Date.now()
    const recipeResults: GroupExecutionResult['recipeResults'] = []
    const accumulatedVars: Record<string, any> = { ...baseVars }
    const errors: string[] = []

    // Load all configs
    await this.loadGroupConfigs(group)

    // Build dependency graph
    const { depGraph, providesMap, errors: graphErrors } = this.buildDependencyGraph(group.recipes)
    errors.push(...graphErrors)

    if (graphErrors.length > 0) {
      return {
        success: false,
        recipeResults,
        providedValues: {},
        duration: Date.now() - startTime,
        errors,
        externalParams: [],
      }
    }

    // Compute external params (required by group but not provided by any sibling)
    const externalParams = this.computeExternalParams(group.recipes, providesMap)

    // Topological sort
    const batches = this.topologicalSort(depGraph)
    debug('Execution batches: %o', batches)

    // Create a lookup map
    const recipeMap = new Map(group.recipes.map(r => [r.name, r]))

    // Execute batches
    for (const batch of batches) {
      debug('Executing batch: %o', batch)

      // Within a batch, recipes are independent — run them in parallel
      const batchPromises = batch.map(async (recipeName) => {
        const entry = recipeMap.get(recipeName)!
        try {
          const result = await this.recipeEngine.executeRecipe(
            { type: 'file', path: entry.recipeYmlPath },
            {
              ...options,
              variables: { ...accumulatedVars, ...options.variables },
            }
          )

          // Collect provided values
          if (result.metadata.providedValues) {
            Object.assign(accumulatedVars, result.metadata.providedValues)
          }

          return { name: recipeName, result }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          errors.push(`Recipe '${recipeName}' failed: ${errorMsg}`)
          return {
            name: recipeName,
            result: {
              executionId: '',
              recipe: entry.config!,
              success: false,
              stepResults: [],
              duration: 0,
              filesCreated: [],
              filesModified: [],
              filesDeleted: [],
              errors: [errorMsg],
              warnings: [],
              variables: accumulatedVars,
              metadata: {
                startTime: new Date(),
                endTime: new Date(),
                workingDir: options.workingDir || process.cwd(),
                totalSteps: 0,
                completedSteps: 0,
                failedSteps: 0,
                skippedSteps: 0,
              },
            } as RecipeExecutionResult,
          }
        }
      })

      const batchResults = await Promise.all(batchPromises)
      recipeResults.push(...batchResults)

      // Check for failures
      const failures = batchResults.filter(r => !r.result.success)
      if (failures.length > 0 && !options.continueOnError) {
        debug('Batch had failures, stopping: %o', failures.map(f => f.name))
        break
      }
    }

    return {
      success: errors.length === 0 && recipeResults.every(r => r.result.success),
      recipeResults,
      providedValues: accumulatedVars,
      duration: Date.now() - startTime,
      errors,
      externalParams,
    }
  }

  /**
   * Compute parameters required by the group but not provided by any sibling.
   * These must come from CLI args or user prompts.
   */
  private computeExternalParams(
    recipes: GroupRecipeEntry[],
    providesMap: Map<string, string>
  ): string[] {
    const allRequired = new Set<string>()

    for (const entry of recipes) {
      if (!entry.config?.variables) continue

      for (const [varName, varDef] of Object.entries(entry.config.variables)) {
        if (varDef.required && varDef.default === undefined) {
          allRequired.add(varName)
        }
      }
    }

    // Remove those that are provided by siblings
    for (const provided of providesMap.keys()) {
      allRequired.delete(provided)
    }

    return [...allRequired]
  }

  /**
   * Detect circular dependencies via DFS.
   * Returns the cycle path if found, null otherwise.
   */
  private detectCycle(depGraph: Map<string, Set<string>>): string[] | null {
    const visited = new Set<string>()
    const visiting = new Set<string>()

    const visit = (node: string, path: string[]): string[] | null => {
      if (visiting.has(node)) {
        return [...path, node]
      }
      if (visited.has(node)) return null

      visiting.add(node)
      const deps = depGraph.get(node)
      if (deps) {
        for (const dep of deps) {
          const cycle = visit(dep, [...path, node])
          if (cycle) return cycle
        }
      }
      visiting.delete(node)
      visited.add(node)
      return null
    }

    for (const node of depGraph.keys()) {
      const cycle = visit(node, [])
      if (cycle) return cycle
    }

    return null
  }
}
