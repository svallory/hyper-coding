/**
 * Initialize Hypergen in a project
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../lib/base-command.js'

const DEFAULT_CONFIG = `/**
 * Hypergen Configuration
 * @see https://hypergen.dev/docs/configuration
 */
export default {
  // Directory containing your recipes
  recipesDir: '_recipes',

  // Default variables available to all recipes
  variables: {},

  // Trusted kit sources
  trustedSources: [
    '@hyper-kits/*',
  ],
}
`

export default class Init extends BaseCommand<typeof Init> {
  static override description = 'Initialize Hypergen in the current project'

  static override examples = [
    '<%= config.bin %> init',
    '<%= config.bin %> init --kit @hyper-kits/starlight',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    kit: Flags.string({
      char: 'k',
      description: 'Kit to initialize with',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing configuration',
      default: false,
    }),
  }

  async run(): Promise<{ success: boolean }> {
    const { flags } = await this.parse(Init)

    try {
      this.log('Initializing Hypergen...')

      const configPath = join(flags.cwd, 'hypergen.config.js')
      const recipesDir = join(flags.cwd, '_recipes')

      // Check if already initialized
      if (existsSync(configPath) && !flags.force) {
        this.log('Hypergen is already initialized in this project.')
        this.log('Use --force to reinitialize.')
        return { success: true }
      }

      // Create basic configuration
      writeFileSync(configPath, DEFAULT_CONFIG)
      this.log('✓ Created hypergen.config.js')

      // Create the recipes directory
      if (!existsSync(recipesDir)) {
        mkdirSync(recipesDir, { recursive: true })
        this.log('✓ Created _recipes/ directory')
      }

      // If a kit was specified, install it
      if (flags.kit) {
        this.log(`\nInstalling kit: ${flags.kit}`)
        // Delegate to kit install command
        await this.config.runCommand('kit:install', [flags.kit])
      }

      this.log('\n✓ Hypergen initialized successfully!')
      this.log('\nNext steps:')
      this.log('  1. Install a kit: hypergen kit install <kit>')
      this.log('  2. List recipes: hypergen recipe list')
      this.log('  3. Run a recipe: hypergen run <recipe>')

      return { success: true }
    } catch (error) {
      this.error(`Failed to initialize: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
