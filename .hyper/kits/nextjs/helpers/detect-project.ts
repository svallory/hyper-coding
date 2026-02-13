/**
 * Detect project features and configuration
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface ProjectFeatures {
  /** Detected ORM */
  orm: 'prisma' | 'drizzle' | 'none'

  /** Detected auth provider */
  auth: 'nextauth' | 'clerk' | 'lucia' | 'none'

  /** Detected UI library configuration */
  ui: 'shadcn-radix' | 'shadcn-baseui' | 'none'

  /** Detected state management libraries */
  stateManagement: string[]

  /** Package manager */
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun'

  /** TypeScript configuration */
  typescript: boolean

  /** Next.js version */
  nextVersion?: string

  /** App Router vs Pages Router */
  router: 'app' | 'pages' | 'unknown'
}

/**
 * Detect project features by analyzing package.json, config files, and directory structure
 */
export function detectProjectFeatures(root: string = process.cwd()): ProjectFeatures {
  const features: ProjectFeatures = {
    orm: 'none',
    auth: 'none',
    ui: 'none',
    stateManagement: [],
    packageManager: detectPackageManager(root),
    typescript: existsSync(join(root, 'tsconfig.json')),
    router: detectRouter(root),
  }

  // Read package.json
  const packageJsonPath = join(root, 'package.json')
  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    }

    // Detect Next.js version
    if (allDeps['next']) {
      features.nextVersion = allDeps['next'].replace(/^\^|~/, '')
    }

    // Detect ORM
    if (allDeps['@prisma/client'] || allDeps['prisma']) {
      features.orm = 'prisma'
    } else if (allDeps['drizzle-orm']) {
      features.orm = 'drizzle'
    }

    // Detect auth
    if (allDeps['next-auth']) {
      features.auth = 'nextauth'
    } else if (allDeps['@clerk/nextjs']) {
      features.auth = 'clerk'
    } else if (allDeps['lucia']) {
      features.auth = 'lucia'
    }

    // Detect state management
    if (allDeps['zustand']) {
      features.stateManagement.push('zustand')
    }
    if (allDeps['@tanstack/react-query']) {
      features.stateManagement.push('react-query')
    }
    if (allDeps['jotai']) {
      features.stateManagement.push('jotai')
    }
    if (allDeps['recoil']) {
      features.stateManagement.push('recoil')
    }
  }

  // Detect shadcn/ui primitives
  features.ui = detectShadcnPrimitives(root)

  return features
}

/**
 * Detect which package manager is being used
 */
export function detectPackageManager(root: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (existsSync(join(root, 'bun.lockb'))) return 'bun'
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

/**
 * Detect which router the project uses (App Router vs Pages Router)
 */
export function detectRouter(root: string): 'app' | 'pages' | 'unknown' {
  if (existsSync(join(root, 'app'))) return 'app'
  if (existsSync(join(root, 'pages'))) return 'pages'
  if (existsSync(join(root, 'src', 'app'))) return 'app'
  if (existsSync(join(root, 'src', 'pages'))) return 'pages'
  return 'unknown'
}

/**
 * Detect shadcn/ui primitive library (Radix vs Base UI)
 */
export function detectShadcnPrimitives(root: string): 'shadcn-radix' | 'shadcn-baseui' | 'none' {
  const packageJsonPath = join(root, 'package.json')
  if (!existsSync(packageJsonPath)) return 'none'

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  }

  // Check components.json for explicit configuration
  const componentsJsonPath = join(root, 'components.json')
  if (existsSync(componentsJsonPath)) {
    try {
      const componentsConfig = JSON.parse(readFileSync(componentsJsonPath, 'utf-8'))
      if (componentsConfig.primitives === 'baseui' || componentsConfig.primitives === 'base-ui') {
        return 'shadcn-baseui'
      }
      if (componentsConfig.primitives === 'radix') {
        return 'shadcn-radix'
      }
    } catch {
      // Invalid JSON, continue with dependency detection
    }
  }

  // Detect by dependencies
  const hasBaseUI = Object.keys(allDeps).some((dep) => dep.startsWith('@base-ui'))
  const hasRadix = Object.keys(allDeps).some((dep) => dep.startsWith('@radix-ui'))

  if (hasBaseUI) return 'shadcn-baseui'
  if (hasRadix) return 'shadcn-radix'

  return 'none'
}

/**
 * Get the install command for the detected package manager
 */
export function getInstallCommand(packageManager: string, packages: string[]): string {
  const pkgsStr = packages.join(' ')
  switch (packageManager) {
    case 'bun':
      return `bun add ${pkgsStr}`
    case 'pnpm':
      return `pnpm add ${pkgsStr}`
    case 'yarn':
      return `yarn add ${pkgsStr}`
    default:
      return `npm install ${pkgsStr}`
  }
}

/**
 * Check if a package is installed
 */
export function isPackageInstalled(packageName: string, root: string = process.cwd()): boolean {
  const packageJsonPath = join(root, 'package.json')
  if (!existsSync(packageJsonPath)) return false

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  }

  return packageName in allDeps
}
