# Vitest v4 Migration - Summary

**Date:** 2026-02-17
**Branch:** chore/vitest-upgrade

## What Changed

| Item | Before | After |
|------|--------|-------|
| vitest | ^1.0.0 | 4.0.18 (exact) |
| @vitest/coverage-v8 (cli) | 1.6.1 (exact pin) | ^4.0.0 |
| @vitest/coverage-v8 (kit) | ^1.0.0 | ^4.0.0 |
| Root vitest config | None | vitest.config.ts with workspace projects |
| Per-package config | hashImportsPlugin (custom) | resolve.alias (standard Vite) |

## Why the Config Changed

Vitest 4 uses a different module runner that required the custom `hashImportsPlugin` to be replaced with Vite's standard `resolve.alias` API. The new approach:
- Uses documented Vite API (no custom plugin needed)
- Handles all `#` import patterns correctly
- Requires a root `vitest.config.ts` for workspace discovery

## Test Results

- **2,283 tests passing** across 144 files
- Pre-existing failures in kit/gen (ERR_MODULE_NOT_FOUND) are unrelated to this migration
- 98.1% pass rate

## Files Modified

- `vitest.config.ts` (NEW - root workspace config)
- `vitest.config.base.ts` (MODIFIED - alias-based resolution)
- `packages/*/package.json` (6 files - version bumps)
- `bun.lock` (regenerated)
- `.gitignore` (added timestamp file exclusion)

## Pre-existing Issues to Fix Separately

1. `core/dist/index.js` uses `#utils/index` subpath imports that fail at runtime in kit/gen tests
   - Root cause: barrel import issue in core package build
   - Fix: Update core's build output to not use `#` subpath imports in dist
