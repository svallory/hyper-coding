---
title: Kit Configuration
---

# Kit Configuration

**What you'll learn**: How to configure kits, including cookbooks, direct recipes, and defaults
**Time needed**: 15 minutes
**Prerequisites**: Understanding of Hypergen taxonomy (cookbooks, recipes, kits)

## Overview

Kit configuration is defined in `kit.yml` and controls how your kit behaves. You can configure:

- Default recipes for quick access
- Cookbook discovery patterns
- Direct recipes (recipes that don't belong to cookbooks)
- Kit-wide variables
- Shared templates and partials

## Kit Installation Locations

Kits can be installed in different locations:

```
my-project/
├── .hyper/
│   └── kits/                  # Installed kits (GitHub, local)
│       └── my-kit/
├── node_modules/              # NPM-installed kits
│   └── @hyper-kits/
│       └── my-kit/
├── recipes/                   # Workspace kit (auto-discovered)
├── cookbooks/                 # Workspace kit (auto-discovered)
└── package.json
```

See **[Kit Management](/guides/kit-management)** for installation details.

## Basic Kit Structure

A kit can have both cookbooks and direct recipes:

```
@hyper-kits/my-kit/
├── kit.yml                    # Kit configuration
├── cookbooks/                 # Organized recipe collections
│   ├── frontend/
│   │   ├── cookbook.yml
│   │   └── create/
│   │       └── recipe.yml
│   └── backend/
│       ├── cookbook.yml
│       └── api/
│           └── recipe.yml
├── recipes/                   # Direct recipes
│   ├── init/
│   │   └── recipe.yml
│   └── help/
│       └── recipe.yml
└── shared/                    # Shared resources
    └── templates/
```

## Kit Configuration Options

### 1. Basic Metadata

```yaml
# kit.yml
name: "@hyper-kits/my-kit"
description: "My custom Hypergen kit"
version: "1.0.0"
author: "Your Name"
homepage: "https://github.com/yourname/my-kit"
repository: "https://github.com/yourname/my-kit"
license: "MIT"
tags:
  - "typescript"
  - "react"
categories:
  - "Web Development"
```

### 2. Defaults Configuration

Define what happens when users run `hypergen KIT` without arguments:

```yaml
defaults:
  # For cookbook-based commands
  cookbook: "frontend"    # Default cookbook
  recipe: "create"        # Default recipe within cookbook

  # For direct recipe commands
  directRecipe: "help"    # Default direct recipe

  # Per-cookbook defaults
  cookbookDefaults:
    frontend: "create"
    backend: "api"
    testing: "vitest"
```

### 3. Cookbook Discovery

Use glob patterns to discover cookbooks:

```yaml
cookbooks:
  # Match cookbook.yml files
  - "./cookbooks/*/cookbook.yml"
  # Also match folders without cookbook.yml (if they have recipes)
  - "./cookbooks/*/"
  # Multiple patterns
  - "./packages/*/cookbook.yml"
  - "./tools/*/cookbook.yml"
```

### 4. Direct Recipes

Recipes that don't belong to any cookbook:

```yaml
recipes:
  # Match recipe.yml files
  - "./recipes/*/recipe.yml"
  # Also match folders
  - "./recipes/*/"
  # Custom patterns
  - "./generators/*/recipe.yml"
  - "./scripts/*/recipe.yml"
```

### 5. Kit-Wide Variables

Variables available to all recipes:

```yaml
variables:
  authorName:
    type: string
    default: "Your Name"
    description: "Author name for generated files"

  nodeVersion:
    type: string
    default: "20.11.0"
    description: "Node.js version"

  useTypeScript:
    type: boolean
    default: true
    description: "Use TypeScript by default"
```

### 6. Shared Resources

Templates and partials shared across recipes:

```yaml
shared:
  templates:
    - "./shared/templates/*.jig"
  partials:
    - "./shared/partials/*.jig"
```

## Command Resolution

When users run commands, Hypergen resolves them in this order:

### Direct Recipe Resolution

For commands like `hypergen my-kit init`:

1. Check if "init" matches a direct recipe
2. If found, execute the direct recipe
3. If not found, fall back to cookbook resolution

### Cookbook Resolution

For commands like `hypergen my-kit frontend create`:

1. Look for cookbook "frontend"
2. Look for recipe "create" within that cookbook
3. Apply defaults if cookbook or recipe not specified

## Usage Examples

### Example 1: Mixed Kit with Defaults

```yaml
# kit.yml
name: "@hyper-kits/mixed-kit"
description: "Kit with both cookbooks and direct recipes"

defaults:
  cookbook: "frontend"
  recipe: "create"
  directRecipe: "help"

cookbooks:
  - "./cookbooks/*/"

recipes:
  - "./recipes/*/"

variables:
  projectName:
    type: string
    required: true
    prompt: "Project name?"
```

Usage:
```bash
# Uses default cookbook + recipe: frontend/create
hypergen mixed-kit

# Uses direct recipe: help
hypergen mixed-kit help

# Explicit cookbook recipe
hypergen mixed-kit backend api
```

### Example 2: Direct-Only Kit

```yaml
# kit.yml
name: "@hyper-kits/utils"
description: "Utility recipes"

defaults:
  directRecipe: "list"

recipes:
  - "./recipes/*/"

variables:
  verbose:
    type: boolean
    default: false
```

Usage:
```bash
# Uses default direct recipe: list
hypergen utils

# Specific direct recipe
hypergen utils clean
```

### Example 3: Complex Kit Structure

```yaml
# kit.yml
name: "@hyper-kits/enterprise"
description: "Enterprise development kit"

defaults:
  cookbook: "monorepo"
  recipe: "create"
  directRecipe: "setup"
  cookbookDefaults:
    frontend: "react"
    backend: "express"
    testing: "vitest"

cookbooks:
  - "./cookbooks/*/"
  - "./packages/*/cookbook.yml"

recipes:
  - "./recipes/*/"
  - "./generators/*/recipe.yml"

variables:
  companyName:
    type: string
    default: "MyCompany"

  useMonorepo:
    type: boolean
    default: true

shared:
  templates:
    - "./shared/templates/*.jig"
  partials:
    - "./shared/partials/*.jig"
```

## Best Practices

### 1. Use Clear Defaults

```yaml
# Good: Clear defaults
defaults:
  cookbook: "frontend"
  recipe: "create"
  directRecipe: "help"

# Bad: Ambiguous
defaults:
  recipe: "create"  # Which cookbook?
```

### 2. Organize by Complexity

```yaml
# Simple operations as direct recipes
recipes:
  - "./recipes/init"
  - "./recipes/upgrade"
  - "./recipes/help"

# Complex workflows in cookbooks
cookbooks:
  - "./cookbooks/frontend/"
  - "./cookbooks/backend/"
```

### 3. Document Your Configuration

```yaml
# Include examples in kit.yml
examples:
  - command: "hypergen my-kit"
    description: "Create a new frontend project"
  - command: "hypergen my-kit backend api"
    description: "Create a new API service"
  - command: "hypergen my-kit help"
    description: "Show available options"
```

### 4. Use Consistent Naming

```yaml
# Direct recipes: verb-based
recipes:
  - "./recipes/init"
  - "./recipes/clean"
  - "./recipes/update"

# Cookbooks: noun-based
cookbooks:
  - "./cookbooks/frontend"
  - "./cookbooks/backend"
  - "./cookbooks/testing"
```

## Migration Guide

### From Recipe.yml Only

If you have a kit with only `recipe.yml` files:

1. Move recipes to appropriate locations:
   ```
   # Before
   my-kit/
   └── recipe.yml

   # After
   my-kit/
   ├── kit.yml
   └── recipes/
       └── my-recipe/
           └── recipe.yml
   ```

2. Create `kit.yml`:
   ```yaml
   name: "my-kit"
   recipes:
     - "./recipes/*/recipe.yml"
   defaults:
     recipe: "my-recipe"
   ```

### To Mixed Structure

1. Organize existing recipes into cookbooks
2. Keep simple recipes as direct recipes
3. Update `kit.yml` with both patterns

## Troubleshooting

### Recipe Not Found

1. Check glob patterns match your file structure
2. Verify `recipe.yml` files exist in matched directories
3. Use debug mode: `DEBUG=hypergen hypergen my-kit`

### Ambiguous Commands

If both a cookbook and direct recipe have the same name:
- Direct recipes take precedence
- Use full cookbook path to disambiguate

### Missing Defaults

Always provide at least one default:
```yaml
defaults:
  recipe: "help"  # or cookbook + recipe
```

## See Also

- [Recipe Configuration](/concepts/recipe-configuration) - Configure individual recipes
- [Cookbook Configuration](/concepts/cookbook-configuration) - Configure cookbooks
- [Variables](/concepts/variables) - Understanding the variable system
- [Template Discovery](/tutorials/finding-cookbooks) - How Hypergen finds your cookbooks