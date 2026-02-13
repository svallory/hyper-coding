#!/usr/bin/env node

// Disable TypeScript auto-transpilation BEFORE importing oclif
// This is critical for production to prevent loading .ts files when .js files exist
// The global must be initialized as an object first, then the property set
if (!globalThis.oclif) {
  globalThis.oclif = {}
}
globalThis.oclif.enableAutoTranspile = false

import { execute } from '@oclif/core'

await execute({ dir: import.meta.url })
