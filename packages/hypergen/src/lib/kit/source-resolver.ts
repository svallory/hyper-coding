/**
 * Kit Source Resolution
 *
 * Resolves kit sources from various formats (npm, GitHub, local paths, etc.)
 * into a standardized format that package managers can understand.
 */

export type KitSourceType =
  | 'npm'
  | 'jsr'
  | 'github'
  | 'gitlab'
  | 'bitbucket'
  | 'local'
  | 'git'
  | 'url'

export interface ResolvedKitSource {
  /** The type of kit source, determines installation method */
  type: KitSourceType
  /** The resolved source string to pass to package manager */
  source: string
  /** The original input string */
  original: string
  /** Optional registry identifier */
  registry?: string
}

/**
 * Resolve a kit source string into a typed, normalized format.
 *
 * Resolution order:
 * 1. Explicit prefixes (file:, github:, jsr:, npm:, git+, etc.)
 * 2. JSR-specific patterns (@jsr/)
 * 3. Git URLs (by protocol or .git extension)
 * 4. HTTP(S) URLs
 * 5. Windows paths (drive letters, UNC paths, backslashes)
 * 6. Unix paths (/, ./, ../, ~/)
 * 7. GitHub/GitLab/Bitbucket shorthand (user/repo)
 * 8. NPM packages (default)
 *
 * @param input - The kit source string from user input
 * @returns Resolved kit source with type and normalized source
 *
 * @example
 * ```typescript
 * resolveKitSource('@kit/nextjs')
 * // → { type: 'npm', source: '@kit/nextjs', registry: 'npm' }
 *
 * resolveKitSource('svallory/hypergen-kit-nextjs')
 * // → { type: 'github', source: 'github:svallory/hypergen-kit-nextjs' }
 *
 * resolveKitSource('./my-local-kit')
 * // → { type: 'local', source: './my-local-kit' }
 *
 * resolveKitSource('C:\\Projects\\my-kit')
 * // → { type: 'local', source: 'C:\\Projects\\my-kit' }
 * ```
 */
export function resolveKitSource(input: string): ResolvedKitSource {
  const trimmed = input.trim()

  // 1. Explicit prefix (highest priority)
  if (trimmed.startsWith('file:')) {
    return { type: 'local', source: trimmed, original: input }
  }
  if (trimmed.startsWith('github:')) {
    return { type: 'github', source: trimmed, original: input }
  }
  if (trimmed.startsWith('gitlab:')) {
    return { type: 'gitlab', source: trimmed, original: input }
  }
  if (trimmed.startsWith('bitbucket:')) {
    return { type: 'bitbucket', source: trimmed, original: input }
  }
  if (trimmed.startsWith('git+')) {
    return { type: 'git', source: trimmed, original: input }
  }
  if (trimmed.startsWith('jsr:')) {
    return { type: 'jsr', source: trimmed, original: input, registry: 'jsr' }
  }
  if (trimmed.startsWith('npm:')) {
    return { type: 'npm', source: trimmed.slice(4), original: input, registry: 'npm' }
  }

  // 2. JSR-specific patterns
  if (trimmed.startsWith('@jsr/')) {
    return { type: 'jsr', source: trimmed, original: input, registry: 'jsr' }
  }

  // 3. Git URLs (by protocol or .git extension)
  if (trimmed.startsWith('git://') ||
    trimmed.startsWith('ssh://git@')) {
    return { type: 'git', source: trimmed, original: input }
  }

  // 4. HTTP(S) URLs
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    // Check if it's a .git URL
    if (trimmed.endsWith('.git')) {
      return { type: 'git', source: trimmed, original: input }
    }
    // Otherwise treat as tarball URL
    return { type: 'url', source: trimmed, original: input }
  }

  // 5. Windows paths (must check before Unix paths to avoid C: being treated as package)
  // Windows drive letter: C:\ or C:/
  if (/^[a-zA-Z]:[/\\]/.test(trimmed)) {
    return { type: 'local', source: trimmed, original: input }
  }
  // Windows UNC path: \\server\share
  if (trimmed.startsWith('\\\\')) {
    return { type: 'local', source: trimmed, original: input }
  }
  // Windows relative paths: .\ or ..\
  if (trimmed.startsWith('.\\') || trimmed.startsWith('..\\')) {
    return { type: 'local', source: trimmed, original: input }
  }

  // 6. Unix paths
  if (trimmed.startsWith('/') ||      // Absolute
    trimmed.startsWith('./') ||     // Relative
    trimmed.startsWith('../') ||    // Parent
    trimmed.startsWith('~/')) {     // Home
    return { type: 'local', source: trimmed, original: input }
  }

  // 7. GitHub/GitLab/Bitbucket shorthand: user/repo
  // Must not start with @ (that's npm scoped packages)
  // Must have exactly one / (to avoid paths like ./foo/bar)
  const shorthandPattern = /^([a-zA-Z0-9][-a-zA-Z0-9_.]*)\/([a-zA-Z0-9][-a-zA-Z0-9_.]*)(@|#)?/
  if (!trimmed.startsWith('@') && shorthandPattern.test(trimmed)) {
    // Default to GitHub for shorthand
    return { type: 'github', source: `github:${trimmed}`, original: input }
  }

  // 8. Default to npm package
  return { type: 'npm', source: trimmed, original: input, registry: 'npm' }
}

/**
 * Build package manager install command for a resolved kit source.
 *
 * @param resolved - The resolved kit source
 * @param pm - Package manager to use
 * @param flags - Installation flags (dev, global)
 * @returns Command string to execute
 */
export function buildInstallCommand(
  resolved: ResolvedKitSource,
  pm: 'bun' | 'pnpm' | 'yarn' | 'npm',
  flags: { dev?: boolean; global?: boolean }
): string {
  // Special handling for JSR packages
  if (resolved.type === 'jsr') {
    if (pm === 'bun') {
      // Bun supports JSR natively
      return buildStandardCommand(pm, resolved.source, flags)
    }
    // For npm/pnpm/yarn, use npx jsr add
    const jsrPackage = resolved.source.replace('jsr:', '').replace('@jsr/', '@')
    return `npx jsr add ${jsrPackage}`
  }

  // All other types work with standard package manager commands
  return buildStandardCommand(pm, resolved.source, flags)
}

/**
 * Build standard package manager command
 */
function buildStandardCommand(
  pm: 'bun' | 'pnpm' | 'yarn' | 'npm',
  source: string,
  flags: { dev?: boolean; global?: boolean }
): string {
  const escapedSource = shellEscape(source)

  if (pm === 'bun') {
    return flags.global
      ? `bun add -g ${escapedSource}`
      : flags.dev
        ? `bun add -d ${escapedSource}`
        : `bun add ${escapedSource}`
  }

  if (pm === 'pnpm') {
    return flags.global
      ? `pnpm add -g ${escapedSource}`
      : flags.dev
        ? `pnpm add -D ${escapedSource}`
        : `pnpm add ${escapedSource}`
  }

  if (pm === 'yarn') {
    return flags.global
      ? `yarn global add ${escapedSource}`
      : flags.dev
        ? `yarn add -D ${escapedSource}`
        : `yarn add ${escapedSource}`
  }

  // npm
  return flags.global
    ? `npm install -g ${escapedSource}`
    : flags.dev
      ? `npm install -D ${escapedSource}`
      : `npm install ${escapedSource}`
}

/**
 * Shell-escape a kit source string to prevent command injection.
 *
 * @param source - The kit source string
 * @returns Shell-escaped string safe for command execution
 * @throws Error if source contains dangerous shell metacharacters
 */
function shellEscape(source: string): string {
  // Reject obvious shell injection characters
  const dangerousChars = /[;&|`$(){}!><\n\r]/
  if (dangerousChars.test(source)) {
    throw new Error(
      `Invalid kit specifier: "${source}"\n` +
      `Kit sources must not contain shell metacharacters.`
    )
  }
  // Wrap in single quotes for shell safety, escaping internal single quotes
  return `'${source.replace(/'/g, "'\\''")}'`
}
