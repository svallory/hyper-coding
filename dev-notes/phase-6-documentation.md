# Phase 6: Cleanup and Documentation

## Tasks

### 6.1 Remove Hypergen Source Code
After Phase 5 deprecation is published, the source code becomes redundant:
- Keep: `packages/hypergen/package.json`, `README.md`, `postinstall.js`
- Remove: `src/`, `tests/`, `dist/`, all other files

### 6.2 Update Mintlify Docs Site
Location: `apps/docs/`

Update pages:
1. **Getting Started** - New installation instructions with `@hypercli/cli`
2. **CLI Reference** - Change command examples from `hypergen` to `hyper`
3. **Migration Guide** (new page) - Complete migration instructions
4. **Architecture** (new page) - Document the 4-package architecture
5. **Contributing** - Update with new package structure

New sections to add:
```
docs/
  migrating-from-hypergen.mdx
  architecture/
    overview.mdx
    core-package.mdx
    kits-package.mdx
    gen-package.mdx
    cli-package.mdx
  sdk-reference/
    core/
    kits/
    gen/
    cli/
```

### 6.3 Write CLAUDE.md for Each Package

**packages/core/CLAUDE.md:**
- Purpose: Core domain types, config, errors
- No CLI commands, no runtime code
- Pure types and configuration system
- Used by all other packages

**packages/kit/CLAUDE.md:**
- Purpose: Kit lifecycle management
- oclif plugin with kit commands
- Dependencies: core + external (degit, npm-registry-fetch)
- Commands: kit install, kit update, kit list, kit info

**packages/gen/CLAUDE.md:**
- Purpose: Code generation engine
- oclif plugin with gen/recipe/cookbook commands
- Dependencies: core, kits, Jig, AI libs
- Main components: recipe engine, template engine, AI system, actions

**packages/cli/CLAUDE.md:**
- Purpose: Thin shell, plugin host
- Main binary: `hyper`
- Plugin loader for gen/kits/help
- Minimal commands: config, system, init
- CoreBaseCommand for other packages to extend

### 6.4 Update CI/CD Workflows

**.github/workflows/:**
- `build.yml` - Build all 4 packages
- `test.yml` - Test all 4 packages
- `release-core.yml` - Publish @hypercli/core
- `release-kits.yml` - Publish @hypercli/kit
- `release-gen.yml` - Publish @hypercli/gen
- `release-cli.yml` - Publish @hypercli/cli

Changesets integration for independent versioning.

### 6.5 Update Moon Workspace Config

`.moon/workspace.yml`:
- Update project references
- Configure task dependencies between packages
- Set up caching for monorepo builds

### 6.6 Update Root README

Main `README.md`:
- Overview of the 4-package architecture
- Installation instructions
- Quick start guide
- Link to documentation site
- Contributing guide update

### 6.7 Create Package README Files

Each package needs its own README with:
- Package purpose
- Installation
- Basic usage
- API reference link
- Contributing guidelines
