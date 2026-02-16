# Next Steps and Implementation Tasks

## Status Legend
- DONE = completed and verified
- PARTIAL = started but incomplete
- TODO = not started

---

## 1. Fix Hypergen Re-exports (DONE)

**Purpose:** Maintain backward compatibility during transition

The current `packages/hypergen/src/index.ts` still uses old internal imports (`#/types.js`, `#/logger.js`, etc.). It needs to re-export from the new packages instead.

```typescript
// packages/hypergen/src/index.ts — should become:
export * from '@hypercli/core'
export * from '@hypercli/kit'
export * from '@hypercli/gen'
```

**Tasks:**
- [x] Rewrite index.ts to re-export from new packages
- [x] Update package.json dependencies to reference new packages
- [x] Test that existing imports still work

---

## 2. Fix TypeScript Build Issues (DONE)

**Current state:** All 4 packages have tsup configs and produce dist/index.js, but:
- No .d.ts generation (DTS disabled)
- No verification that cross-package imports resolve at runtime

**Tasks:**
- [x] Fix DTS generation (inflection types issue — either find compatible @types/inflection, write custom .d.ts, or replace library)
- [x] Verify cross-package imports work at runtime
- [x] Test oclif plugin loading works in cli

---

## 3. Migrate Tests (DONE)

Tests have been migrated to their respective packages:
- `packages/core/tests/` — config, parser, error, utility tests
- `packages/gen/tests/` — recipe engine, tools, template, AI, actions, E2E tests
- `packages/kit/tests/` — url-resolution, source resolver tests
- `packages/cli/tests/` — command tests, plugin loading tests

**Tasks:**
- [x] Create `packages/cli/tests/` — command tests, plugin loading tests
- [x] Verify all migrated tests pass with updated imports

---

## 4. Update Hypergen Package for Deprecation (DONE)

**Done:**
- postinstall.js (deprecation notice)
- README-DEPRECATED.md (migration guide)
- package.json updated: set `"deprecated": true`, stripped dependencies, set version to 9.0.0
- Source code removed from hypergen package (kept: package.json, postinstall.js, README.md, LICENSE)

**Still needed:**
- [x] Publish hypergen@9.0.0
- [x] Run `npm deprecate hypergen "This package has moved to @hypercli/cli"`

---

## 5. Documentation Updates

### 5.1 Mintlify Docs Site — apps/docs/ (TODO)

- [ ] Update Getting Started: change `hypergen` to `hyper` in all examples
- [ ] Update CLI Reference: new command names, plugin info
- [ ] Create Migration Guide page (hypergen -> @hypercli/cli)
- [ ] Create Architecture section:
  - architecture/overview.md
  - architecture/core-package.md
  - architecture/kits-package.md
  - architecture/gen-package.md
  - architecture/cli-package.md
- [ ] Update SDK Reference for new package structure

### 5.2 CLAUDE.md Files (DONE)

- [x] `packages/core/CLAUDE.md`
- [x] `packages/kit/CLAUDE.md`
- [x] `packages/gen/CLAUDE.md`
- [x] `packages/cli/CLAUDE.md`

### 5.3 Package README Files (TODO)

None of the new packages have READMEs yet:
- [ ] `packages/core/README.md`
- [ ] `packages/kit/README.md`
- [ ] `packages/gen/README.md`
- [ ] `packages/cli/README.md`

### 5.4 Root README (TODO)

- [ ] Update `/work/hyperdev/README.md` with new architecture, install instructions, package list

---

## 6. CI/CD (DONE)

- [x] Create `.changeset/config.json` for independent versioning
- [x] Create build workflow (build in dependency order: core -> kits -> gen -> cli)
- [x] Create test workflow
- [x] Create release workflow (changesets-based)

---

## 7. Moon Workspace Updates (DONE)

- [x] Add project definitions with dependency graph (core -> kits -> gen -> cli)
- [x] Configure task caching for builds/tests

---

## 8. Publishing Strategy (DONE)

Configured for changesets-based publishing:

- [x] Set up npm org `@hypercli` (user confirmed)
- [x] Configure package.json `publishConfig` in each package
- [x] Create `.changeset/config.json` with public access
- [x] Create GitHub Actions workflows for CI and release
- [x] Add initial changeset for 0.1.0 release

**Publishing order:**
1. `@hypercli/core@0.1.0`
2. `@hypercli/kit@0.1.0`
3. `@hypercli/gen@0.1.0`
4. `@hypercli/cli@0.1.0`

**To publish:**
1. Ensure `NPM_TOKEN` secret is set in GitHub
2. Merge changes to main - release PR will be created automatically
3. Merge release PR - packages will be published to npm

---

## 9. Custom Markdown-Based Help System (DONE)

Replaced `@oclif/plugin-help`'s plain-text help rendering with a custom system that renders markdown files via `cli-html`'s `renderMarkdown()`.

**Architecture:**
- Custom `MarkdownHelp` class extends oclif `Help`, registered via `oclif.helpClass` in cli package.json
- One `.md` file per command, stored at `<package>/help/<command-id-as-path>.md`
- Resolution: `command.pluginName` → `plugin.root` → `help/<command-id>.md`
- Falls back to default oclif help when no `.md` file exists
- Separate cli-html theme file for help rendering customization
- Corrected cli-html types (HeadingStyle indicator) exported from `@hypercli/core`

**Files created:**
- `packages/cli/src/help/custom-help.ts` — MarkdownHelp class
- `packages/cli/src/help/theme.ts` — cli-html theme config
- `packages/cli/help/root.md` — root help content
- `packages/cli/help/config/show.md` — config show help
- `packages/gen/help/gen.md` — gen command help
- `packages/core/src/logger/cli-html-types.ts` — corrected cli-html types

**Files modified:**
- `packages/cli/package.json` — `oclif.helpClass`, `@oclif/plugin-help` dep, `help` in files
- `packages/cli/tsup.config.ts` — added help class entry point
- `packages/gen/package.json` — `help` in files
- `packages/kit/package.json` — `help` in files
- `packages/gen/src/hooks/command-not-found.ts` — skip built-in commands (help, version, etc.)
- `packages/core/src/logger/logger.ts` — re-export corrected cli-html types
- `packages/core/src/index.ts` — export corrected cli-html types

**Tasks:**
- [x] Create MarkdownHelp class with plugin-aware .md resolution
- [x] Create cli-html theme in separate file
- [x] Register helpClass in oclif config
- [x] Create initial help markdown files (root, config show, gen)
- [x] Fix `hyper help` command (install @oclif/plugin-help, skip in command_not_found hook)
- [x] Fix cli-html HeadingStyle types (indicator.marker, not marker)
- [x] Verify fallback to default oclif help works
- [x] All existing tests pass (52/52)

---

## Priority Order

1. **Fix re-exports** — unblocks anyone using `hypergen` imports
2. **Fix TypeScript DTS** — unblocks downstream consumption
3. **CLI tests** — coverage gap
4. **CLAUDE.md files** — helps AI agents work on packages correctly
5. **CI/CD setup** — needed before any publishing
6. **Package READMEs** — needed for npm pages
7. **Docs site updates** — user-facing, needed at launch
8. **Publishing** — final step
