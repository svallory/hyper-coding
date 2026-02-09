/**
 * List cookbooks in a kit or all installed cookbooks
 */

import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../lib/base-command.js'

export default class CookbookList extends BaseCommand<typeof CookbookList> {
  static override description = 'List cookbooks in a kit or all installed cookbooks'

  static override examples = [
    '<%= config.bin %> cookbook list',
    '<%= config.bin %> cookbook list @hyper-kits/starlight',
    '<%= config.bin %> cookbook list --json',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  }

  static override args = {
    kit: Args.string({
      description: 'Kit to list cookbooks from (optional, lists all if omitted)',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(CookbookList)

    try {
      // Discover all kits
      const kits = await this.discovery.discoverAll()

      // Filter by kit if specified
      const targetKits = args.kit
        ? kits.filter(k =>
            k.name === args.kit ||
            k.name.endsWith(`/${args.kit}`) ||
            k.name === `@hyper-kits/${args.kit}`
          )
        : kits

      if (targetKits.length === 0 && args.kit) {
        this.error(`Kit not found: ${args.kit}`)
      }

      // TODO: Extract cookbooks from kits
      // For now, show a placeholder
      const cookbooks: Array<{ name: string; kit: string; description?: string }> = []

      if (flags.json) {
        this.log(JSON.stringify(cookbooks, null, 2))
        return
      }

      if (cookbooks.length === 0) {
        this.log('No cookbooks found.')
        this.log('\nInstall a kit with: hypergen kit install <kit>')
        return
      }

      this.log('Cookbooks:\n')
      for (const cookbook of cookbooks) {
        this.log(`  ${cookbook.name} (from ${cookbook.kit})`)
        if (cookbook.description) {
          this.log(`    ${cookbook.description}`)
        }
      }
    } catch (error) {
      this.error(`Failed to list cookbooks: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
