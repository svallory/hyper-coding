/**
 * Hypergen V8 Engine
 *
 * Legacy engine interface - CLI is now managed by oclif.
 * This module is preserved for backwards compatibility of the programmatic API.
 */

import type { ActionResult, ResolvedRunnerConfig } from './types.js'

/**
 * Error thrown when help is requested
 */
export class ShowHelpError extends Error {
  constructor(message: string) {
    super(message)
    Object.setPrototypeOf(this, ShowHelpError.prototype)
  }
}

/**
 * Legacy engine function
 *
 * @deprecated Use the oclif CLI or programmatic RecipeEngine API instead.
 * The CLI is now managed by oclif: `hypergen <command>`
 * For programmatic use, import RecipeEngine directly from the package.
 */
const engine = async (
  _argv: string[],
  config: ResolvedRunnerConfig,
): Promise<ActionResult[]> => {
  const { logger } = config

  const message = `
Hypergen V8 - CLI is now managed by oclif

USAGE:
  hypergen <command> [options]

For programmatic use, import from the package:

  import { RecipeEngine, ActionExecutor } from 'hypergen'

Run 'hypergen --help' for CLI usage.
`
  logger.log(message)
  throw new ShowHelpError('Use CLI or programmatic API')
}

export default engine
