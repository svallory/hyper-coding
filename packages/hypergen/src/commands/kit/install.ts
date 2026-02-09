/**
 * Install a kit from npm or git
 */

import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../lib/base-command.js'
import { execSync } from 'node:child_process'

export default class KitInstall extends BaseCommand<typeof KitInstall> {
  static override description = 'Install a kit from npm or git repository'

  static override examples = [
    '<%= config.bin %> kit install @hyper-kits/starlight',
    '<%= config.bin %> kit install github:user/my-kit',
    '<%= config.bin %> kit install ./local-kit --dev',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    dev: Flags.boolean({
      description: 'Install as a dev dependency',
      default: false,
    }),
    global: Flags.boolean({
      char: 'g',
      description: 'Install globally',
      default: false,
    }),
  }

  static override args = {
    kit: Args.string({
      description: 'Kit to install (npm package, git URL, or local path)',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(KitInstall)

    try {
      this.log(`Installing kit: ${args.kit}`)

      // Determine the package manager
      const pm = this.detectPackageManager()

      // Build the install command
      let cmd: string
      if (pm === 'bun') {
        cmd = flags.global
          ? `bun add -g ${args.kit}`
          : flags.dev
            ? `bun add -d ${args.kit}`
            : `bun add ${args.kit}`
      } else if (pm === 'pnpm') {
        cmd = flags.global
          ? `pnpm add -g ${args.kit}`
          : flags.dev
            ? `pnpm add -D ${args.kit}`
            : `pnpm add ${args.kit}`
      } else if (pm === 'yarn') {
        cmd = flags.global
          ? `yarn global add ${args.kit}`
          : flags.dev
            ? `yarn add -D ${args.kit}`
            : `yarn add ${args.kit}`
      } else {
        cmd = flags.global
          ? `npm install -g ${args.kit}`
          : flags.dev
            ? `npm install -D ${args.kit}`
            : `npm install ${args.kit}`
      }

      this.log(`Running: ${cmd}`)

      execSync(cmd, {
        cwd: flags.cwd,
        stdio: 'inherit',
      })

      this.log(`\n✓ Kit installed successfully: ${args.kit}`)
      this.log(`\nList available recipes with: hypergen recipe list`)

    } catch (error) {
      this.error(`Failed to install kit: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private detectPackageManager(): 'bun' | 'pnpm' | 'yarn' | 'npm' {
    const { existsSync } = require('node:fs')
    const { join } = require('node:path')
    const cwd = this.flags.cwd

    if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) {
      return 'bun'
    }
    if (existsSync(join(cwd, 'pnpm-lock.yaml'))) {
      return 'pnpm'
    }
    if (existsSync(join(cwd, 'yarn.lock'))) {
      return 'yarn'
    }
    return 'npm'
  }
}
