/**
 * Recipe List command - List available recipes
 */

import { Args } from '@oclif/core'
import { readdirSync, statSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { BaseCommand } from '../../lib/base-command.js'
import { outputFlags } from '../../lib/flags.js'
import { loadRecipe } from '../../recipe-engine/recipe-engine.js'

export default class RecipeList extends BaseCommand<typeof RecipeList> {
  static description = 'List available recipes in a directory'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> _recipes',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    ...outputFlags,
  }

  static args = {
    directory: Args.string({
      description: 'Directory to search for recipes',
      required: false,
      default: '_recipes',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RecipeList)
    const directory = resolve(this.flags.cwd, args.directory)

    const recipes: Array<{
      name: string
      path: string
      description?: string
      version?: string
      steps?: number
    }> = []

    // Find all .yml and .yaml files
    if (existsSync(directory)) {
      await this.findRecipes(directory, recipes)
    }

    // Also check current directory for recipe files
    if (existsSync(this.flags.cwd)) {
      await this.findRecipes(this.flags.cwd, recipes, false)
    }

    if (flags.json) {
      this.log(JSON.stringify(recipes, null, 2))
      return
    }

    if (recipes.length === 0) {
      this.log('No recipes found.')
      this.log(`Searched in: ${directory}`)
      this.log('')
      this.log('Create a recipe file (*.yml) in _recipes/ directory.')
      return
    }

    this.log(`Available recipes:`)
    this.log('')

    for (const recipe of recipes) {
      this.log(`  ${recipe.name}`)
      this.log(`    Path: ${recipe.path}`)
      if (recipe.description) {
        this.log(`    Description: ${recipe.description}`)
      }
      if (recipe.version) {
        this.log(`    Version: ${recipe.version}`)
      }
      if (recipe.steps !== undefined) {
        this.log(`    Steps: ${recipe.steps}`)
      }
      this.log('')
    }
  }

  private async findRecipes(
    dir: string,
    results: Array<{ name: string; path: string; description?: string; version?: string; steps?: number }>,
    recursive = true
  ): Promise<void> {
    try {
      const entries = readdirSync(dir)

      for (const entry of entries) {
        const fullPath = join(dir, entry)

        try {
          const stat = statSync(fullPath)

          if (stat.isFile() && (entry.endsWith('.yml') || entry.endsWith('.yaml'))) {
            // Skip template.yml files
            if (entry === 'template.yml' || entry === 'template.yaml') continue

            try {
              const result = await loadRecipe(fullPath)
              const recipe = result.recipe
              // Only include if it has recipe structure (name or steps)
              if (recipe.name || recipe.steps) {
                results.push({
                  name: recipe.name || entry.replace(/\.ya?ml$/, ''),
                  path: fullPath,
                  description: recipe.description,
                  version: recipe.version,
                  steps: recipe.steps?.length,
                })
              }
            } catch {
              // Skip files that aren't valid recipes
            }
          } else if (stat.isDirectory() && recursive) {
            // Recurse into subdirectories
            if (!entry.startsWith('.') && entry !== 'node_modules') {
              await this.findRecipes(fullPath, results)
            }
          }
        } catch {
          // Skip inaccessible entries
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }
}
