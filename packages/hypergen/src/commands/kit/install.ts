/**
 * Install a kit from npm, JSR, GitHub, local paths, or other sources
 */

import { existsSync, mkdirSync, cpSync } from 'node:fs'
import { join, basename, isAbsolute, resolve } from 'node:path'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../lib/base-command.js'
import { execSync } from 'node:child_process'
import { resolveKitSource, buildInstallCommand } from '../../lib/kit/source-resolver.js'
import {
  addKitToManifest,
  isKitInstalled,
  extractPackageVersion,
  type KitManifestEntry,
} from '../../lib/kit/manifest.js'
import tiged from 'tiged'

export default class KitInstall extends BaseCommand<typeof KitInstall> {
  static override description = 'Install a kit from npm, JSR, GitHub, or local path'

  static override examples = [
    '<%= config.bin %> kit install @hyper-kits/nextjs',
    '<%= config.bin %> kit install svallory/hypergen-kit-nextjs',
    '<%= config.bin %> kit install jsr:@std/path',
    '<%= config.bin %> kit install ./local-kit',
    '<%= config.bin %> kit install C:\\\\Projects\\\\my-kit',
    '<%= config.bin %> kit install https://github.com/user/repo.git',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    dev: Flags.boolean({
      description: 'Install as a dev dependency (only for npm/JSR)',
      default: false,
    }),
    name: Flags.string({
      char: 'n',
      description: 'Name to use for the kit directory (default: auto-detect from source)',
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

      // Installation strategy based on source type
      if (resolved.type === 'npm' || resolved.type === 'jsr') {
        // NPM/JSR packages: Install to node_modules using package manager
        await this.installPackage(resolved, flags)
      } else {
        // Everything else: Clone/copy to ./kits/
        await this.installToKitsDir(resolved, flags)
      }

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
          `Command not found. Make sure git or the required package manager is installed.`
        )
      }
      this.error(`Failed to install kit: ${msg}`)
    }
  }

  /**
   * Install npm/JSR package to node_modules using package manager
   */
  private async installPackage(resolved: any, flags: any): Promise<void> {
    const pm = this.detectPackageManager()
    const cmd = buildInstallCommand(resolved, pm, {
      dev: flags.dev,
      global: false, // Global install doesn't make sense for kits
    })

    this.log(`Installing to node_modules using ${pm}...`)
    this.log(`Running: ${cmd}`)

    execSync(cmd, {
      cwd: flags.cwd,
      stdio: 'inherit',
    })
  }

  /**
   * Install kit to .hyper/kits/ directory (for GitHub, Git URLs, local paths, etc.)
   */
  private async installToKitsDir(resolved: any, flags: any): Promise<void> {
    // Find project root (where package.json is)
    const projectRoot = this.findProjectRoot(flags.cwd)
    const kitsDir = join(projectRoot, '.hyper', 'kits')

    // Ensure kits directory exists
    if (!existsSync(kitsDir)) {
      mkdirSync(kitsDir, { recursive: true })
      this.log(`Created kits directory: ${kitsDir}`)
    }

    // Determine kit name
    const kitName = flags.name || this.extractKitName(resolved)
    const targetDir = join(kitsDir, kitName)

    // Check if kit already exists (directory or manifest)
    if (existsSync(targetDir) || isKitInstalled(projectRoot, kitName)) {
      this.error(
        `Kit already exists: ${kitName}\n` +
        `Remove it first with: rm -rf .hyper/kits/${kitName}\n` +
        `Or specify a different name with: --name <name>`
      )
    }

    this.log(`Installing to: .hyper/kits/${kitName}`)

    // Install based on source type
    let commit: string | undefined
    let branch: string | undefined
    let tag: string | undefined

    switch (resolved.type) {
      case 'github':
      case 'gitlab':
      case 'bitbucket':
        const gitInfo = await this.cloneFromGitHost(resolved, targetDir)
        commit = gitInfo.commit
        branch = gitInfo.branch
        tag = gitInfo.tag
        break

      case 'git':
        const gitUrlInfo = await this.cloneFromGitUrl(resolved.source, targetDir)
        commit = gitUrlInfo.commit
        break

      case 'local':
        await this.copyFromLocal(resolved.source, targetDir)
        break

      case 'url':
        await this.downloadFromUrl(resolved.source, targetDir)
        break

      default:
        this.error(`Unsupported source type for kit installation: ${resolved.type}`)
    }

    // Extract version from package.json if available
    const version = extractPackageVersion(targetDir)

    // Add to manifest
    const manifestEntry: KitManifestEntry = {
      name: kitName,
      source: resolved.original,
      type: resolved.type,
      installedAt: new Date().toISOString(),
      commit,
      version,
      branch,
      tag,
    }

    addKitToManifest(projectRoot, manifestEntry)
    this.log(`Added ${kitName} to manifest`)
  }

  /**
   * Download from GitHub/GitLab/Bitbucket using tiged
   */
  private async cloneFromGitHost(
    resolved: any,
    targetDir: string
  ): Promise<{ commit?: string; branch?: string; tag?: string }> {
    // Convert to tiged-compatible format
    let tigedSource = resolved.source

    // Extract branch/tag information
    let branch: string | undefined
    let tag: string | undefined

    // Check for branch (#) or tag (@) in source
    const branchMatch = tigedSource.match(/#([^/]+)$/)
    const tagMatch = tigedSource.match(/@([^/]+)$/)

    if (branchMatch) {
      branch = branchMatch[1]
    } else if (tagMatch) {
      tag = tagMatch[1]
      // Convert @tag to #tag for tiged compatibility
      tigedSource = tigedSource.replace(/@([^/]+)$/, '#$1')
    }

    this.log(`Downloading from: ${tigedSource}`)

    const emitter = tiged(tigedSource, {
      cache: false,
      force: false,
      verbose: this.flags.debug,
    })

    // Handle tiged events
    emitter.on('info', (info: any) => {
      if (this.flags.debug) {
        this.log(`[tiged] ${info.message}`)
      }
    })

    emitter.on('warn', (warning: any) => {
      this.warn(`[tiged] ${warning.message}`)
    })

    await emitter.clone(targetDir)

    // Note: tiged doesn't provide commit hash, we'd need to get it from the repo
    // This is a limitation we accept for now
    return { branch, tag }
  }

  /**
   * Download from Git URL using tiged
   */
  private async cloneFromGitUrl(
    gitUrl: string,
    targetDir: string
  ): Promise<{ commit?: string }> {
    this.log(`Downloading from: ${gitUrl}`)

    // tiged can handle Git URLs directly
    const emitter = tiged(gitUrl, {
      cache: false,
      force: false,
      verbose: this.flags.debug,
    })

    emitter.on('info', (info: any) => {
      if (this.flags.debug) {
        this.log(`[tiged] ${info.message}`)
      }
    })

    emitter.on('warn', (warning: any) => {
      this.warn(`[tiged] ${warning.message}`)
    })

    await emitter.clone(targetDir)

    return {}
  }

  /**
   * Find project root by walking up to find package.json
   */
  private findProjectRoot(startDir: string): string {
    let dir = startDir

    while (dir !== '/' && dir !== '.') {
      if (existsSync(join(dir, 'package.json'))) {
        return dir
      }

      const parent = join(dir, '..')
      if (parent === dir) break
      dir = parent
    }

    // If no package.json found, use startDir
    return startDir
  }

  /**
   * Copy from local path
   */
  private async copyFromLocal(sourcePath: string, targetDir: string): Promise<void> {
    // Resolve relative paths
    const absoluteSource = isAbsolute(sourcePath)
      ? sourcePath
      : resolve(this.flags.cwd, sourcePath)

    if (!existsSync(absoluteSource)) {
      this.error(`Source path does not exist: ${absoluteSource}`)
    }

    this.log(`Copying from: ${absoluteSource}`)

    cpSync(absoluteSource, targetDir, {
      recursive: true,
      filter: (source) => {
        // Skip common directories that shouldn't be copied
        const name = basename(source)
        return !['node_modules', '.git', 'dist', 'build', '.DS_Store'].includes(name)
      }
    })
  }

  /**
   * Download and extract from tarball URL
   */
  private async downloadFromUrl(url: string, targetDir: string): Promise<void> {
    this.log(`Downloading from: ${url}`)

    // Create target directory
    mkdirSync(targetDir, { recursive: true })

    // Download and extract (assuming .tar.gz or .tgz)
    if (url.endsWith('.tar.gz') || url.endsWith('.tgz')) {
      execSync(`curl -L "${url}" | tar xz -C "${targetDir}" --strip-components=1`, {
        cwd: this.flags.cwd,
        stdio: 'inherit',
      })
    } else if (url.endsWith('.zip')) {
      // Download zip file then extract
      const tempZip = join(targetDir, 'temp.zip')
      execSync(`curl -L -o "${tempZip}" "${url}" && unzip -q "${tempZip}" -d "${targetDir}" && rm "${tempZip}"`, {
        cwd: this.flags.cwd,
        stdio: 'inherit',
      })
    } else {
      this.error(`Unsupported archive format. Only .tar.gz, .tgz, and .zip are supported.`)
    }
  }

  /**
   * Extract kit name from resolved source
   */
  private extractKitName(resolved: any): string {
    switch (resolved.type) {
      case 'github':
      case 'gitlab':
      case 'bitbucket': {
        // Extract repo name from github:user/repo or github:user/repo#branch
        const match = resolved.source.match(/[:/]([^:/]+\/[^:/]+?)(?:[#@]|$)/)
        if (match) {
          const [user, repo] = match[1].split('/')
          return repo || user // Use repo name
        }
        return 'kit'
      }

      case 'git': {
        // Extract from git URL
        const match = resolved.source.match(/\/([^/]+?)(?:\.git)?$/)
        return match ? match[1] : 'kit'
      }

      case 'local': {
        // Use directory name
        return basename(resolved.source)
      }

      case 'url': {
        // Extract filename without extension
        const match = resolved.source.match(/\/([^/]+?)(?:\.(tar\.gz|tgz|zip))?$/)
        return match ? match[1] : 'kit'
      }

      default:
        return 'kit'
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
