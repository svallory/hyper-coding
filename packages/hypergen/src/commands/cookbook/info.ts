/**
 * Show detailed information about a cookbook
 */

import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../lib/base-command.js'

export default class CookbookInfo extends BaseCommand<typeof CookbookInfo> {
  static override description = 'Show detailed information about a cookbook'

  static override examples = [
    '<%= config.bin %> cookbook info starlight',
    '<%= config.bin %> cookbook info @hyper-kits/starlight/docs --json',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  }

  static override args = {
    cookbook: Args.string({
      description: 'Cookbook name or path',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(CookbookInfo)

    try {
      // TODO: Implement cookbook discovery and info
      // For now, show a placeholder

      const cookbookInfo = {
        name: args.cookbook,
        description: 'Cookbook info not yet implemented',
        recipes: [],
      }

      if (flags.json) {
        this.log(JSON.stringify(cookbookInfo, null, 2))
        return
      }

      this.log(`Cookbook: ${cookbookInfo.name}`)
      this.log(`─────────────────────────────────────`)
      this.log(`\nDescription: ${cookbookInfo.description}`)

      this.log(`\nRecipes:`)
      if (cookbookInfo.recipes.length === 0) {
        this.log(`  (no recipes found)`)
      } else {
        for (const recipe of cookbookInfo.recipes) {
          this.log(`  ${recipe}`)
        }
      }

    } catch (error) {
      this.error(`Failed to get cookbook info: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
