/**
 * Show detailed information about a kit
 */

import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../lib/base-command.js'

export default class KitInfo extends BaseCommand<typeof KitInfo> {
  static override description = 'Show detailed information about a kit'

  static override examples = [
    '<%= config.bin %> kit info @hyper-kits/starlight',
    '<%= config.bin %> kit info starlight --json',
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
      description: 'Kit name or path',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(KitInfo)

    try {
      // Discover all kits and find the requested one
      const kits = await this.discovery.discoverAll()
      const kit = kits.find(k =>
        k.name === args.kit ||
        k.name.endsWith(`/${args.kit}`) ||
        k.name === `@hyper-kits/${args.kit}`
      )

      if (!kit) {
        this.error(`Kit not found: ${args.kit}`)
      }

      if (flags.json) {
        this.log(JSON.stringify(kit, null, 2))
        return
      }

      this.log(`Kit: ${kit.name}`)
      this.log(`─────────────────────────────────────`)

      // TODO: Add description/version when DiscoveredGenerator type supports it

      // Show cookbooks in this kit
      this.log(`\nCookbooks:`)
      // TODO: Implement cookbook listing from kit
      this.log(`  (cookbook discovery not yet implemented)`)

      // Show direct recipes
      this.log(`\nDirect Recipes:`)
      // TODO: Implement recipe listing from kit
      this.log(`  (recipe discovery not yet implemented)`)

    } catch (error) {
      this.error(`Failed to get kit info: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
