import {Command, Flags} from '@oclif/core'
import {HypergenCLI} from 'hypergen/src/cli/cli.js'

export default class Gen extends Command {
  static description = 'Generate code from templates using Hypergen'

  static examples = [
    '<%= config.bin %> <%= command.id %> component MyComponent',
    '<%= config.bin %> <%= command.id %> --help',
  ]

  static flags = {
    debug: Flags.boolean({
      description: 'Enable debug mode',
      default: false,
    }),
    verbose: Flags.boolean({
      description: 'Enable verbose output',
      default: false,
    }),
    config: Flags.string({
      description: 'Path to config file',
    }),
  }

  // Allow any arguments to be passed through to hypergen
  static strict = false

  public async run(): Promise<void> {
    const {flags, argv} = await this.parse(Gen)

    const config = {
      cwd: process.cwd(),
      debug: flags.debug || !!process.env.DEBUG,
      verbose: flags.verbose || !!process.env.VERBOSE,
      configPath: flags.config || process.env.HYPERGEN_CONFIG,
    }

    try {
      const cli = new HypergenCLI(config)
      await cli.initialize()
      const result = await cli.execute(argv as string[])

      if (result.success) {
        if (result.message) {
          this.log(result.message)
        }
      } else {
        if (result.message) {
          this.error(result.message, {exit: 1})
        } else {
          this.error('Command failed', {exit: 1})
        }
      }
    } catch (error: any) {
      this.error(error.message, {exit: 1})
    }
  }
}
