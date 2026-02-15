# Hypergen V8 Cleanup Plan

**Date**: 2025-12-27
**Objective**: Remove Hygen backward compatibility and simplify codebase for V8

## Overview

Hypergen V8 will be a clean break from Hygen. This cleanup removes all backward compatibility code, simplifies the architecture, and modernizes the codebase.

## Key Changes

1. ❌ **Remove Hygen backward compatibility**
2. ❌ **Remove EJS template engine** (LiquidJS only)
3. ✅ **Change default template directory** (`_templates` → `templates`)
4. ✅ **Simplify configuration** (remove dual-engine support)
5. ✅ **Clean up naming** (remove hygen references)

## Current Hygen Compatibility Analysis

### From CLAUDE.md Review

**Hygen References Found**:
- Line 10: `bun run hygen` command
- Line 11: `bun run hygen:build` command
- Line 30: "forked from Hygen"
- Line 94: `_templates/` directory structure
- Line 95-96: `_templates/generator/action/` mapping
- Line 138: "compatible with Hygen"
- Line 193-210: Entire "Migration Context" section
- Line 204-210: "Backward Compatibility" section

### Source Code Analysis

**Files Referencing `_templates`**:
```
src/templates/init/self/new-generator-with-prompt.prompt.ejs.t
src/templates/init/self/new-generator.ejs.t
src/templates/init/self/new-repo.ejs.t
src/templates/init/self/new-generator-help.ejs.t
src/templates/init/self/new-generator-with-prompt.ejs.t
```

**Files Potentially Referencing Hygen**:
- Need to check: `src/config.ts`, `src/config-resolver.ts`
- Test fixtures in `tests/fixtures/`
- Package.json scripts

## Cleanup Tasks

### 1. Documentation Updates

#### CLAUDE.md
- [ ] Remove all Hygen references
- [ ] Remove "Migration Context" section (lines 193-210)
- [ ] Remove "Backward Compatibility" section (lines 204-210)
- [ ] Update template directory from `_templates/` to `templates/`
- [ ] Remove EJS references, keep only LiquidJS
- [ ] Update commands: `hygen` → `hypergen`
- [ ] Simplify template engine section (remove dual-engine support)

#### README.md
- [ ] Remove Hygen comparison/migration information
- [ ] Update quick start examples to use `templates/` directory
- [ ] Remove EJS examples, use only LiquidJS
- [ ] Update "forked from Hygen" to "inspired by Hygen"

#### DOCUMENTATION_SYSTEMS.md
- [ ] Review and remove any Hygen references

### 2. Source Code Changes

#### Configuration Files

**File**: `src/config.ts`
```typescript
// REMOVE: Backward compatibility for hygen.json
// REMOVE: Support for _templates directory
// REMOVE: EJS engine configuration

// KEEP: Only these
const DEFAULT_TEMPLATES_DIR = 'templates' // Changed from _templates
const CONFIG_FILE = 'hypergen.config.js' // Not hygen.json
const TEMPLATE_ENGINE = 'liquid' // No fallback to EJS
```

**File**: `src/config-resolver.ts`
- [ ] Remove config loading from `hygen.json`
- [ ] Remove fallback to `_templates/` directory
- [ ] Simplify config resolution (one path, not multiple)

#### Template Engine

**File**: `src/template-engines/factory.ts`
```typescript
// REMOVE: EJS engine registration
// REMOVE: Dual-engine support
// REMOVE: Engine selection logic

// KEEP: Only LiquidJS
export class TemplateEngineFactory {
  private engine: LiquidEngine

  constructor() {
    this.engine = new LiquidEngine()
  }

  getEngine(): LiquidEngine {
    return this.engine
  }
}
```

**Files to DELETE**:
- [ ] `src/template-engines/ejs-engine.ts`
- [ ] Any EJS-specific code

**Files to UPDATE**:
- [ ] `src/template-engines/factory.ts` - Remove dual-engine support
- [ ] `src/template-engines/index.ts` - Export only LiquidJS
- [ ] `src/render.ts` - Remove EJS rendering logic

#### Template Discovery

**File**: `src/TemplateStore.ts` or similar
```typescript
// CHANGE: Default template directory
const DEFAULT_TEMPLATE_DIRS = [
  'templates',           // Was: _templates
  'node_modules/*/templates'  // Was: node_modules/*/_templates
]
```

#### CLI & Help

**File**: `src/cli/cli.ts`
- [ ] Update help text to reference `templates/` not `_templates/`
- [ ] Remove any Hygen compatibility messages

**File**: `src/help.ts`
- [ ] Update all examples to use `templates/` directory
- [ ] Remove migration guides from built-in help

### 3. Package.json Updates

```json
{
  "scripts": {
    // REMOVE these:
    "hygen": "...",
    "hygen:build": "...",
    "hygen:timed": "...",

    // RENAME to:
    "hypergen": "bun --bun src/bin.ts",
    "hypergen:build": "bun dist/bin.js"
  },

  "dependencies": {
    // REMOVE:
    "ejs": "^3.1.10",

    // KEEP:
    "liquidjs": "^10.24.0"
  }
}
```

### 4. Example Templates Migration

**Directory Structure Change**:
```
BEFORE:
_templates/
  generator/
    action/
      template.liquid.t

AFTER:
templates/
  generator/
    action/
      template.liquid
```

**File Extension Change**:
- `.ejs.t` → DELETE
- `.liquid.t` → `.liquid`

**Files to Update**:
```
src/templates/init/self/new-generator-with-prompt.prompt.ejs.t
  → src/templates/init/self/new-generator-with-prompt.prompt.liquid

src/templates/init/self/new-generator.ejs.t
  → src/templates/init/self/new-generator.liquid

src/templates/init/self/new-repo.ejs.t
  → src/templates/init/self/new-repo.liquid

src/templates/init/self/new-generator-help.ejs.t
  → src/templates/init/self/new-generator-help.liquid

src/templates/init/self/new-generator-with-prompt.ejs.t
  → src/templates/init/self/new-generator-with-prompt.liquid
```

**Content Migration** (EJS → Liquid):
```diff
- ---
- to: _templates/<%= name %>/new/hello.ejs.t
- ---
+ ---
+ to: templates/{{ name }}/new/hello.liquid
+ ---

- Hello <%= h.capitalize(name) %>!
+ Hello {{ name | capitalize }}!

- <% if (locals.message) { %>
- Message: <%= message %>
- <% } %>
+ {% if message %}
+ Message: {{ message }}
+ {% endif %}
```

### 5. Test Updates

#### Test Fixtures

**Directory**: `tests/fixtures/`
- [ ] Rename `_templates/` to `templates/` in all fixtures
- [ ] Convert `.ejs.t` files to `.liquid`
- [ ] Update expected outputs in tests

**Files to Update**:
```
tests/fixtures/empty.ejs.t → empty.liquid
tests/fixtures/capitalized.ejs.t → capitalized.liquid
tests/fixtures/app/action-multifiles-nest/full.ejs.t → full.liquid
tests/fixtures/app/action-multifiles-nest/arbitrarySubfolder/capitalized.ejs.t → capitalized.liquid
tests/fixtures/app/action-capitalized-defaults/capitalized.ejs.t → capitalized.liquid
```

#### Test Files

- [ ] Update all test files to expect `templates/` not `_templates/`
- [ ] Update all tests to use Liquid syntax, not EJS
- [ ] Remove EJS-specific tests

**Example Test Update**:
```typescript
// BEFORE
const templatePath = path.join(tmpDir, '_templates/generator/new')
const content = '<%= name %>'

// AFTER
const templatePath = path.join(tmpDir, 'templates/generator/new')
const content = '{{ name }}'
```

### 6. Constants & Defaults

**File**: `src/constants.ts`
```typescript
// CHANGE all defaults
export const DEFAULT_TEMPLATE_DIR = 'templates' // was: _templates
export const TEMPLATE_EXTENSION = '.liquid'     // was: .ejs.t or .liquid.t
export const CONFIG_FILE = 'hypergen.config.js' // was: hypergen.json or hygen.json
```

### 7. Error Messages & Logging

Search and update:
- [ ] Any error messages mentioning `_templates/`
- [ ] Any help text mentioning EJS
- [ ] Any migration warnings about Hygen compatibility

**Example**:
```typescript
// BEFORE
throw new Error('Template not found in _templates/ or ./_templates/')

// AFTER
throw new Error('Template not found in templates/ directory')
```

## Breaking Changes Communication

### Migration Guide for Users

Create `MIGRATION_V8.md`:

```markdown
# Migration Guide: Hypergen V7 → V8

## Breaking Changes

### 1. Template Directory
- **V7**: `_templates/`
- **V8**: `templates/`

**Action**: Rename your templates directory
```bash
mv _templates templates
```

### 2. Template Engine
- **V7**: EJS and LiquidJS
- **V8**: LiquidJS only

**Action**: Convert EJS templates to Liquid
```bash
# Rename files
find templates -name "*.ejs.t" -exec rename 's/\.ejs\.t$/.liquid/' {} \;

# Update syntax (see conversion guide below)
```

### 3. File Extensions
- **V7**: `.ejs.t`, `.liquid.t`
- **V8**: `.liquid`

**Action**: Rename files
```bash
find templates -name "*.liquid.t" -exec rename 's/\.liquid\.t$/.liquid/' {} \;
```

### 4. Configuration File
- **V7**: `hypergen.json` or `hygen.json`
- **V8**: `hypergen.config.js` only

**Action**: Migrate to JavaScript config
```javascript
// hypergen.config.js
export default {
  templates: {
    directory: 'templates',
    engine: 'liquid'
  }
}
```

### 5. Command Names
- **V7**: Some scripts used `hygen` command
- **V8**: Always use `hypergen`

**Action**: Update package.json scripts
```json
{
  "scripts": {
    "gen": "hypergen"
  }
}
```

## Syntax Conversion: EJS → Liquid

### Variables
```diff
- <%= name %>
+ {{ name }}
```

### Conditionals
```diff
- <% if (condition) { %>
-   content
- <% } %>
+ {% if condition %}
+   content
+ {% endif %}
```

### Loops
```diff
- <% items.forEach(item => { %>
-   <%= item.name %>
- <% }) %>
+ {% for item in items %}
+   {{ item.name }}
+ {% endfor %}
```

### Filters
```diff
- <%= name.toUpperCase() %>
+ {{ name | upcase }}

- <%= h.capitalize(name) %>
+ {{ name | capitalize }}
```

### Custom Filters
```javascript
// hypergen.config.js
export default {
  templates: {
    filters: {
      pascalCase: str => str.charAt(0).toUpperCase() + str.slice(1)
    }
  }
}
```

```liquid
{{ name | pascalCase }}
```
```

## Implementation Checklist

### Week 1: Documentation & Planning
- [ ] Create MIGRATION_V8.md guide
- [ ] Update CLAUDE.md
- [ ] Update README.md
- [ ] Update all docs to remove Hygen references
- [ ] Communicate breaking changes to users

### Week 2: Core Changes
- [ ] Remove EJS engine
- [ ] Update default template directory to `templates`
- [ ] Remove hygen.json config support
- [ ] Simplify TemplateEngineFactory
- [ ] Update constants and defaults

### Week 3: Templates & Examples
- [ ] Migrate all src/templates/ to Liquid
- [ ] Update template extensions
- [ ] Convert all example templates
- [ ] Update scaffolding templates

### Week 4: Tests & Validation
- [ ] Update all test fixtures
- [ ] Convert test templates to Liquid
- [ ] Update test assertions
- [ ] Run full test suite
- [ ] Fix any remaining issues

### Week 5: Polish & Release
- [ ] Update error messages
- [ ] Update CLI help text
- [ ] Performance testing
- [ ] Documentation review
- [ ] Release V8.0.0

## Risk Mitigation

### For Existing Users
1. **Clear communication**: Blog post + migration guide
2. **Version bump**: Major version (8.0.0) signals breaking changes
3. **Deprecation path**: Could release 7.9.0 with warnings first
4. **Migration tool**: Simple script to help convert templates

### Migration Script
```bash
#!/bin/bash
# migrate-to-v8.sh

echo "Migrating to Hypergen V8..."

# 1. Rename template directory
if [ -d "_templates" ]; then
  mv _templates templates
  echo "✓ Renamed _templates/ to templates/"
fi

# 2. Rename file extensions
find templates -name "*.ejs.t" -exec bash -c 'mv "$0" "${0%.ejs.t}.liquid"' {} \;
find templates -name "*.liquid.t" -exec bash -c 'mv "$0" "${0%.liquid.t}.liquid"' {} \;
echo "✓ Updated file extensions"

# 3. Convert basic EJS syntax (simple cases)
find templates -name "*.liquid" -type f -exec sed -i '' \
  -e 's/<%= \(.*\) %>/{{ \1 }}/g' \
  -e 's/<% if (\(.*\)) { %>/{% if \1 %}/g' \
  -e 's/<% } %>/{% endif %}/g' \
  {} \;
echo "✓ Converted basic syntax"

echo "⚠️  Manual review needed:"
echo "  - Complex JavaScript expressions"
echo "  - Loop syntax"
echo "  - Custom helpers"
echo ""
echo "See MIGRATION_V8.md for complete guide"
```

## Success Metrics

- [ ] Zero Hygen references in codebase
- [ ] All tests passing with new structure
- [ ] Documentation fully updated
- [ ] Migration guide complete and tested
- [ ] Performance maintained or improved
- [ ] Bundle size reduced (no EJS dependency)

## Timeline

| Week | Focus | Deliverables |
|------|-------|--------------|
| 1 | Documentation | Updated docs, migration guide |
| 2 | Core changes | Template dir, engine removal |
| 3 | Templates | All templates migrated |
| 4 | Testing | All tests updated and passing |
| 5 | Release | V8.0.0 ready for production |

## Notes

- This is a **one-way migration** - no backward compatibility
- Users on V7 can stay on V7 as long as needed
- V8 will be maintained going forward
- Simpler codebase = easier to maintain and extend
- Better foundation for AI integration features
