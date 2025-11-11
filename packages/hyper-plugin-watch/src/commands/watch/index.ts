import { Command, Flags } from '@oclif/core'
import { WatchService } from '../../services/watch-service.js'
import chalk from 'chalk'

export default class Watch extends Command {
  static override description = 'Monitor agent activity and capture knowledge locally'

  static override examples = [
    '<%= config.bin %> <%= command.id %> --path ./my-project',
    '<%= config.bin %> <%= command.id %> --verbose',
    '<%= config.bin %> <%= command.id %> --db-path ./knowledge-base',
  ]

  static override flags = {
    path: Flags.string({
      char: 'p',
      description: 'Path to monitor (defaults to current directory)',
      default: '.',
    }),
    'db-path': Flags.string({
      char: 'd',
      description: 'Path to local vector database',
      default: './.hyper/knowledge',
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Enable verbose logging',
      default: false,
    }),
    interval: Flags.integer({
      char: 'i',
      description: 'Polling interval in seconds for monitoring',
      default: 5,
    }),
    patterns: Flags.string({
      char: 'f',
      description: 'File patterns to watch (comma-separated)',
      default: '**/*.{ts,js,json,md,yml,yaml}',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Watch)

    this.log(chalk.blue.bold('🔍 HyperDev Watch'))
    this.log(chalk.gray('The always-on agent whisperer\n'))

    const watchService = new WatchService({
      path: flags.path,
      dbPath: flags['db-path'],
      verbose: flags.verbose,
      interval: flags.interval,
      patterns: flags.patterns.split(','),
    })

    try {
      this.log(chalk.green('Starting watch service...'))
      this.log(chalk.gray(`Monitoring: ${flags.path}`))
      this.log(chalk.gray(`Database: ${flags['db-path']}`))
      this.log(chalk.gray(`Patterns: ${flags.patterns}\n`))

      await watchService.start()

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        this.log(chalk.yellow('\n\nShutting down watch service...'))
        await watchService.stop()
        process.exit(0)
      })

      process.on('SIGTERM', async () => {
        await watchService.stop()
        process.exit(0)
      })
    } catch (error) {
      this.error(chalk.red(`Failed to start watch service: ${error}`))
    }
  }
}
