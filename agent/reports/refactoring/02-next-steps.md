# Next Steps and Implementation Tasks

## Status Legend
- DONE = completed and verified
- PARTIAL = started but incomplete
- TODO = not started

---

## 1. Fix Hypergen Re-exports (TODO)

**Purpose:** Maintain backward compatibility during transition

The current `packages/hypergen/src/index.ts` still uses old internal imports (`#/types.js`, `#/logger.js`, etc.). It needs to re-export from the new packages instead.

```typescript
// packages/hypergen/src/index.ts — should become:
export * from '@hypercli/core'
export * from '@hypercli/kit'
export * from '@hypercli/gen'
```

**Tasks:**
- [ ] Rewrite index.ts to re-export from new packages
- [ ] Update package.json dependencies to reference new packages
- [ ] Test that existing imports still work

---

## 2. Fix TypeScript Build Issues (PARTIAL)

**Current state:** All 4 packages have tsup configs and produce dist/index.js, but:
- No .d.ts generation (DTS disabled)
- No verification that cross-package imports resolve at runtime

**Tasks:**
- [ ] Fix DTS generation (inflection types issue — either find compatible @types/inflection, write custom .d.ts, or replace library)
- [ ] Verify cross-package imports work at runtime
- [ ] Test oclif plugin loading works in cli

---

## 3. Migrate Tests (DONE)

Tests have been migrated to their respective packages:
- `packages/core/tests/` — config, parser, error, utility tests
- `packages/gen/tests/` — recipe engine, tools, template, AI, actions, E2E tests
- `packages/kit/tests/` — url-resolution, source resolver tests

**Remaining:**
- [ ] Create `packages/cli/tests/` — command tests, plugin loading tests (currently no test dir exists)
- [ ] Verify all migrated tests pass with updated imports

---

## 4. Update Hypergen Package for Deprecation (PARTIAL)

**Done:**
- postinstall.js (deprecation notice)
- README-DEPRECATED.md (migration guide)

**Still needed:**
- [ ] Update package.json: set `"deprecated": true`, strip dependencies, set version to 9.0.0
- [ ] Remove source code from hypergen package (keep: package.json, postinstall.js, README.md, LICENSE)
- [ ] Publish hypergen@9.0.0
- [ ] Run `npm deprecate hypergen "This package has moved to @hypercli/cli"`

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

### 5.2 CLAUDE.md Files (PARTIAL)

- DONE: `packages/core/CLAUDE.md`
- [ ] Create `packages/kit/CLAUDE.md`
- [ ] Create `packages/gen/CLAUDE.md`
- [ ] Create `packages/cli/CLAUDE.md`

### 5.3 Package README Files (TODO)

None of the new packages have READMEs yet:
- [ ] `packages/core/README.md`
- [ ] `packages/kit/README.md`
- [ ] `packages/gen/README.md`
- [ ] `packages/cli/README.md`

### 5.4 Root README (TODO)

- [ ] Update `/work/hyperdev/README.md` with new architecture, install instructions, package list

---

## 6. CI/CD (TODO)

No `.github/workflows/` or `.changeset/` directory exists yet.

- [ ] Create `.changeset/config.json` for independent versioning
- [ ] Create build workflow (build in dependency order: core -> kits -> gen -> cli)
- [ ] Create test workflow
- [ ] Create release workflows per package (changesets-based)

---

## 7. Moon Workspace Updates (TODO)

Current `.moon/workspace.yml` only extends the template — no project-specific config.

- [ ] Add project definitions with dependency graph (core -> kits -> gen -> cli)
- [ ] Configure task caching for builds/tests

---

## 8. Publishing Strategy (TODO)

Publish in dependency order:
1. `@hypercli/core@1.0.0`
2. `@hypercli/kit@1.0.0`
3. `@hypercli/gen@1.0.0`
4. `@hypercli/cli@1.0.0`
5. `hypergen@9.0.0` (deprecation release)

- [ ] Set up npm org `@hypercli`
- [ ] Configure package.json `publishConfig` in each package
- [ ] Dry-run publish to verify package contents
- [ ] Publish in order

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
