# Config Cookbook Restructure - Implementation Report

**Date:** 2025-02-11
**Task:** Create new `config/` cookbook structure in Next.js kit
**Status:** ✅ Completed

## Overview

Successfully restructured the Next.js kit's configuration recipes from separate `database/`, `ui/`, and `state/` cookbooks into a unified `config/` cookbook with an interactive setup wizard.

## What Was Done

### 1. Created New Config Cookbook Structure

```
/work/hyperdev/packages/hypergen/kits/nextjs/cookbooks/config/
├── cookbook.yml                    # Cookbook definition
├── all/                            # Interactive setup wizard
│   ├── recipe.yml                  # Wizard logic
│   └── README.md                   # Comprehensive documentation
├── prisma/                         # Moved from database/prisma-init
│   ├── recipe.yml
│   ├── README.md
│   └── templates/
├── drizzle/                        # Moved from database/drizzle-init
│   ├── recipe.yml
│   ├── README.md
│   └── templates/
├── shadcn/                         # Moved from ui/shadcn-init
│   ├── recipe.yml
│   ├── README.md
│   └── templates/
├── tanstack-query/                 # Moved from state/tanstack-query
│   ├── recipe.yml
│   ├── README.md
│   └── templates/
└── MIGRATION.md                    # Migration guide
```

### 2. Created Interactive Setup Wizard (`config/all`)

**Features:**
- Interactive prompts for all configuration choices
- Database ORM selection (none/Prisma/Drizzle)
- UI library setup (shadcn/ui)
- State management (TanStack Query)
- Authentication (placeholder for future NextAuth.js/Clerk)
- Runs sub-recipes based on selections
- Can be re-run to update configuration

**Usage:**
```bash
# Interactive mode
hypergen nextjs config all

# Non-interactive mode
hypergen nextjs config all --database=prisma --ui=true --stateManagement=true
```

### 3. Moved and Renamed Recipes

**Recipe Name Changes:**
- `database/prisma-init` → `config/prisma`
- `database/drizzle-init` → `config/drizzle`
- `ui/shadcn-init` → `config/shadcn`
- `state/tanstack-query` → `config/tanstack-query`

**All template files preserved:**
- Template paths remain relative (e.g., `templates/prisma-client.ts.jig`)
- No changes needed to template content
- All README.md files preserved

### 4. Created Cookbook Configuration

**File:** `/work/hyperdev/packages/hypergen/kits/nextjs/cookbooks/config/cookbook.yml`

```yaml
name: config
description: Configure and setup your Next.js stack (can be re-run to update configuration)
version: 1.0.0

defaults:
  recipe: all

recipes:
  - './*/recipe.yml'
```

### 5. Updated Documentation

**Files Updated:**
- `README.md` - Main kit documentation
- `COMPLETE.md` - Implementation status
- `ARCHITECTURE.md` - Architecture documentation
- `IMPLEMENTATION_PROGRESS.md` - Progress tracking
- `cookbooks/form/README.md` - Form cookbook docs
- `cookbooks/form/crud/README.md` - CRUD form docs

**Changes Made:**
- Updated all references from old paths to new paths
- Added config/all wizard to documentation
- Updated quick start examples
- Updated integration examples
- Updated recipe counts and descriptions

### 6. Deleted Old Directories

**Removed:**
- `cookbooks/database/` (entire directory)
- `cookbooks/ui/` (entire directory)
- `cookbooks/state/` (entire directory)

## Implementation Details

### Interactive Wizard Design

The `config/all` recipe uses Hypergen's `prompt` tool with the following flow:

1. **Welcome message** - Sets context
2. **Database prompt** - Select (none/prisma/drizzle)
3. **UI prompt** - Confirm (shadcn/ui yes/no)
4. **State management prompt** - Confirm (TanStack Query yes/no)
5. **Auth prompt** - Select (none/nextauth/clerk)
6. **Configuration summary** - Display choices
7. **Conditional recipe execution** - Run selected recipes using `when` conditions
8. **Completion message** - Next steps based on selections

### Recipe Tool Integration

Sub-recipes are invoked using the `recipe` tool:

```yaml
- name: Setup Prisma
  tool: recipe
  recipe: ../prisma/recipe.yml
  when: database === 'prisma'
  variables:
    database: postgresql
    databaseUrl: ""
```

### Conditional Execution

Uses `when` conditions to skip recipes:

```yaml
when: database === 'prisma'    # Only if user chose Prisma
when: ui === true              # Only if user enabled UI
when: stateManagement === true # Only if user enabled state
```

## Files Created

1. `/work/hyperdev/packages/hypergen/kits/nextjs/cookbooks/config/cookbook.yml`
2. `/work/hyperdev/packages/hypergen/kits/nextjs/cookbooks/config/all/recipe.yml`
3. `/work/hyperdev/packages/hypergen/kits/nextjs/cookbooks/config/all/README.md`
4. `/work/hyperdev/packages/hypergen/kits/nextjs/cookbooks/config/MIGRATION.md`
5. `/work/hyperdev/agent/reports/config-cookbook-restructure.md` (this file)

## Files Moved

All files from:
- `cookbooks/database/prisma-init/` → `cookbooks/config/prisma/`
- `cookbooks/database/drizzle-init/` → `cookbooks/config/drizzle/`
- `cookbooks/ui/shadcn-init/` → `cookbooks/config/shadcn/`
- `cookbooks/state/tanstack-query/` → `cookbooks/config/tanstack-query/`

## Files Modified

1. `/work/hyperdev/packages/hypergen/kits/nextjs/README.md`
2. `/work/hyperdev/packages/hypergen/kits/nextjs/COMPLETE.md`
3. `/work/hyperdev/packages/hypergen/kits/nextjs/ARCHITECTURE.md`
4. `/work/hyperdev/packages/hypergen/kits/nextjs/IMPLEMENTATION_PROGRESS.md`
5. `/work/hyperdev/packages/hypergen/kits/nextjs/cookbooks/form/README.md`
6. `/work/hyperdev/packages/hypergen/kits/nextjs/cookbooks/form/crud/README.md`
7. `/work/hyperdev/packages/hypergen/kits/nextjs/cookbooks/config/prisma/recipe.yml` (name updated)
8. `/work/hyperdev/packages/hypergen/kits/nextjs/cookbooks/config/drizzle/recipe.yml` (name updated)
9. `/work/hyperdev/packages/hypergen/kits/nextjs/cookbooks/config/shadcn/recipe.yml` (name updated)

## Files Deleted

- `cookbooks/database/` (entire directory tree)
- `cookbooks/ui/` (entire directory tree)
- `cookbooks/state/` (entire directory tree)

## Verification

### Structure Verification
✅ All recipes moved to config cookbook
✅ All template files preserved
✅ All README files preserved
✅ Old directories deleted
✅ Recipe names updated (removed "-init" suffix)
✅ Template paths are relative and correct
✅ Recipe references in config/all use relative paths

### Documentation Verification
✅ All old path references updated
✅ Integration examples updated
✅ Quick start examples updated
✅ Recipe counts updated
✅ Related recipe links updated

### Recipe Verification
✅ cookbook.yml created with correct structure
✅ config/all recipe uses proper prompt tool syntax
✅ config/all recipe uses proper recipe tool syntax
✅ config/all recipe has comprehensive README
✅ Conditional execution with `when` clauses
✅ All sub-recipes reference correct templates

## Benefits

1. **Single Entry Point**: Users can configure entire stack with one command
2. **Better Organization**: All configuration in one logical place
3. **Interactive Experience**: Guided setup instead of memorizing commands
4. **Re-runnable**: Can update configuration at any time
5. **Flexible**: Use wizard OR individual recipes
6. **Consistent Naming**: No more "-init" suffixes
7. **Easier Discovery**: All config recipes in one cookbook

## Breaking Changes

The old recipe paths no longer work:
- `hypergen nextjs database/prisma-init` ❌
- `hypergen nextjs config prisma` ✅

Users must update their scripts/documentation to use new paths.

## Migration Path

For existing users:

1. **Update commands** from old paths to new paths
2. **Use wizard** for new projects: `hypergen nextjs config all`
3. **Individual recipes** still available: `hypergen nextjs config prisma`

See `cookbooks/config/MIGRATION.md` for detailed migration guide.

## Time Savings

**Before:**
```bash
hypergen nextjs database/prisma-init --database=postgresql  # 30 sec
hypergen nextjs ui/shadcn-init --primitives=baseui          # 30 sec
hypergen nextjs state/tanstack-query                        # 30 sec
# Total: ~90 seconds + context switching
```

**After:**
```bash
hypergen nextjs config all
# Total: ~60 seconds (interactive), one command, no context switching
```

## Next Steps

The config cookbook is now ready for:
1. ✅ Testing with real projects
2. ✅ User documentation updates
3. 🔜 Adding NextAuth.js recipe
4. 🔜 Adding Clerk recipe
5. 🔜 Adding more configuration options (ESLint, Prettier, etc.)

## Conclusion

The config cookbook restructure successfully consolidates all stack configuration into a unified, interactive experience. The new structure is cleaner, more intuitive, and provides better developer experience through the interactive wizard while maintaining flexibility for advanced users who prefer individual recipes.
