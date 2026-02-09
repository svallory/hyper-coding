/**
 * List installed kits
 */

import { Flags } from '@oclif/core'
import { BaseCommand } from '../../lib/base-command.js'

export default class KitList extends BaseCommand<typeof KitList> {
  static override description = 'List installed kits'

  static override examples = [
    '<%= config.bin %> kit list',
    '<%= config.bin %> kit list --json',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(KitList)

    try {
      // Discover installed kits
      const kits = await this.discovery.discoverAll()

      if (flags.json) {
        this.log(JSON.stringify(kits, null, 2))
        return
      }

      if (kits.length === 0) {
        this.log('No kits installed.')
        this.log('\nInstall a kit with: hypergen kit install <kit>')
        return
      }

      this.log('Installed Kits:\n')
      for (const kit of kits) {
        this.log(`  ${kit.name}`)
        // TODO: Add description when DiscoveredGenerator type supports it
      }
    } catch (error) {
      this.error(`Failed to list kits: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
