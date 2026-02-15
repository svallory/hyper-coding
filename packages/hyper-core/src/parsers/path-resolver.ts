/**
 * Path Resolver
 *
 * Resolves CLI path segments (e.g., ["nextjs", "crud", "update", "Organization"])
 * into a concrete recipe file path or group directory, with leftover segments
 * becoming positional arguments.
 *
 * Algorithm: greedy path matching — longest filesystem match wins.
 */

import fs from 'fs'
import path from 'path'
import createDebug from 'debug'
import type { ParsedKit } from '#//kit-parser.js'
import type { ParsedCookbook } from '#//cookbook-parser.js'
import { discoverCookbooksInKit, discoverRecipesInCookbook } from '#//cookbook-parser.js'

const debug = createDebug('hypergen:config:path-resolver')

export interface ResolvedPath {
  /** Whether we resolved to a single recipe or a directory group */
  type: 'recipe' | 'group'
  /** Filesystem path to recipe.yml or directory */
  fullPath: string
  /** Kit name (if matched) */
  kit?: string
  /** Cookbook name (if matched) */
  cookbook?: string
  /** Recipe name (if matched) */
  recipe?: string
  /** Path segments that were consumed by resolution */
  consumed: string[]
  /** Leftover segments = positional arguments */
  remaining: string[]
}

export class PathResolver {
  constructor(
    private readonly kits: Map<string, ParsedKit>,
    private readonly searchDirs: string[],
    private readonly cwd: string
  ) {}

  /**
   * Resolve CLI path segments to a recipe or group.
   *
   * @param segments Non-flag CLI arguments (e.g., ["nextjs", "crud", "update", "Org"])
   * @returns Resolved path or null if nothing matched
   */
  async resolve(segments: string[]): Promise<ResolvedPath | null> {
    if (segments.length === 0) return null

    debug('Resolving path segments: %o', segments)

    // 1. Direct file path bypass
    const first = segments[0]
    if (first.startsWith('./') || first.startsWith('../') || first.startsWith('/') || first.endsWith('.yml') || first.endsWith('.yaml')) {
      const resolved = path.resolve(this.cwd, first)
      if (fs.existsSync(resolved)) {
        debug('Direct file path: %s', resolved)
        return {
          type: 'recipe',
          fullPath: resolved,
          consumed: [first],
          remaining: segments.slice(1),
        }
      }
      return null
    }

    // 2. Try kit-based resolution
    const kitResult = await this.resolveViaKit(segments)
    if (kitResult) return kitResult

    // 3. Try search-dir fallback (backward compat: cookbooks/, .hypergen/cookbooks/)
    const fallbackResult = await this.resolveViaSearchDirs(segments)
    if (fallbackResult) return fallbackResult

    // 4. Try slash-separated single arg: "crud/edit-page" -> ["crud", "edit-page"]
    if (segments.length === 1 && segments[0].includes('/')) {
      const split = segments[0].split('/')
      const splitResult = await this.resolve(split)
      if (splitResult) return splitResult
    }

    debug('No resolution found for segments: %o', segments)
    return null
  }

  /**
   * Try to resolve segments starting with a kit name.
   */
  private async resolveViaKit(segments: string[]): Promise<ResolvedPath | null> {
    const kitName = segments[0]
    const kit = this.kits.get(kitName)
    if (!kit) return null

    debug('Matched kit: %s', kitName)

    const kitDir = kit.dirPath
    const remaining = segments.slice(1)

    // If no more segments, use kit defaults
    if (remaining.length === 0) {
      return this.resolveKitDefault(kit, kitName)
    }

    // Discover cookbooks in this kit
    const cookbooks = await discoverCookbooksInKit(
      kitDir,
      kit.config.cookbooks || ['./cookbooks/*/cookbook.yml']
    )

    // Try to match a cookbook
    const cookbookName = remaining[0]
    const cookbook = cookbooks.get(cookbookName)

    if (cookbook) {
      const afterCookbook = remaining.slice(1)

      if (afterCookbook.length === 0) {
        // Just kit + cookbook — use default recipe or treat as group
        return this.resolveCookbookDefault(cookbook, kitName, cookbookName)
      }

      // Try to match a recipe within the cookbook
      const recipes = await discoverRecipesInCookbook(
        cookbook.dirPath,
        cookbook.config.recipes || ['./*/recipe.yml']
      )

      const recipeName = afterCookbook[0]
      const recipeYml = recipes.get(recipeName)

      if (recipeYml) {
        debug('Matched recipe: %s/%s/%s', kitName, cookbookName, recipeName)
        return {
          type: 'recipe',
          fullPath: recipeYml,
          kit: kitName,
          cookbook: cookbookName,
          recipe: recipeName,
          consumed: [kitName, cookbookName, recipeName],
          remaining: afterCookbook.slice(1),
        }
      }

      // No recipe match — the remaining segments are positional args for the default recipe
      // or this is a group execution of the cookbook directory
      const defaultRecipe = cookbook.config.defaults?.recipe
      if (defaultRecipe) {
        const defaultRecipeYml = recipes.get(defaultRecipe)
        if (defaultRecipeYml) {
          debug('Cookbook default recipe: %s/%s/%s with positional args: %o',
            kitName, cookbookName, defaultRecipe, afterCookbook)
          return {
            type: 'recipe',
            fullPath: defaultRecipeYml,
            kit: kitName,
            cookbook: cookbookName,
            recipe: defaultRecipe,
            consumed: [kitName, cookbookName],
            remaining: afterCookbook,
          }
        }
      }

      // Treat as group execution
      debug('Cookbook group execution: %s/%s', kitName, cookbookName)
      return {
        type: 'group',
        fullPath: cookbook.dirPath,
        kit: kitName,
        cookbook: cookbookName,
        consumed: [kitName, cookbookName],
        remaining: afterCookbook,
      }
    }

    // No cookbook match — try greedy filesystem walk within kit dir
    return this.greedyResolve(kitDir, remaining, [kitName], kitName)
  }

  /**
   * Resolve via search directories (backward-compatible fallback).
   */
  private async resolveViaSearchDirs(segments: string[]): Promise<ResolvedPath | null> {
    for (const searchDir of this.searchDirs) {
      if (!fs.existsSync(searchDir)) continue

      const result = await this.greedyResolve(searchDir, segments, [], undefined)
      if (result) return result
    }
    return null
  }

  /**
   * Greedy filesystem walk: try longest match first.
   *
   * Given baseDir and segments [a, b, c]:
   *   Try baseDir/a/b/c/recipe.yml
   *   Try baseDir/a/b/recipe.yml
   *   Try baseDir/a/recipe.yml
   *
   * Longest match with recipe.yml wins. If a directory match with no recipe.yml,
   * it's a group.
   */
  private async greedyResolve(
    baseDir: string,
    segments: string[],
    prefixConsumed: string[],
    kitName?: string
  ): Promise<ResolvedPath | null> {
    // Try longest match first
    for (let len = segments.length; len > 0; len--) {
      const candidate = segments.slice(0, len)
      const dirPath = path.join(baseDir, ...candidate)

      if (!fs.existsSync(dirPath)) continue

      const stat = fs.statSync(dirPath)
      if (!stat.isDirectory()) continue

      const recipeYml = path.join(dirPath, 'recipe.yml')
      if (fs.existsSync(recipeYml)) {
        debug('Greedy match (recipe): %s', recipeYml)
        return {
          type: 'recipe',
          fullPath: recipeYml,
          kit: kitName,
          cookbook: candidate[0],
          recipe: candidate.length > 1 ? candidate[candidate.length - 1] : undefined,
          consumed: [...prefixConsumed, ...candidate],
          remaining: segments.slice(len),
        }
      }

      // Directory exists but no recipe.yml — potential group
      // Only treat as group if this is the longest match
      if (len === segments.length || len === segments.length - 0) {
        // Check if there are recipes inside (it's a valid group)
        const hasRecipes = this.dirContainsRecipes(dirPath)
        if (hasRecipes) {
          debug('Greedy match (group): %s', dirPath)
          return {
            type: 'group',
            fullPath: dirPath,
            kit: kitName,
            cookbook: candidate[0],
            consumed: [...prefixConsumed, ...candidate],
            remaining: segments.slice(len),
          }
        }
      }
    }

    return null
  }

  /**
   * Check if a directory contains any recipe.yml files (immediate children).
   */
  private dirContainsRecipes(dirPath: string): boolean {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const recipeYml = path.join(dirPath, entry.name, 'recipe.yml')
          if (fs.existsSync(recipeYml)) return true
        }
      }
    } catch {
      // Ignore read errors
    }
    return false
  }

  /**
   * Resolve kit default: use defaults.cookbook + defaults.recipe
   */
  private async resolveKitDefault(
    kit: ParsedKit,
    kitName: string
  ): Promise<ResolvedPath | null> {
    const defaults = kit.config.defaults
    if (!defaults?.cookbook) {
      debug('Kit has no default cookbook: %s', kitName)
      return null
    }

    const cookbooks = await discoverCookbooksInKit(
      kit.dirPath,
      kit.config.cookbooks || ['./cookbooks/*/cookbook.yml']
    )

    const cookbook = cookbooks.get(defaults.cookbook)
    if (!cookbook) {
      debug('Kit default cookbook not found: %s/%s', kitName, defaults.cookbook)
      return null
    }

    return this.resolveCookbookDefault(cookbook, kitName, defaults.cookbook)
  }

  /**
   * Resolve cookbook default recipe or group.
   */
  private async resolveCookbookDefault(
    cookbook: ParsedCookbook,
    kitName: string,
    cookbookName: string
  ): Promise<ResolvedPath> {
    const defaultRecipe = cookbook.config.defaults?.recipe
    if (defaultRecipe) {
      const recipes = await discoverRecipesInCookbook(
        cookbook.dirPath,
        cookbook.config.recipes || ['./*/recipe.yml']
      )
      const recipeYml = recipes.get(defaultRecipe)
      if (recipeYml) {
        debug('Cookbook default recipe: %s/%s/%s', kitName, cookbookName, defaultRecipe)
        return {
          type: 'recipe',
          fullPath: recipeYml,
          kit: kitName,
          cookbook: cookbookName,
          recipe: defaultRecipe,
          consumed: [kitName, cookbookName],
          remaining: [],
        }
      }
    }

    // No default recipe — treat as group
    debug('Cookbook has no default recipe, treating as group: %s/%s', kitName, cookbookName)
    return {
      type: 'group',
      fullPath: cookbook.dirPath,
      kit: kitName,
      cookbook: cookbookName,
      consumed: [kitName, cookbookName],
      remaining: [],
    }
  }
}
