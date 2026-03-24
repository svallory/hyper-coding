---
name: release
description: Release all @hypercli packages to npm. Bumps versions, builds, tests, tags, and publishes.
argument-hint: "<version>"
---

# Release

Publish all @hypercli packages to npm at a given version.

## Prerequisites

- Must be on the `main` branch with a clean working tree
- Must be authenticated with npm (`npm whoami` should succeed)
- All inter-package deps should use `workspace:*` (the bump script converts them)

## Steps

### 1. Validate

```bash
# Must be on main
git branch --show-current  # expect: main

# Working tree must be clean
git status --porcelain     # expect: empty

# npm auth check
npm whoami                 # expect: your username
```

If any check fails, stop and tell the user.

### 2. Bump versions

```bash
node scripts/bump-versions.mjs <version>
```

This updates all 7 package.json files to the new version and rewrites `workspace:*` references to `^<version>`. It also regenerates oclif manifests.

### 3. Update release-please manifest

Edit `.release-please-manifest.json` — set all entries to `<version>`.

### 4. Build all packages

```bash
bunx moon run :build
```

All packages must build cleanly. If any fail, stop.

### 5. Run tests

```bash
cd packages/hq && bun run test
```

All tests must pass. If any fail, stop.

### 6. Commit version bump

```bash
git add -A
git commit -m "chore: bump all packages to <version>"
```

### 7. Dry-run publish

```bash
bash scripts/release.sh --dry-run
```

All 7 packages must succeed. Review the output for any warnings. If any fail, stop and investigate.

### 8. Confirm with user

Show the user:
- Version being published
- Number of packages
- Any warnings from dry-run

Ask for explicit confirmation before proceeding.

### 9. Tag and push

```bash
git tag v<version>
git push && git push origin v<version>
```

### 10. Publish to npm

```bash
bash scripts/release.sh
```

### 11. Verify

```bash
npm view @hypercli/cli@<version> version
```

If it returns the version, the release is complete.

### 12. Restore workspace deps

After publishing, restore `workspace:*` references for local development:

```bash
# For each inter-package dep, replace "^<version>" back to "workspace:*"
# This keeps local dev working with bun workspace linking
```

Commit as `chore: restore workspace:* deps after v<version> release`.

## Package publish order (dependency graph)

1. `@hypercli/ui` (no deps)
2. `@hypercli/core` (depends on ui)
3. `create-hyper-hq` (no deps)
4. `@hypercli/kit` (depends on core, ui)
5. `@hypercli/hq` (depends on create-hyper-hq, ui)
6. `@hypercli/gen` (depends on core, kit, ui)
7. `@hypercli/cli` (depends on core, ui, gen, hq, kit)

The `release.sh` script handles this order automatically.
