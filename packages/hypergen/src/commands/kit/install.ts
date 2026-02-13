/**
 * Install a kit from npm or git
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../lib/base-command.js'
import { execSync } from 'node:child_process'

/**
 * Validate and shell-escape a kit name/specifier.
 * Allows: scoped packages (@foo/bar), file: prefixes, github: prefixes,
 * git URLs, relative/absolute paths, and version specifiers.
 * Rejects anything with shell metacharacters that could enable injection.
 */
function shellEscapeKitName(kit: string): string {
  // Reject obvious shell injection characters
  const dangerousChars = /[;&|`$(){}!><\n\r]/
  if (dangerousChars.test(kit)) {
    throw new Error(
      `Invalid kit specifier: "${kit}"\n` +
      `Kit names must not contain shell metacharacters.`
    )
  }
  // Wrap in single quotes for shell safety, escaping internal single quotes
  return `'${kit.replace(/'/g, "'\\''")}'`
}

export default class KitInstall extends BaseCommand<typeof KitInstall> {
  static override description = 'Install a kit from npm or git repository'

  static override examples = [
    '<%= config.bin %> kit install @hyper-kits/starlight',
    '<%= config.bin %> kit install github:user/my-kit',
    '<%= config.bin %> kit install ./local-kit --dev',
    '<%= config.bin %> kit install file:../path/to/kit',
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

      // Shell-escape the kit name to prevent command injection
      const escapedKit = shellEscapeKitName(args.kit)

      // Determine the package manager
      const pm = this.detectPackageManager()

      // Build the install command with escaped kit name
      let cmd: string
      if (pm === 'bun') {
        cmd = flags.global
          ? `bun add -g ${escapedKit}`
          : flags.dev
            ? `bun add -d ${escapedKit}`
            : `bun add ${escapedKit}`
      } else if (pm === 'pnpm') {
        cmd = flags.global
          ? `pnpm add -g ${escapedKit}`
          : flags.dev
            ? `pnpm add -D ${escapedKit}`
            : `pnpm add ${escapedKit}`
      } else if (pm === 'yarn') {
        cmd = flags.global
          ? `yarn global add ${escapedKit}`
          : flags.dev
            ? `yarn add -D ${escapedKit}`
            : `yarn add ${escapedKit}`
      } else {
        cmd = flags.global
          ? `npm install -g ${escapedKit}`
          : flags.dev
            ? `npm install -D ${escapedKit}`
            : `npm install ${escapedKit}`
      }

      this.log(`Running: ${cmd}`)

      execSync(cmd, {
        cwd: flags.cwd,
        stdio: 'inherit',
      })

      this.log(`\n✓ Kit installed successfully: ${args.kit}`)
      this.log(`\nList available recipes with: hypergen recipe list`)

    } catch (error: any) {
      // Distinguish our validation errors from execSync errors
      if (error?.message?.startsWith('Invalid kit specifier')) {
        this.error(error.message)
      }

      // Provide helpful error messages for common failures
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('not found') || msg.includes('404')) {
        this.error(
          `Kit not found: ${args.kit}\n\n` +
          `Make sure the package name is correct. For local kits, use:\n` +
          `  hypergen kit install file:./path/to/kit\n` +
          `  hypergen kit install ./path/to/kit`
        )
      }
      if (msg.includes('ENOENT')) {
        this.error(
          `Package manager not found. Make sure bun, pnpm, yarn, or npm is installed.`
        )
      }
      this.error(`Failed to install kit: ${msg}`)
    }
  }

  private detectPackageManager(): 'bun' | 'pnpm' | 'yarn' | 'npm' {
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
