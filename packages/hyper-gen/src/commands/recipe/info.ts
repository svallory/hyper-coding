/**
 * Recipe Info command - Show recipe information
 */

import { Args } from '@oclif/core'
import { BaseCommand } from '#/lib/base-command'
import { outputFlags } from '#/lib/flags'
import { loadRecipe } from '#/recipe-engine/recipe-engine'

export default class RecipeInfo extends BaseCommand<typeof RecipeInfo> {
  static description = 'Show detailed recipe information'

  static examples = [
    '<%= config.bin %> <%= command.id %> my-recipe.yml',
    '<%= config.bin %> <%= command.id %> _recipes/component.yml --json',
  ]

  static flags = {
    ...outputFlags,
  }

  static args = {
    recipe: Args.string({
      description: 'Path to recipe file (.yml or .yaml)',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RecipeInfo)
    const recipePath = args.recipe

    try {
      const result = await loadRecipe(recipePath)
      const recipe = result.recipe

      if (flags.json) {
        this.log(JSON.stringify(recipe, null, 2))
        return
      }

      this.log(`Recipe: ${recipe.name}`)
      this.log(`Version: ${recipe.version || 'unversioned'}`)

      if (recipe.description) {
        this.log(`Description: ${recipe.description}`)
      }

      // Variables
      const variables = Object.entries(recipe.variables || {})
      if (variables.length > 0) {
        this.log('')
        this.log(`Variables (${variables.length}):`)
        for (const [name, varConfig] of variables) {
          let line = `  - ${name}`
          if (typeof varConfig === 'object' && varConfig !== null) {
            const config = varConfig as unknown as Record<string, unknown>
            if (config.type) line += ` (${config.type})`
            if (config.required) line += ' *required*'
            if (config.default !== undefined) line += ` [default: ${config.default}]`
            if (config.description) line += ` - ${config.description}`
          }
          this.log(line)
        }
      }

      // Steps
      if (recipe.steps?.length) {
        this.log('')
        this.log(`Steps (${recipe.steps.length}):`)
        for (let i = 0; i < recipe.steps.length; i++) {
          const step = recipe.steps[i]
          let line = `  ${i + 1}. ${step.name || `Step ${i + 1}`}`
          line += ` [${step.tool}]`
          // Check for condition property (may exist on some step types)
          const stepWithCondition = step as unknown as { condition?: string }
          if (stepWithCondition.condition) line += ' (conditional)'
          this.log(line)
        }
      }

      // Dependencies
      if (recipe.dependencies?.length) {
        this.log('')
        this.log(`Dependencies (${recipe.dependencies.length}):`)
        for (const dep of recipe.dependencies) {
          this.log(`  - ${dep}`)
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.error(`Failed to read recipe: ${message}`)
    }
  }
}
