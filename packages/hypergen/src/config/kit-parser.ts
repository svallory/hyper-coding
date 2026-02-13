/**
 * Kit Parser
 *
 * Parses and validates kit.yml files and discovers kits from search directories.
 * A kit is the top-level container that holds cookbooks and standalone recipes.
 */

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { glob } from 'glob'
import createDebug from 'debug'
import type { KitConfig } from './types.js'

const debug = createDebug('hypergen:config:kit-parser')

export interface ParsedKit {
  config: KitConfig
  filePath: string
  dirPath: string
  isValid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Parse a kit.yml file and return validated configuration
 */
export async function parseKitFile(filePath: string): Promise<ParsedKit> {
  const result: ParsedKit = {
    config: { name: '' },
    filePath,
    dirPath: path.dirname(filePath),
    isValid: false,
    errors: [],
    warnings: [],
  }

  try {
    if (!fs.existsSync(filePath)) {
      result.errors.push(`Kit file not found: ${filePath}`)
      return result
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = yaml.load(content) as any

    if (!parsed || typeof parsed !== 'object') {
      result.errors.push('Invalid YAML format or empty file')
      return result
    }

    result.config = validateKitConfig(parsed, result.errors, result.warnings)
    result.isValid = result.errors.length === 0

    return result
  } catch (error: any) {
    result.errors.push(`Failed to parse kit file: ${error.message}`)
    return result
  }
}

/**
 * Discover kits from a list of search directories.
 *
 * Search order:
 * 1. `./kits/` (project-local)
 * 2. `./node_modules/@hyper-kits/` (npm installed)
 * 3. Explicit additional directories
 */
export async function discoverKits(
  searchDirs: string[]
): Promise<Map<string, ParsedKit>> {
  const kits = new Map<string, ParsedKit>()

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) {
      debug('Kit search directory does not exist: %s', dir)
      continue
    }

    // Look for kit.yml in immediate subdirectories
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const kitYml = path.join(dir, entry.name, 'kit.yml')
      if (fs.existsSync(kitYml)) {
        const parsed = await parseKitFile(kitYml)
        if (parsed.isValid) {
          // Derive a short name for routing: strip scope prefix
          const shortName = deriveShortName(parsed.config.name)
          kits.set(shortName, parsed)
          debug('Discovered kit: %s -> %s', shortName, kitYml)
        } else {
          debug('Kit validation failed: %s (%s)', kitYml, parsed.errors.join(', '))
        }
      }
    }

    // Also check if the directory itself has a kit.yml (e.g., direct kit dir)
    const directKitYml = path.join(dir, 'kit.yml')
    if (fs.existsSync(directKitYml)) {
      const parsed = await parseKitFile(directKitYml)
      if (parsed.isValid) {
        const shortName = deriveShortName(parsed.config.name)
        if (!kits.has(shortName)) {
          kits.set(shortName, parsed)
          debug('Discovered kit (direct): %s -> %s', shortName, directKitYml)
        }
      }
    }
  }

  return kits
}

/**
 * Get the default search directories for kit discovery relative to a project root.
 */
export function getDefaultKitSearchDirs(projectRoot: string): string[] {
  return [
    path.join(projectRoot, 'kits'),
    path.join(projectRoot, 'node_modules', '@hyper-kits'),
  ]
}

/**
 * Derive a short, CLI-friendly name from a kit's full name.
 * "@hyper-kits/nextjs" -> "nextjs"
 * "my-kit" -> "my-kit"
 */
export function deriveShortName(name: string): string {
  // Strip npm scope
  const withoutScope = name.replace(/^@[^/]+\//, '')
  return withoutScope
}

/**
 * Resolve cookbook glob patterns within a kit directory.
 */
export async function resolveKitCookbooks(
  kitDirPath: string,
  cookbookGlobs: string[]
): Promise<string[]> {
  const cookbookDirs: string[] = []

  for (const pattern of cookbookGlobs) {
    const matches = await glob(pattern, { cwd: kitDirPath, absolute: true })
    for (const match of matches) {
      // If match is a file (cookbook.yml), use its parent dir
      const stat = fs.statSync(match)
      const dir = stat.isFile() ? path.dirname(match) : match
      if (!cookbookDirs.includes(dir)) {
        cookbookDirs.push(dir)
      }
    }
  }

  return cookbookDirs
}

// -- Validation helpers --

function validateKitConfig(
  parsed: any,
  errors: string[],
  warnings: string[]
): KitConfig {
  const config: KitConfig = { name: '' }

  if (!parsed.name || typeof parsed.name !== 'string') {
    errors.push('Kit name is required and must be a string')
  } else {
    config.name = parsed.name
  }

  if (parsed.description && typeof parsed.description === 'string') {
    config.description = parsed.description
  }

  if (parsed.version && typeof parsed.version === 'string') {
    config.version = parsed.version
  }

  if (parsed.author && typeof parsed.author === 'string') {
    config.author = parsed.author
  }

  if (parsed.license && typeof parsed.license === 'string') {
    config.license = parsed.license
  }

  if (parsed.keywords && Array.isArray(parsed.keywords)) {
    config.keywords = parsed.keywords.filter((k: any) => typeof k === 'string')
  }

  if (parsed.defaults && typeof parsed.defaults === 'object') {
    config.defaults = {}
    if (typeof parsed.defaults.cookbook === 'string') {
      config.defaults.cookbook = parsed.defaults.cookbook
    }
    if (typeof parsed.defaults.recipe === 'string') {
      config.defaults.recipe = parsed.defaults.recipe
    }
  }

  if (parsed.cookbooks && Array.isArray(parsed.cookbooks)) {
    config.cookbooks = parsed.cookbooks.filter((c: any) => typeof c === 'string')
  }

  if (parsed.recipes && Array.isArray(parsed.recipes)) {
    config.recipes = parsed.recipes.filter((r: any) => typeof r === 'string')
  }

  if (parsed.tags && Array.isArray(parsed.tags)) {
    config.tags = parsed.tags.filter((t: any) => typeof t === 'string')
  }

  if (parsed.categories && Array.isArray(parsed.categories)) {
    config.categories = parsed.categories.filter((c: any) => typeof c === 'string')
  }

  return config
}
