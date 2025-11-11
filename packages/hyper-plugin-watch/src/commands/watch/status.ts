import { Command, Flags } from '@oclif/core'
import chalk from 'chalk'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export default class WatchStatus extends Command {
  static override description = 'Display current watch service status and statistics'

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --db-path ./knowledge-base',
  ]

  static override flags = {
    'db-path': Flags.string({
      char: 'd',
      description: 'Path to local vector database',
      default: './.hyper/knowledge',
    }),
    json: Flags.boolean({
      description: 'Output status as JSON',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(WatchStatus)

    const statusFile = join(flags['db-path'], 'status.json')

    if (!existsSync(statusFile)) {
      this.log(chalk.yellow('⚠️  Watch service is not running or has no status data'))
      this.log(chalk.gray(`Status file not found: ${statusFile}`))
      return
    }

    try {
      const statusData = JSON.parse(readFileSync(statusFile, 'utf-8'))

      if (flags.json) {
        this.log(JSON.stringify(statusData, null, 2))
        return
      }

      this.log(chalk.blue.bold('📊 Watch Service Status\n'))
      this.log(chalk.green('Status:'), statusData.running ? '🟢 Running' : '🔴 Stopped')
      this.log(chalk.green('Uptime:'), this.formatUptime(statusData.uptime))
      this.log(chalk.green('Files Watched:'), statusData.filesWatched)
      this.log(chalk.green('Changes Detected:'), statusData.changesDetected)
      this.log(chalk.green('Knowledge Entries:'), statusData.knowledgeEntries)
      this.log(chalk.green('Last Update:'), new Date(statusData.lastUpdate).toLocaleString())

      if (statusData.errors && statusData.errors.length > 0) {
        this.log(chalk.red('\n⚠️  Recent Errors:'))
        statusData.errors.slice(-5).forEach((error: string) => {
          this.log(chalk.red(`  • ${error}`))
        })
      }
    } catch (error) {
      this.error(chalk.red(`Failed to read status: ${error}`))
    }
  }

  private formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    return `${hours}h ${minutes}m ${secs}s`
  }
}
