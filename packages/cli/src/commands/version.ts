import {Command, Flags} from '@oclif/core'

export default class Version extends Command {
  static description = 'Display version information'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed version information',
    }),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Version)

    if (flags.verbose) {
      this.log(`${this.config.name} v${this.config.version}`)
      this.log(`Node: ${process.version}`)
      this.log(`OS: ${process.platform} ${process.arch}`)
    } else {
      this.log(this.config.version)
    }
  }
}
