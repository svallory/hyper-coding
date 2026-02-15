/**
 * Recipe List command - List available recipes from all discovered kits
 */

import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '#/lib/base-command'
import { outputFlags } from '#/lib/flags'
import { c } from '#/lib/colors'
import { s } from '#/lib/styles'
import path from 'path'
import fs from 'fs'
import yaml from 'js-yaml'

interface RecipeInfo {
  name: string
  path: string
  kit: string
  cookbook?: string
  description?: string
  version?: string
  steps?: number
}

export default class RecipeList extends BaseCommand<typeof RecipeList> {
  static description = 'List available recipes from all discovered kits'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> nextjs',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    ...outputFlags,
    kit: Flags.string({
      char: 'k',
      description: 'Filter by kit name',
    }),
    cookbook: Flags.string({
      char: 'c',
      description: 'Filter by cookbook name',
    }),
  }

  static args = {
    kit: Args.string({
      description: 'Kit to list recipes from (optional, lists all if omitted)',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RecipeList)

    try {
      // Discover all kits
      const kits = await this.discovery.discoverAll()

      // Filter by kit if specified (via arg or flag)
      const kitFilter = args.kit || flags.kit
      const targetKits = kitFilter
        ? kits.filter(k =>
            k.name === kitFilter ||
            k.name.endsWith(`/${kitFilter}`) ||
            k.name === `@hyper-kits/${kitFilter}`
          )
        : kits

      if (targetKits.length === 0 && kitFilter) {
        this.error(`Kit not found: ${kitFilter}`)
      }

      // Collect recipes from all target kits
      const recipes: RecipeInfo[] = []

      for (const kit of targetKits) {
        // Get recipes from cookbooks
        if (kit.cookbooks && kit.cookbooks.length > 0) {
          const kitPath = kit.path

          // Look for cookbook directories directly
          const cookbooksDir = path.join(kitPath, 'cookbooks')
          if (!fs.existsSync(cookbooksDir)) {
            continue
          }

          for (const cookbookName of kit.cookbooks) {
            // Filter by cookbook if specified
            if (flags.cookbook && cookbookName !== flags.cookbook) {
              continue
            }

            const cookbookDir = path.join(cookbooksDir, cookbookName)
            const cookbookYml = path.join(cookbookDir, 'cookbook.yml')

            if (!fs.existsSync(cookbookYml)) {
              continue
            }

            // Discover recipes by scanning directories
            const recipeDirs = this.getRecipeDirs(cookbookDir)

            for (const recipeDir of recipeDirs) {
              const recipeName = path.basename(recipeDir)
              const recipePath = path.join(recipeDir, 'recipe.yml')

              if (!fs.existsSync(recipePath)) {
                continue
              }

              // Quick parse just for display info
              const info = this.quickParseRecipe(recipePath)
              recipes.push({
                name: recipeName,
                path: recipePath,
                kit: kit.name,
                cookbook: cookbookName,
                description: info.description,
                version: info.version,
                steps: info.steps,
              })
            }
          }
        }

        // Get direct recipes (not in cookbooks)
        if (kit.recipes && kit.recipes.length > 0) {
          for (const recipeName of kit.recipes) {
            // Try to find the recipe file
            const possiblePaths = [
              path.join(kit.path, 'recipes', recipeName, 'recipe.yml'),
              path.join(kit.path, recipeName, 'recipe.yml'),
              path.join(kit.path, `${recipeName}.yml`),
            ]

            for (const recipePath of possiblePaths) {
              if (fs.existsSync(recipePath)) {
                const info = this.quickParseRecipe(recipePath)
                recipes.push({
                  name: recipeName,
                  path: recipePath,
                  kit: kit.name,
                  description: info.description,
                  version: info.version,
                  steps: info.steps,
                })
                break // Found it, stop trying paths
              }
            }
          }
        }
      }

      // Apply cookbook filter to direct recipes too
      if (flags.cookbook) {
        const filteredRecipes = recipes.filter(r => r.cookbook === flags.cookbook)
        if (filteredRecipes.length === 0) {
          this.error(`Cookbook not found: ${flags.cookbook}`)
        }
        return this.displayRecipes(filteredRecipes, flags)
      }

      this.displayRecipes(recipes, flags)
    } catch (error) {
      this.error(`Failed to list recipes: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Quick parse a recipe file for display purposes
   */
  private quickParseRecipe(recipePath: string): { description?: string; version?: string; steps?: number } {
    try {
      const content = fs.readFileSync(recipePath, 'utf-8')
      const parsed = yaml.load(content) as any

      if (!parsed || typeof parsed !== 'object') {
        return {}
      }

      return {
        description: parsed.description,
        version: parsed.version,
        steps: Array.isArray(parsed.steps) ? parsed.steps.length : undefined,
      }
    } catch {
      return {}
    }
  }

  /**
   * Get recipe directories by scanning for recipe.yml files
   */
  private getRecipeDirs(cookbookDir: string): string[] {
    const recipeDirs: string[] = []

    try {
      const entries = fs.readdirSync(cookbookDir, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const recipeYml = path.join(cookbookDir, entry.name, 'recipe.yml')
          if (fs.existsSync(recipeYml)) {
            recipeDirs.push(path.join(cookbookDir, entry.name))
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return recipeDirs
  }

  private displayRecipes(recipes: RecipeInfo[], flags: { json?: boolean }): void {
    if (flags.json) {
      this.log(JSON.stringify(recipes, null, 2))
      return
    }

    if (recipes.length === 0) {
      this.log(c.warning('No recipes found.'))
      this.log(s.hint('\nInstall a kit with: hypergen kit install <kit>'))
      return
    }

    // Group by kit for display
    const byKit = new Map<string, RecipeInfo[]>()
    for (const recipe of recipes) {
      const kitRecipes = byKit.get(recipe.kit) || []
      kitRecipes.push(recipe)
      byKit.set(recipe.kit, kitRecipes)
    }

    this.log(s.header('Available recipes', recipes.length))
    this.log('')

    for (const [kitName, kitRecipes] of byKit) {
      this.log(c.kit(`${kitName}:`))

      // Group by cookbook within kit
      const byCookbook = new Map<string | undefined, RecipeInfo[]>()
      for (const recipe of kitRecipes) {
        const cbRecipes = byCookbook.get(recipe.cookbook) || []
        cbRecipes.push(recipe)
        byCookbook.set(recipe.cookbook, cbRecipes)
      }

      for (const [cookbookName, cbRecipes] of byCookbook) {
        const prefix = cookbookName ? c.cookbook(`  ${cookbookName}/`) : c.subtle('  (direct)/')
        for (const recipe of cbRecipes) {
          this.log(`  ${prefix}${c.recipe(recipe.name)}`)
          if (recipe.description) {
            this.log(s.description(recipe.description))
          }
        }
      }
      this.log('')
    }
  }
}
