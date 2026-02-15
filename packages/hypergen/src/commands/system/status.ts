/**
 * System Status command - Show system status and configuration
 */

import { existsSync } from 'fs'
import { resolve } from 'path'
import { BaseCommand } from '#/lib/base-command'
import { outputFlags } from '#/lib/flags'

export default class SystemStatus extends BaseCommand<typeof SystemStatus> {
  static description = 'Show hypergen system status and configuration'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    ...outputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(SystemStatus)

    const status = await this.collectStatus()

    if (flags.json) {
      this.log(JSON.stringify(status, null, 2))
      return
    }

    this.log('Hypergen System Status')
    this.log('======================')
    this.log('')

    this.log(`Version: ${status.version}`)
    this.log(`Working Directory: ${status.workingDir}`)
    this.log('')

    this.log('Configuration:')
    this.log(`  Config File: ${status.config.file || 'Not found'}`)
    this.log(`  Templates Directory: ${status.config.templatesDir}`)
    this.log(`  Templates Exist: ${status.config.templatesDirExists ? 'Yes' : 'No'}`)
    this.log('')

    this.log('Discovery:')
    this.log(`  Generators Found: ${status.discovery.generatorsCount}`)
    this.log('')

    this.log('Cache:')
    this.log(`  Cache Directory: ${status.cache.directory}`)
    this.log(`  Cache Exists: ${status.cache.exists ? 'Yes' : 'No'}`)

    if (status.warnings.length > 0) {
      this.log('')
      this.log('Warnings:')
      for (const warning of status.warnings) {
        this.log(`  ⚠ ${warning}`)
      }
    }
  }

  private async collectStatus(): Promise<SystemStatusInfo> {
    const workingDir = this.flags.cwd
    const warnings: string[] = []

    // Get version from package.json (loaded in base command)
    const version = this.config.version

    // Check for config file
    const configFiles = [
      'hypergen.config.js',
      'hypergen.config.mjs',
      'hypergen.config.ts',
      '.hypergenrc.js',
      '.hypergenrc.json',
    ]

    let configFile: string | null = null
    for (const file of configFiles) {
      const path = resolve(workingDir, file)
      if (existsSync(path)) {
        configFile = path
        break
      }
    }

    // Check templates directory
    const templatesDir = resolve(workingDir, 'templates')
    const templatesDirExists = existsSync(templatesDir)

    if (!templatesDirExists) {
      warnings.push('Templates directory not found. Run "hypergen init workspace" to create one.')
    }

    // Count generators and actions
    let generatorsCount = 0

    try {
      const discovered = await this.discovery.discoverAll()
      generatorsCount = discovered.length
    } catch {
      // Discovery failed, keep counts at 0
    }

    // Check cache
    const cacheDir = resolve(workingDir, '.hypergen-cache')
    const cacheExists = existsSync(cacheDir)

    return {
      version,
      workingDir,
      config: {
        file: configFile,
        templatesDir,
        templatesDirExists,
      },
      discovery: {
        generatorsCount,
      },
      cache: {
        directory: cacheDir,
        exists: cacheExists,
      },
      warnings,
    }
  }
}

interface SystemStatusInfo {
  version: string
  workingDir: string
  config: {
    file: string | null
    templatesDir: string
    templatesDirExists: boolean
  }
  discovery: {
    generatorsCount: number
  }
  cache: {
    directory: string
    exists: boolean
  }
  warnings: string[]
}
