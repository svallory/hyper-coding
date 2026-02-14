# Plan: Create OSS Kit for Hypergen

## Context

Create a new hyper-kit called `oss` at `hyper-kits/oss` with two recipes: `setup` and `npm-pkg` that automate the creation of open-source projects from scratch. The kit should follow the patterns established in the codebase and implement the best practices from the `oss-setup` and `oss-package` skills.

## Kit Structure

```
hyper-kits/oss/
├── kit.yml                              # Kit metadata and discovery
├── cookbooks/
│   └── project/
│       ├── cookbook.yml                 # Cookbook metadata
│       ├── setup/                       # Recipe: Full OSS project setup
│       │   ├── recipe.yml
│       │   └── templates/
│       │       ├── LICENSE.jig
│       │       ├── README.md.jig
│       │       ├── CONTRIBUTING.md.jig
│       │       ├── CODE_OF_CONDUCT.md.jig
│       │       ├── SECURITY.md.jig
│       │       ├── CHANGELOG.md.jig
│       │       ├── .gitignore.jig
│       │       ├── .editorconfig.jig
│       │       └── .github/
│       │           ├── ISSUE_TEMPLATE/
│       │           │   ├── bug_report.yml.jig
│       │           │   └── feature_request.yml.jig
│       │           ├── workflows/
│       │           │   └── ci.yml.jig
│       │           └── pull_request_template.md.jig
│       └── npm-pkg/                     # Recipe: NPM package setup
│           ├── recipe.yml
│           └── templates/
│               ├── package.json.jig
│               ├── tsconfig.json.jig
│               ├── tsup.config.ts.jig
│               ├── vitest.config.ts.jig
│               ├── biome.json.jig
│               ├── .changeset/
│               │   └── config.json.jig
│               ├── .github/
│               │   └── workflows/
│               │       └── release.yml.jig
│               └── src/
│                   └── index.ts.jig
```

## Recipe Details

### 1. `setup` Recipe (cookbook: project)

**Purpose**: Create a complete open-source GitHub repository with all essential files.

**Variables**:
- `projectName` (string, required): Project name
- `description` (string, required): One-line description
- `author` (string, required): Author name and email
- `license` (enum, default: MIT): License type (MIT, Apache-2.0, BSD-3-Clause)
- `includeCodeOfConduct` (boolean, default: true): Include CODE_OF_CONDUCT.md
- `includeSecurity` (boolean, default: true): Include SECURITY.md
- `includeFunding` (boolean, default: false): Include FUNDING.yml

**Steps**:
1. Create project directory
2. Generate LICENSE file
3. Generate README.md with badges
4. Generate CONTRIBUTING.md
5. Generate CODE_OF_CONDUCT.md (if enabled)
6. Generate SECURITY.md (if enabled)
7. Generate CHANGELOG.md
8. Generate .gitignore
9. Generate .editorconfig
10. Create .github/ISSUE_TEMPLATE/ files
11. Create .github/pull_request_template.md
12. Create .github/workflows/ci.yml
13. Create .github/FUNDING.yml (if enabled)

### 2. `npm-pkg` Recipe (cookbook: project)

**Purpose**: Add npm package configuration to an existing project (or create from scratch).

**Variables**:
- `projectName` (string, required): Package name (with optional @scope)
- `description` (string, required): Package description
- `entryPoints` (array, default: ["index"]): Entry points (e.g., ["index", "utils", "cli"])
- `includeTests` (boolean, default: true): Include Vitest setup
- `includeChangesets` (boolean, default: true): Include changesets for release automation
- `buildTool` (enum, default: tsup): Build tool (tsup, vite, tsc)
- `runtime` (enum, default: node18): Target runtime (node18, node20, node22)

**Steps**:
1. Generate package.json with exports field
2. Generate tsconfig.json aligned with exports
3. Generate build config (tsup.config.ts, vite.config.ts, or tsconfig.build.json)
4. Generate vitest.config.ts (if tests enabled)
5. Generate biome.json for linting/formatting
6. Generate .changeset/config.json (if changesets enabled)
7. Generate .github/workflows/release.yml (if changesets enabled)
8. Generate src/index.ts entry point
9. Generate additional entry points as needed

## Key Files to Create

### kit.yml
- Kit metadata following hypergen kit pattern
- Discovery globs for cookbooks
- No kit-wide variables needed (recipe-specific instead)

### cookbooks/project/cookbook.yml
- Cookbook metadata
- Recipe discovery pattern

### setup/recipe.yml
- Variables for OSS project setup
- Steps for generating all repository files
- Uses `template` tool for each file

### npm-pkg/recipe.yml
- Variables for npm package configuration
- Steps for package.json, tsconfig, build config, testing, changesets
- Conditional steps based on user selections

### Templates

All templates use Jig syntax with YAML frontmatter:

```jig
---
to: "path/to/output.file"
---
content here with {{ variable }} interpolation
```

## Verification

After creating the kit:
1. Run `bun test` to ensure no regressions
2. Test the kit locally:
   - `cd packages/hypergen && bun run hygen oss project setup --projectName test-oss`
   - `cd packages/hypergen && bun run hygen oss project npm-pkg --projectName test-pkg`
3. Verify generated files match oss-setup and oss-package skill requirements
