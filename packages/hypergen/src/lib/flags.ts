/**
 * Shared flag definitions for oclif commands
 */

import { Flags } from '@oclif/core'

/**
 * Flags for commands that execute actions/recipes
 */
export const executionFlags = {
  dryRun: Flags.boolean({
    description: 'Run without making changes',
    default: false,
  }),
  force: Flags.boolean({
    char: 'f',
    description: 'Force overwrite existing files',
    default: false,
  }),
  defaults: Flags.boolean({
    description: 'Use default values, skip prompts',
    default: false,
  }),
  skipPrompts: Flags.boolean({
    description: 'Skip all interactive prompts',
    default: false,
  }),
  continueOnError: Flags.boolean({
    description: 'Continue execution on error',
    default: false,
  }),
  answers: Flags.file({
    description: 'Path to AI answers JSON file (2-pass generation)',
  }),
  'ai-mode': Flags.string({
    description: 'How to resolve @ai blocks: auto, api, command, stdout, off',
    options: ['auto', 'api', 'command', 'stdout', 'off'],
  }),
}

/**
 * Flags for commands that output data
 */
export const outputFlags = {
  json: Flags.boolean({
    description: 'Output as JSON',
    default: false,
  }),
  quiet: Flags.boolean({
    char: 'q',
    description: 'Suppress non-essential output',
    default: false,
  }),
}

/**
 * Flags for discovery commands
 */
export const discoveryFlags = {
  sources: Flags.string({
    char: 's',
    description: 'Discovery sources (comma-separated: local,npm,github)',
    multiple: true,
  }),
  refresh: Flags.boolean({
    description: 'Force refresh of cached data',
    default: false,
  }),
}

/**
 * Flags for validation commands
 */
export const validationFlags = {
  strict: Flags.boolean({
    description: 'Enable strict validation mode',
    default: false,
  }),
}
