/**
 * Install a kit from npm, JSR, GitHub, local paths, or other sources
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../lib/base-command.js'
import { execSync } from 'node:child_process'
import { resolveKitSource, buildInstallCommand } from '../../lib/kit/source-resolver.js'

export default class KitInstall extends BaseCommand<typeof KitInstall> {
  static override description = 'Install a kit from npm, JSR, GitHub, or local path'

  static override examples = [
    '<%= config.bin %> kit install @hyper-kits/nextjs',
    '<%= config.bin %> kit install svallory/hypergen-kit-nextjs',
    '<%= config.bin %> kit install jsr:@std/path',
    '<%= config.bin %> kit install ./local-kit',
    '<%= config.bin %> kit install C:\\\\Projects\\\\my-kit --dev',
    '<%= config.bin %> kit install https://github.com/user/repo.git',
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
      description: 'Kit to install (npm, JSR, GitHub shorthand, git URL, or local path)',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(KitInstall)

    try {
      // Resolve kit source to determine type and normalized source
      const resolved = resolveKitSource(args.kit)

      this.log(`Installing kit: ${args.kit}`)
      this.log(`Source type: ${resolved.type}`)

      // Determine the package manager
      const pm = this.detectPackageManager()

      // Build the install command
      const cmd = buildInstallCommand(resolved, pm, {
        dev: flags.dev,
        global: flags.global,
      })

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
          `Make sure the source is correct. Examples:\n` +
          `  NPM:     hypergen kit install @hyper-kits/nextjs\n` +
          `  GitHub:  hypergen kit install user/repo\n` +
          `  JSR:     hypergen kit install jsr:@std/path\n` +
          `  Local:   hypergen kit install ./path/to/kit`
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
    let dir = this.flags.cwd

    // Walk up the directory tree to find a lock file
    while (dir !== '/' && dir !== '.') {
      // Check for lock files in order of preference
      if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) {
        return 'bun'
      }
      if (existsSync(join(dir, 'pnpm-lock.yaml'))) {
        return 'pnpm'
      }
      if (existsSync(join(dir, 'yarn.lock'))) {
        return 'yarn'
      }
      if (existsSync(join(dir, 'package-lock.json'))) {
        return 'npm'
      }

      // Move up one directory
      const parent = join(dir, '..')
      if (parent === dir) break // Reached root
      dir = parent
    }

    // No lock file found, check which package manager is available
    try {
      execSync('bun --version', { stdio: 'ignore' })
      return 'bun'
    } catch {
      // bun not available
    }

    try {
      execSync('pnpm --version', { stdio: 'ignore' })
      return 'pnpm'
    } catch {
      // pnpm not available
    }

    try {
      execSync('yarn --version', { stdio: 'ignore' })
      return 'yarn'
    } catch {
      // yarn not available
    }

    // Default to npm (should always be available with Node.js)
    return 'npm'
  }
}
