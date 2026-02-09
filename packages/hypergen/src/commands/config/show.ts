/**
 * Config Show command - Show current configuration
 */

import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { BaseCommand } from '../../lib/base-command.js'
import { outputFlags } from '../../lib/flags.js'

export default class ConfigShow extends BaseCommand<typeof ConfigShow> {
  static description = 'Show current hypergen configuration'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    ...outputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigShow)

    const configFiles = [
      'hypergen.config.js',
      'hypergen.config.mjs',
      'hypergen.config.ts',
      '.hypergenrc.js',
      '.hypergenrc.json',
      '.hypergenrc',
    ]

    let foundConfigPath: string | null = null
    for (const file of configFiles) {
      const path = resolve(flags.cwd, file)
      if (existsSync(path)) {
        foundConfigPath = path
        break
      }
    }

    // Get the loaded configuration from base command
    const resolvedConfig = this.hypergenConfig

    if (flags.json) {
      this.log(JSON.stringify({
        configFile: foundConfigPath,
        config: resolvedConfig,
      }, null, 2))
      return
    }

    this.log('Hypergen Configuration')
    this.log('======================')
    this.log('')

    if (foundConfigPath) {
      this.log(`Config File: ${foundConfigPath}`)
    } else {
      this.log('Config File: None found (using defaults)')
    }

    this.log('')
    this.log('Resolved Configuration:')

    if (resolvedConfig) {
      this.logConfig(resolvedConfig as unknown as Record<string, unknown>, '  ')
    } else {
      this.log('  (No configuration loaded)')
    }

    // Show raw file contents if config exists
    if (foundConfigPath && foundConfigPath.endsWith('.json')) {
      this.log('')
      this.log('Raw Configuration:')
      try {
        const content = readFileSync(foundConfigPath, 'utf-8')
        this.log(content)
      } catch {
        this.log('  (Unable to read file)')
      }
    }
  }

  private logConfig(obj: Record<string, unknown>, indent: string): void {
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        this.log(`${indent}${key}: null`)
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        this.log(`${indent}${key}:`)
        this.logConfig(value as Record<string, unknown>, indent + '  ')
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          this.log(`${indent}${key}: []`)
        } else {
          this.log(`${indent}${key}:`)
          for (const item of value) {
            if (typeof item === 'object') {
              this.log(`${indent}  -`)
              this.logConfig(item as Record<string, unknown>, indent + '    ')
            } else {
              this.log(`${indent}  - ${item}`)
            }
          }
        }
      } else {
        this.log(`${indent}${key}: ${value}`)
      }
    }
  }
}
