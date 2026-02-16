# Fix: `#/` subpath imports not resolving at runtime after tsup → tsc migration

## Context

After replacing tsup with tsc for building, all `#/` path aliases remain unrewritten in compiled JS output. tsc doesn't rewrite `paths` — tsup did this automatically as a bundler.

The `package.json` `imports` field (`"#/*": "./dist/*.js"`) should handle this at runtime, but:
- **Node.js <v25.4**: `#/` is explicitly invalid as a subpath import prefix
- **Bun**: Resolves `#/` correctly from within the same package, but **fails when the module is imported from another workspace package** via symlinks (e.g., `@hypercli/core` imported from `@hypercli/cli`)

This breaks ALL commands in the CLI.

## Approach: `tsc-alias` post-build rewriting

Add `tsc-alias` to rewrite `#/` imports to relative paths in the compiled `dist/` output. This is the lowest-risk fix — no source changes needed, just build pipeline updates.

### Steps

1. **Install `tsc-alias`** as a root devDependency
   ```bash
   bun add -d tsc-alias
   ```

2. **Update build scripts** in all 4 packages to run `tsc-alias` after `tsc`:
   - `packages/core/package.json`: `"build": "tsc && tsc-alias"`
   - `packages/kit/package.json`: `"build": "tsc && tsc-alias"`
   - `packages/gen/package.json`: `"build": "tsc && tsc-alias"`
   - `packages/cli/package.json`: `"build": "tsc && tsc-alias"`

3. **Update moon build task** (`.moon/tasks/node.yml` line 37) — change `command: 'tsc'` to `command: 'tsc && tsc-alias'`

4. **Rebuild all packages** and verify `dist/` output no longer contains `#/` imports

5. **Test CLI** end-to-end: `bun /work/hyper/packages/cli/bin/dev.js --version`

### Files to modify
- `/work/hyper/package.json` (add tsc-alias devDep)
- `/work/hyper/packages/core/package.json` (build script)
- `/work/hyper/packages/kit/package.json` (build script)
- `/work/hyper/packages/gen/package.json` (build script)
- `/work/hyper/packages/cli/package.json` (build script)
- `/work/hyper/.moon/tasks/node.yml` (if it hardcodes `tsc` instead of using `bun run build`)

### Verification
1. `bun run build` in each package
2. Grep `dist/` for `from "#/` — should find 0 matches
3. `bun /work/hyper/packages/cli/bin/dev.js --version` — should print version without errors
4. `bun /work/hyper/packages/cli/bin/dev.js --help` — should list all commands
