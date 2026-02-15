/**
 * Command Not Found Hook
 *
 * When oclif can't find a command, check if the first argument could be
 * a kit/cookbook/recipe path. If so, re-dispatch as `run <original args...>`.
 *
 * This enables the natural syntax:
 *   hypergen nextjs crud update Organization
 * instead of requiring:
 *   hypergen run nextjs crud update Organization
 */

import type { Hook } from '@oclif/core'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Flags that the Run command declares and oclif should parse normally.
 * Everything else is a recipe parameter and must go after `--`.
 */
const KNOWN_RUN_FLAGS = new Set([
  'dry', 'force', 'yes', 'answers', 'prompt-template', 'ask', 'no-defaults',
  'cwd', 'debug', 'config',
  // Short aliases
  'f', 'y', 'd',
])

const hook: Hook.CommandNotFound = async function (opts) {
  const commandId = opts.id

  // Don't intercept commands that look like they're trying to be actual CLI commands
  // (help, version, etc.) or are empty
  if (!commandId || commandId.startsWith('-')) {
    return
  }

  // oclif joins command hierarchies with colons (e.g., "nextjs:project:create")
  // Split them into separate segments for our path resolver
  const segments = commandId.split(':')

  // Separate known Run flags from recipe-specific params.
  // oclif rejects unknown --flags even with strict:false, so we put
  // recipe params after a `--` separator to pass them through as raw argv.
  const knownArgs: string[] = []
  const recipeArgs: string[] = []
  let seenSeparator = false

  for (const arg of opts.argv ?? []) {
    if (arg === '--') {
      seenSeparator = true
      continue
    }

    if (seenSeparator) {
      recipeArgs.push(arg)
      continue
    }

    if (arg.startsWith('--')) {
      const flagName = arg.slice(2).split('=')[0]
      if (KNOWN_RUN_FLAGS.has(flagName)) {
        knownArgs.push(arg)
      } else {
        recipeArgs.push(arg)
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      // Short flag like -f, -y, -d
      const shortFlag = arg.slice(1)
      if (KNOWN_RUN_FLAGS.has(shortFlag)) {
        knownArgs.push(arg)
      } else {
        recipeArgs.push(arg)
      }
    } else {
      // Positional arg — keep before `--`
      knownArgs.push(arg)
    }
  }

  // Build final argv: segments + known flags + -- + recipe params
  const argv = [...segments, ...knownArgs]
  if (recipeArgs.length > 0) {
    argv.push('--', ...recipeArgs)
  }

  // Import and run the Run command
  try {
    // Construct path to run command that works in both dev and prod
    // In dev: oclif loads src/hooks/command-not-found.ts, so we import src/commands/run.ts
    // In prod: oclif loads dist/hooks/command-not-found.js, so we import dist/commands/run.js
    const currentFile = fileURLToPath(import.meta.url)
    const currentDir = dirname(currentFile)

    // Determine the correct extension based on current file
    const ext = currentFile.endsWith('.ts') ? '.ts' : '.js'
    const runCommandPath = join(currentDir, '..', 'commands', `run${ext}`)

    const RunCommand = (await import(runCommandPath)).default
    await RunCommand.run(argv)
  } catch (error: any) {
    // If the run command also fails, let the original not-found error propagate
    if (error?.code === 'EEXIT') throw error
    throw error
  }
}

export default hook
