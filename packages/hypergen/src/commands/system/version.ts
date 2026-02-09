/**
 * System Version command - Show version information
 */

import { BaseCommand } from '../../lib/base-command.js'
import { outputFlags } from '../../lib/flags.js'

export default class SystemVersion extends BaseCommand<typeof SystemVersion> {
  static description = 'Show hypergen version information'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    ...outputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(SystemVersion)

    const versionInfo = {
      name: 'hypergen',
      version: this.config.version,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    }

    if (flags.json) {
      this.log(JSON.stringify(versionInfo, null, 2))
      return
    }

    this.log(`hypergen v${versionInfo.version}`)
    this.log(`Node.js ${versionInfo.node}`)
    this.log(`${versionInfo.platform}-${versionInfo.arch}`)
  }
}
