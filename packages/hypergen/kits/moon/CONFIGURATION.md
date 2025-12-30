# Configuration System Documentation

This document describes the configuration system for Hypergen kits, including how to define default recipes and hierarchical configurations.

## Overview

The configuration system supports four levels:

1. **kit.yml** - Kit-level configuration (defines available cookbooks, direct recipes, and global defaults)
2. **cookbook.yml** - Cookbook-level configuration (optional, defines cookbook-specific settings)
3. **recipe.yml** - Recipe-level configuration (defines the actual recipe behavior)
4. **Direct recipes** - Recipes that don't belong to any cookbook, defined at kit level

## Configuration Resolution

When you run `hypergen KIT [COOKBOOK] [RECIPE]`, the system resolves the configuration in this order:

1. Load `kit.yml` to find available cookbooks and direct recipes
2. Check if the command refers to a direct recipe:
   - If only recipe name is provided and it matches a direct recipe, use it
   - If cookbook is provided, proceed to cookbook resolution
3. For cookbook-based commands:
   - Determine the target cookbook:
     - Use provided cookbook name, OR
     - Use kit's `defaults.cookbook`
   - Load cookbook configuration (if `cookbook.yml` exists)
   - Determine the target recipe:
     - Use provided recipe name, OR
     - Use cookbook's `defaultRecipe`, OR
     - Use kit's `defaults.cookbookDefaults[COOKBOOK]`, OR
     - Use kit's `defaults.recipe`
4. Load and execute the recipe

## kit.yml Configuration

### Basic Structure

#### Option 1: Glob Patterns (Recommended)

```yaml
name: "@hyper-kits/moon"
description: "Comprehensive Moon monorepo management kit"
version: "1.0.0"
author: "Hypergen Team"

# Define defaults for the kit
defaults:
  cookbook: "repo"        # Default cookbook
  recipe: "create"        # Default recipe
  cookbookDefaults:
    toolchain: "node"     # Default for toolchain cookbook
    tasks: "typescript"   # Default for tasks cookbook

# Cookbooks available in this kit
# Accepts a single glob or an array of globs.
# Globs can match `cookbook.yml` files or folders.
# If a folder matched by a glob does not contain a `cookbook.yml` file,
# it is NOT ignored as long as it has at least one recipe.
# @default './**/cookbook.yml'
cookbooks:
  - "./cookbooks/*/cookbook.yml"
  - "./cookbooks/*/"  # Also match folders without cookbook.yml
```

#### Option 2: Explicit References (Legacy)

```yaml
name: "@hyper-kits/moon"
description: "Comprehensive Moon monorepo management kit"
version: "1.0.0"
author: "Hypergen Team"

# Define defaults for the kit
defaults:
  cookbook: "repo"        # Default cookbook
  recipe: "create"        # Default recipe
  cookbookDefaults:
    toolchain: "node"     # Default for toolchain cookbook
    tasks: "typescript"   # Default for tasks cookbook

# List available cookbooks explicitly
cookbooks:
  - name: "repo"
    description: "Repository management"
    path: "./cookbooks/repo"
    defaultRecipe: "create"  # Optional cookbook-specific default

  - name: "toolchain"
    description: "Runtime toolchain management"
    path: "./cookbooks/toolchain"
    defaultRecipe: "node"

  - name: "tasks"
    description: "Task configuration"
    path: "./cookbooks/tasks"
    defaultRecipe: "typescript"

  - name: "project"
    description: "Project management"
    path: "./cookbooks/project"
    defaultRecipe: "create"
```

### Command Resolution Examples

Given the above configuration with direct recipes:

| Command | Resolves To |
|---------|-------------|
| `hypergen moon` | `hypergen moon repo create` |
| `hypergen moon repo` | `hypergen moon repo create` |
| `hypergen moon toolchain` | `hypergen moon toolchain node` |
| `hypergen moon tasks` | `hypergen moon tasks typescript` |
| `hypergen moon project create` | `hypergen moon project create` (explicit) |
| `hypergen moon init` | Direct recipe: `init` |
| `hypergen moon setup` | Direct recipe: `setup` (if exists) |

#### Direct Recipe Resolution

Direct recipes have priority when:
- No cookbook is specified
- The recipe name matches a direct recipe

Example resolution order:
1. Check if it's a direct recipe: `hypergen moon init`
2. If not, fall back to cookbook resolution: `hypergen moon repo create`

### Advanced Features

#### Kit-Wide Variables

Define variables that can be used in all recipes:

```yaml
variables:
  moonVersion:
    type: "string"
    default: "^1.22.0"
    description: "Moon version constraint"
```

#### Shared Templates

Define templates and partials shared across recipes:

```yaml
shared:
  templates:
    - "./shared/templates/*.liquid"
  partials:
    - "./shared/partials/*.liquid"
```

### Direct Recipes

Kits can also define recipes that don't belong to any cookbook:

```yaml
# Direct recipes that don't belong to a cookbook
# Accepts a single glob or an array of globs.
# Globs can match `recipe.yml` files or folders.
# If a folder matched by a glob does not contain a `recipe.yml` file,
# it is silently ignored.
recipes:
  - "./recipes/*/recipe.yml"
  - "./recipes/*/"  # Also match folders without recipe.yml

# Default direct recipe (when running `hypergen KIT RECIPE` without cookbook)
defaults:
  directRecipe: "init"  # Default direct recipe
```

Direct recipes are useful for:
- Simple, standalone recipes that don't fit into a cookbook
- Kit-level initialization or setup recipes
- Quick commands that users run frequently

#### Using Direct Recipes

```bash
# Run a direct recipe
hypergen moon init

# This is different from cookbook recipes:
hypergen moon repo create  # cookbook + recipe
hypergen moon init         # direct recipe (no cookbook)
```

## Automatic Template Processing

Hypergen now supports automatic template processing, eliminating the need for explicit template steps in most cases.

### How It Works

When a recipe has a `templates/` directory, all files are automatically processed:

1. **Discovery**: All files in `./templates/` (relative to recipe.yml) are discovered
2. **Processing Rules**:
   - `.liquid.t` or `.liquid` files → Processed as Liquid templates
   - `.t.*` files (e.g., `.t.ts`, `.t.md`) → Processed with extension removed
   - Other files → Copied as-is
3. **Destination**: Files are placed relative to the execution directory
4. **Frontmatter**: YAML frontmatter is processed and can override destination with `to:`

### Template File Extensions

| Extension | Processing | Example | Output |
|-----------|------------|---------|---------|
| `.liquid.t` | Liquid template | `index.ts.liquid.t` | `index.ts` |
| `.liquid` | Liquid template | `package.json.liquid` | `package.json` |
| `.t.ts` | Template with extension removal | `config.t.ts` | `config.ts` |
| `.t.md` | Template with extension removal | `README.t.md` | `README.md` |
| No special extension | Copied as-is | `.gitignore` | `.gitignore` |

### Frontmatter Processing

Templates can include YAML frontmatter to control processing:

```liquid
---
to: src/components/{{ name }}.tsx
skip_if: {{ skipComponent }}
---
import React from 'react';

export const {{ name }} = () => {
  return <div>{{ name }}</div>;
};
```

### Recipe Configuration

#### Automatic Processing (Recommended)
```yaml
name: my-recipe
variables:
  projectName: { type: string, required: true }

# No steps needed! Templates are processed automatically
# All files in ./templates/ are processed
```

#### Pre/Post Steps (For Complex Workflows)
```yaml
name: complex-recipe
variables:
  projectName: { type: string, required: true }

steps:
  pre:
    - name: Create directory
      tool: shell
      command: mkdir -p {{ projectName }}

    - name: Validate input
      tool: action
      action: validate-project-name

  # Templates are processed automatically here

  post:
    - name: Install dependencies
      tool: shell
      command: cd {{ projectName }} && npm install

    - name: Run tests
      tool: shell
      command: npm test
      when: "{{ runTests }}"
```

#### Legacy Format (Still Supported)
```yaml
name: legacy-recipe
steps:
  - name: Generate file
    tool: template
    template: file.liquid

  - name: Copy config
    tool: template
    template: config.json
```

### Best Practices

1. **Use Automatic Processing**: Let Hypergen handle templates automatically
2. **Use Pre/Post Steps**: For setup, validation, and cleanup
3. **Name Templates Clearly**: Use descriptive names that indicate their purpose
4. **Test Templates**: Ensure variables are properly escaped and valid
5. **Use Frontmatter**: For conditional generation and custom destinations

### Migration from Explicit Steps

Before:
```yaml
steps:
  - name: Generate package.json
    tool: template
    template: package.json.liquid

  - name: Generate README
    tool: template
    template: README.md.liquid
```

After:
```yaml
# Just ensure files are in ./templates/
# package.json.liquid and README.md.liquid are processed automatically
```

### Advanced Usage

#### Conditional Templates
```liquid
---
to: "{{ includeTests | ternary: 'test/setup.ts', false }}"
---
// Test setup code
```

#### Multiple Outputs
```liquid
---
to: "{{ outputDir }}/{{ fileName }}.{{ extension }}"
---
File content here
```

#### Template Includes
```liquid
{% include 'shared/header' %}

Main content here

{% include 'shared/footer' %}
```

## cookbook.yml Configuration

**Optional**: Use `cookbook.yml` for cookbook-specific configuration.

### When to Use cookbook.yml

1. **Single-cookbook packages**: When your npm package contains only one cookbook
2. **Complex cookbooks**: When you need cookbook-specific variables or hooks
3. **Recipe discovery**: When you want to explicitly list available recipes

### Basic Structure

```yaml
name: "typescript"
description: "TypeScript configuration cookbook"
version: "1.0.0"

# Default recipe for this cookbook
defaultRecipe: "setup"

# List available recipes (optional)
recipes:
  - name: "setup"
    description: "Basic TypeScript setup"
    path: "./setup"
  - name: "strict"
    description: "Strict TypeScript configuration"
    path: "./strict"

# Cookbook-specific variables
variables:
  tsVersion:
    type: "string"
    default: "^5.0.0"
    description: "TypeScript version"
```

### Inheritance

Cookbooks can extend other cookbooks:

```yaml
extends: "../base-typescript"
```

### Lifecycle Hooks

Define hooks that run before/after recipe execution:

```yaml
hooks:
  preExecute: "./hooks/pre-execute.js"
  postExecute: "./hooks/post-execute.js"
```

## recipe.yml Configuration

Recipe configuration is already implemented in Hypergen. See the [official documentation](https://hypergen.dev) for details.

### Key Features

- **Variables**: Rich type system with validation
- **Steps**: Multi-step workflows with different tools
- **Conditions**: Conditional step execution
- **Inheritance**: Can inherit variables from kit/cookbook

### Example

```yaml
name: "create"
description: "Create a new TypeScript project"

# Inherit variables from kit/cookbook
inheritVariables: true

# Recipe-specific variables
variables:
  projectName:
    type: "string"
    prompt: "Project name?"
    required: true
    validate:
      pattern: "^[a-z][a-z0-9-]*$"
      message: "Must be lowercase alphanumeric with hyphens"

# Execution steps
steps:
  - name: "Create project structure"
    tool: "template"
    template: "./templates/project-structure"
```

## Best Practices

### 1. Define Sensible Defaults

Always provide defaults so users can run `hypergen KIT` without arguments:

```yaml
# For cookbook-based kits
defaults:
  cookbook: "repo"
  recipe: "create"

# For direct recipe kits
defaults:
  recipe: "init"  # Default direct recipe

# Mixed approach
defaults:
  cookbook: "repo"      # Default cookbook
  recipe: "create"      # Default recipe within cookbook
  directRecipe: "init"  # Default direct recipe
```

### 2. Use Hierarchical Defaults

For kits with multiple cookbooks, define cookbook-specific defaults:

```yaml
defaults:
  cookbook: "repo"
  recipe: "create"
  cookbookDefaults:
    toolchain: "node"
    tasks: "typescript"
    testing: "vitest"
```

### 3. Keep Cookbooks Focused

Each cookbook should have a clear purpose:
- `repo` - Repository-level operations
- `toolchain` - Runtime configuration
- `tasks` - Development tool tasks
- `project` - Project management

### 4. Use Direct Recipes Appropriately

Direct recipes are great for:
- Simple, one-off recipes that don't need organization
- Kit-level initialization or setup
- Quick commands users run frequently

Example:
```yaml
# kit.yml
recipes:
  - "./recipes/init"
  - "./recipes/help"
  - "./recipes/upgrade"

defaults:
  directRecipe: "help"  # Show help by default
```

### 5. Document Your Configuration

Include examples in your kit documentation:

```yaml
# In kit.yml
examples:
  - command: "hypergen moon"
    description: "Create a new monorepo (uses defaults)"
  - command: "hypergen moon toolchain node"
    description: "Add Node.js toolchain"
```

### 5. Use Shared Resources

For common templates across recipes:

```yaml
shared:
  templates:
    - "./shared/templates/*.liquid"
```

## Migration Guide

### From Single Recipe to Multiple Recipes

1. Create cookbook directories
2. Move existing recipe to `cookbooks/COOKBOOK/RECIPE/`
3. Create `kit.yml` with cookbook references
4. Define sensible defaults

### Adding Direct Recipes

1. Create `recipes/` directory in your kit
2. Create recipe directories with `recipe.yml` files
3. Add glob pattern to kit.yml:
   ```yaml
   recipes:
     - "./recipes/*/recipe.yml"
   ```
4. Define default direct recipe if needed:
   ```yaml
   defaults:
     directRecipe: "init"
   ```

### Adding cookbook.yml

1. Create `cookbook.yml` in cookbook directory
2. Define `defaultRecipe` if needed
3. List recipes for discovery (optional)
4. Add cookbook-specific variables if needed

## Troubleshooting

### Common Issues

1. **"No cookbook specified and no default defined"**
   - Add `defaults.cookbook` to kit.yml
   - For direct recipe kits, set `defaults.recipe` instead

2. **"No recipe specified and no default found"**
   - For cookbook recipes: Add `defaultRecipe` to cookbook or cookbook reference
   - For direct recipes: Add `defaults.recipe` or `defaults.directRecipe` to kit.yml
   - Check if the recipe exists in the expected location

3. **Recipe not found**
   - Verify recipe exists in correct directory
   - Check cookbook.yml recipes list
   - Verify glob patterns in kit.yml match your file structure
   - For direct recipes: Check the `recipes` glob patterns

4. **Direct recipe not found**
   - Verify the recipe exists in a directory matched by the glob
   - Check that the directory contains a `recipe.yml` file
   - Ensure glob pattern is correct: `"./recipes/*/recipe.yml"`

### Debug Mode

Enable debug logging to see configuration resolution:

```bash
DEBUG=hypergen hypergen moon
```

## Future Enhancements

1. **Dynamic Recipe Discovery**: Auto-discover recipes without explicit listing
2. **Recipe Aliases**: Allow multiple names for same recipe
3. **Conditional Defaults**: Different defaults based on context
4. **Recipe Inheritance**: Recipes can extend other recipes
5. **Configuration Validation**: Built-in validation for all config files

## References

- [Configuration Schema Design](CONFIG_SCHEMA_DESIGN.md) - Complete schema specification
- [TypeScript Types](types/config.ts) - Type definitions
- JSON Schemas:
  - [kit.schema.json](schemas/kit.schema.json)
  - [cookbook.schema.json](schemas/cookbook.schema.json)
- [Hypergen Documentation](https://hypergen.dev) - Official documentation