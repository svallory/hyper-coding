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

const hook: Hook.CommandNotFound = async function (opts) {
  const commandId = opts.id

  // Don't intercept commands that look like they're trying to be actual CLI commands
  // (help, version, etc.) or are empty
  if (!commandId || commandId.startsWith('-')) {
    return
  }

  // Re-dispatch as `run <commandId> <remaining args>`
  // oclif will parse this as the `run` command with the original args
  const argv = [commandId, ...(opts.argv ?? [])]

  // Import and run the Run command
  try {
    const { default: RunCommand } = await import('../commands/run.js')
    await RunCommand.run(argv)
  } catch (error: any) {
    // If the run command also fails, let the original not-found error propagate
    if (error?.code === 'EEXIT') throw error
    throw error
  }
}

export default hook
