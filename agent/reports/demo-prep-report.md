# Demo Preparation Report

**Date:** 2026-02-18
**Branch:** `demo/presentation-prep`
**Worktree:** `/work/hyper/.worktrees/demo-prep`

## Summary

All demo scenarios verified end-to-end. The hyper CLI and nextjs kit are ready for presentation.

## What Was Fixed

### 1. Positional Arguments (3 recipes)
- `project/create`: Added `position: 1` to `name` variable
- `component/add`: Added `position: 0` to `name`, `position: 1` to `componentDescription`
- `page/add`: Added `position: 1` to `pageDescription`

### 2. @ai 2-Pass Templates (2 recipes)
- **component/add**: Replaced static placeholder with full @ai template that generates complete React components with shadcn/ui, TypeScript types, and Tailwind CSS
- **page/add**: Replaced static placeholder with @ai template that generates page content with shadcn/ui components, responsive layout, and semantic HTML

### 3. Recipe Variable Flag Handling (gen command)
- Fixed oclif v4 `NonExistentFlagsError` that blocked `--key=value` recipe variables
- Pre-processes argv to strip unknown flags before oclif parsing, keeps full argv for recipe variable extraction

### 4. Component Recipe Interactive Prompt Fix
- Removed `required: true` from `componentDescription` (was blocking `--ask=stdout` by triggering interactive prompts before @ai pass)
- Added `suggestion: ""` to match the pattern used by `page/add`

## Demo Flow (Verified Working)

### Step 1: Create Project
```bash
hyper gen nextjs project create petclinic
# Creates 17 files, ready to run
cd petclinic && bun install && bun run dev
# Next.js 16.1.6 + Turbopack ready in ~1.5s
```

### Step 2: Domain Entity with AI (2-pass)
```bash
hyper gen nextjs domain entity Pet --ask=stdout
# Outputs AI prompt document for Zod schema generation
# Exit code 2 = ready for AI answers
```

### Step 3: Component with AI (2-pass)
```bash
hyper gen nextjs component add PatientCard "Card showing patient details" --ask=stdout
# Outputs AI prompt for full React component generation
# Context includes: component name, description, server/client mode, shadcn/ui
```

### Step 4: Page with AI (2-pass)
```bash
hyper gen nextjs page add dashboard "Admin dashboard with stats" --ask=stdout
# Outputs AI prompt for page content
# Context includes: route, description, available shadcn/ui components list
```

## Key Demo Talking Points

1. **Token Efficiency**: The @ai template gathers context (component name, description, available UI library, project patterns) and generates a focused prompt. The AI only needs to produce the variable part, not boilerplate.

2. **Pattern Enforcement**: Templates define the code structure (imports, types, exports). AI fills in the creative parts within guardrails.

3. **Deterministic + AI**: The recipe engine handles file creation, directory structure, package.json, configs deterministically. Only the "creative" parts (component body, schema fields) use AI.

4. **2-Pass Architecture**: Pass 1 collects all @ai tags and their contexts. Single AI call resolves all variables. Pass 2 renders templates with AI answers. Minimal API calls.

## Known Limitations (Not Demo Blockers)

1. **Path syntax**: Use spaces (`nextjs project create`) not slashes (`nextjs project/create`)
2. **`--answers` replay command**: Path segments are duplicated in the generated command (cosmetic bug in gen.ts)
3. **Kit install from local path**: `kit install hyper-kits/nextjs` downloads from GitHub instead of copying local files — use `cp -r` as workaround

## Commits

1. `bccba29` (nextjs submodule) - feat: enhance templates with @ai 2-pass generation and fix positional args
2. `b664353` (parent) - fix(gen): allow recipe variables as --key=value flags
