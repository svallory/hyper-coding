/**
 * List installed kits
 */

import { Flags } from '@oclif/core'
import { BaseCommand } from '../../lib/base-command.js'
import chalk from 'chalk'

export default class KitList extends BaseCommand<typeof KitList> {
  static override description = 'List installed kits'

  static override examples = [
    '<%= config.bin %> kit list',
    '<%= config.bin %> kit list --json',
    '<%= config.bin %> kit list --verbose',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed information',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(KitList)

    try {
      // Discover installed kits
      const kits = await this.discovery.discoverAll()

      if (flags.json) {
        // Output clean JSON without deprecated fields
        const cleanKits = kits.map(kit => {
          const { actions, ...rest } = kit
          return rest
        })
        this.log(JSON.stringify(cleanKits, null, 2))
        return
      }

      if (kits.length === 0) {
        this.log('No kits installed.')
        this.log('\nInstall a kit with: hypergen kit install <kit>')
        return
      }

      // Group by source for better organization
      const grouped = this.groupBySource(kits)

      for (const [source, sourceKits] of Object.entries(grouped)) {
        if (sourceKits.length === 0) continue

        // Print source header
        this.log(`\n${chalk.bold(this.formatSourceHeader(source))}`)
        this.log(chalk.gray('─'.repeat(60)))

        for (const kit of sourceKits) {
          this.printKit(kit, flags.verbose)
        }
      }

      this.log('') // Empty line at end
    } catch (error) {
      this.error(`Failed to list kits: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private groupBySource(kits: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {
      workspace: [],
      local: [],
      npm: [],
      github: [],
      git: [],
      global: [],
    }

    for (const kit of kits) {
      if (grouped[kit.source]) {
        grouped[kit.source].push(kit)
      }
    }

    return grouped
  }

  private formatSourceHeader(source: string): string {
    const headers: Record<string, string> = {
      workspace: '📁 Workspace',
      local: '💻 Local (.hyper/kits)',
      npm: '📦 NPM Packages',
      github: '🔗 GitHub',
      git: '🌿 Git',
      global: '🌍 Global',
    }
    return headers[source] || source
  }

  private printKit(kit: any, verbose: boolean): void {
    // Title with optional version
    const title = kit.metadata?.version
      ? `${chalk.cyan(kit.name)} ${chalk.gray(`v${kit.metadata.version}`)}`
      : chalk.cyan(kit.name)

    this.log(`\n  ${chalk.bold('Title:')} ${title}`)

    // Description
    if (kit.metadata?.description) {
      this.log(`  ${chalk.bold('Description:')} ${kit.metadata.description}`)
    }

    // Source location
    if (verbose) {
      this.log(`  ${chalk.bold('Source location:')} ${chalk.gray(kit.path)}`)
    }

    // Cookbooks
    if (kit.cookbooks && kit.cookbooks.length > 0) {
      const cookbookList = verbose
        ? kit.cookbooks.join(', ')
        : kit.cookbooks.slice(0, 5).join(', ') + (kit.cookbooks.length > 5 ? `, +${kit.cookbooks.length - 5} more` : '')
      this.log(`  ${chalk.bold('Cookbooks:')} ${cookbookList}`)
    }

    // Recipes (direct recipes)
    if (kit.recipes && kit.recipes.length > 0) {
      const recipeList = verbose
        ? kit.recipes.join(', ')
        : kit.recipes.slice(0, 5).join(', ') + (kit.recipes.length > 5 ? `, +${kit.recipes.length - 5} more` : '')
      this.log(`  ${chalk.bold('Recipes:')} ${recipeList}`)
    }

    // Helpers
    if (verbose && kit.helpers && kit.helpers.length > 0) {
      this.log(`  ${chalk.bold('Helpers:')} ${kit.helpers.join(', ')}`)
    }

    // Additional metadata in verbose mode
    if (verbose) {
      if (kit.metadata?.author) {
        this.log(`  ${chalk.bold('Author:')} ${kit.metadata.author}`)
      }
      if (kit.metadata?.license) {
        this.log(`  ${chalk.bold('License:')} ${kit.metadata.license}`)
      }
      if (kit.metadata?.keywords && kit.metadata.keywords.length > 0) {
        this.log(`  ${chalk.bold('Keywords:')} ${kit.metadata.keywords.join(', ')}`)
      }
      if (kit.metadata?.tags && kit.metadata.tags.length > 0) {
        this.log(`  ${chalk.bold('Tags:')} ${kit.metadata.tags.join(', ')}`)
      }
    }
  }
}
