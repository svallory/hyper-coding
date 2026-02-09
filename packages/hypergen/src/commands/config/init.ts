/**
 * Config Init command - Initialize a configuration file
 */

import { Flags } from '@oclif/core'
import { existsSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { BaseCommand } from '../../lib/base-command.js'
import { executionFlags, outputFlags } from '../../lib/flags.js'

export default class ConfigInit extends BaseCommand<typeof ConfigInit> {
  static description = 'Initialize a hypergen configuration file'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --format=ts',
    '<%= config.bin %> <%= command.id %> --minimal',
  ]

  static flags = {
    ...executionFlags,
    ...outputFlags,
    format: Flags.string({
      char: 'f',
      description: 'Configuration file format',
      options: ['js', 'mjs', 'ts', 'json'],
      default: 'js',
    }),
    minimal: Flags.boolean({
      description: 'Create a minimal configuration',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigInit)

    const format = flags.format as 'js' | 'mjs' | 'ts' | 'json'
    const filename = this.getFilename(format)
    const configPath = resolve(flags.cwd, filename)

    if (existsSync(configPath) && !flags.force) {
      this.error(`Configuration file already exists at ${configPath}. Use --force to overwrite.`)
    }

    if (flags.dryRun) {
      this.log(`[DRY RUN] Would create configuration file at: ${configPath}`)
      return
    }

    const content = this.generateConfig(format, flags.minimal)
    writeFileSync(configPath, content)

    if (flags.json) {
      this.log(JSON.stringify({
        success: true,
        path: configPath,
        format,
      }, null, 2))
      return
    }

    this.log(`Configuration file created: ${configPath}`)
    this.log('')
    this.log('Edit this file to customize your hypergen setup.')
  }

  private getFilename(format: 'js' | 'mjs' | 'ts' | 'json'): string {
    switch (format) {
      case 'js':
        return 'hypergen.config.js'
      case 'mjs':
        return 'hypergen.config.mjs'
      case 'ts':
        return 'hypergen.config.ts'
      case 'json':
        return '.hypergenrc.json'
    }
  }

  private generateConfig(format: 'js' | 'mjs' | 'ts' | 'json', minimal: boolean): string {
    if (format === 'json') {
      if (minimal) {
        return JSON.stringify({ templates: 'templates' }, null, 2) + '\n'
      }
      return JSON.stringify({
        templates: 'templates',
        helpers: {},
        plugins: [],
      }, null, 2) + '\n'
    }

    const typeAnnotation = format === 'ts' ? ': import("hypergen").HypergenConfig' : ''
    const jsDocType = format !== 'ts' ? `/** @type {import('hypergen').HypergenConfig} */\n` : ''

    if (minimal) {
      return `${jsDocType}export default${typeAnnotation} {
  templates: 'templates',
}
`
    }

    return `/**
 * Hypergen Configuration
 * See: https://hypergen.dev/docs/configuration
 */

${jsDocType}export default${typeAnnotation} {
  // Directory containing generator templates
  templates: 'templates',

  // Default variables available to all templates
  helpers: {
    // author: 'Your Name',
    // license: 'MIT',
  },

  // Plugins to extend functionality
  plugins: [],

  // URL resolution settings
  // urlResolution: {
  //   cache: true,
  //   cacheDir: '.hypergen-cache',
  // },

  // Template discovery settings
  // discovery: {
  //   sources: ['local', 'npm'],
  //   npmScope: '@your-org',
  // },
}
`
  }
}
