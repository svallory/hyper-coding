# Configuration Schema Design for Hypergen Kits

## Overview

This document outlines the proposed configuration schemas for Hypergen's kit system, supporting both single-cookbook packages and multi-cookbook kits with default recipe functionality.

## Configuration Files

### 1. kit.yml - Kit-Level Configuration

Defines the kit metadata, available cookbooks, and default behaviors.

```yaml
# kit.yml
name: "@hyper-kits/moon"
description: "Comprehensive Moon monorepo management kit"
version: "1.0.0"
author: "Hypergen Team"
homepage: "https://github.com/hypergen/hyper-kits"
repository: "https://github.com/hypergen/hyper-kits/tree/main/moon"

# Default cookbook, recipe, or direct recipe when running `hypergen KIT`
defaults:
  cookbook: "repo"        # Default cookbook (optional)
  recipe: "create"        # Default recipe within default cookbook (optional)
  directRecipe: "init"    # Default direct recipe when no cookbook specified (optional)

  # Per-cookbook defaults (optional)
  cookbookDefaults:
    toolchain: "node"     # Default recipe for toolchain cookbook
    tasks: "typescript"   # Default recipe for tasks cookbook

# Cookbooks available in this kit
# Accepts a single glob or an array of globs.
# Globs can match `cookbook.yml` files or folders.
# If a folder matched by a glob does not contain a `cookbook.yml` file,
# it is NOT ignored as long as it has at least one recipe.
# @default './**/cookbook.yml'
cookbooks:
  - "./cookbooks/*/cookbook.yml"
  - "./cookbooks/*/"  # Also match folders without cookbook.yml

# Direct recipes that don't belong to a cookbook
# Accepts a single glob or an array of globs.
# Globs can match `recipe.yml` files or folders.
# If a folder matched by a glob does not contain a `recipe.yml` file,
# it is silently ignored.
# @default './recipes/**/recipe.yml'
recipes:
  - "./recipes/*/recipe.yml"
  - "./recipes/*/"  # Also match folders without recipe.yml

# Kit-wide variables that can be referenced in recipes
variables:
  moonVersion:
    type: "string"
    default: "^1.22.0"
    description: "Moon version constraint"

  # Variables can reference other variables
  nodeVersion:
    type: "string"
    default: "20.11.0"
    description: "Default Node.js version"

# Metadata for discovery and categorization
tags:
  - "monorepo"
  - "moon"
  - "typescript"
  - "javascript"

categories:
  - "Development Tools"
  - "Monorepo Management"

# Optional: Define shared templates or partials
shared:
  templates:
    - "./shared/templates/*.liquid"
  partials:
    - "./shared/partials/*.liquid"
```

### 2. cookbook.yml - Cookbook-Level Configuration (Optional)

For single-cookbook packages or when you want to define cookbook-specific settings.

```yaml
# cookbook.yml (optional)
name: "typescript"
description: "TypeScript configuration cookbook"
version: "1.0.0"

# Default recipe for this cookbook
defaultRecipe: "setup"

# Cookbook-specific variables
variables:
  tsVersion:
    type: "string"
    default: "^5.0.0"
    description: "TypeScript version"

# Recipe discovery
recipes:
  - name: "setup"
    description: "Basic TypeScript setup"
    path: "./setup"

  - name: "strict"
    description: "Strict TypeScript configuration"
    path: "./strict"

  - name: "library"
    description: "Library-optimized TypeScript config"
    path: "./library"

# Optional: Inherit from another cookbook
extends: "../base-typescript"

# Optional: Define cookbook-level hooks
hooks:
  preExecute: "./hooks/pre-execute.js"
  postExecute: "./hooks/post-execute.js"
```

### 3. recipe.yml - Recipe-Level Configuration

Already implemented in Hypergen, but extended to support cookbook/kit defaults.

```yaml
# recipe.yml
name: "create"
description: "Create a new TypeScript project"
version: "1.0.0"

# Inherit variables from kit or cookbook
inheritVariables: true

# Recipe-specific variables
variables:
  projectName:
    type: "string"
    prompt: "Project name?"
    required: true
    validate:
      pattern: "^[a-z][a-z0-9-]*$"
      message: "Project name must be lowercase alphanumeric with hyphens"

  strictMode:
    type: "boolean"
    prompt: "Enable strict TypeScript mode?"
    default: true

  includeTests:
    type: "enum"
    prompt: "Testing framework?"
    values:
      - "jest"
      - "vitest"
      - "none"
    default: "vitest"

# Multi-step workflow
steps:
  - name: "Create project structure"
    tool: "template"
    template: "./templates/project-structure"

  - name: "Configure TypeScript"
    tool: "template"
    template: "./templates/tsconfig"
    condition: "{{ strictMode }}"

  - name: "Setup tests"
    tool: "recipe"
    recipe: "@hyper-kits/testing/{{ includeTests }}"
    condition: "{{ includeTests != 'none' }}"

  - name: "Initialize git"
    tool: "shell"
    command: "git init && git add ."

# Metadata
tags:
  - "typescript"
  - "setup"

difficulty: "beginner"
estimatedTime: "5 minutes"
```

#### Automatic Template Processing (New)

```yaml
# recipe.yml with automatic template processing
name: "create"
description: "Create a new TypeScript project"
version: "1.0.0"

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

# Templates are automatically processed from ./templates/
# No explicit steps needed for template generation!
# Files are processed based on extension:
# - .liquid.t or .liquid → Processed as Liquid templates
# - .t.* → Processed with extension removed
# - Other files → Copied as-is

# Optional: Pre/post steps for complex workflows
steps:
  pre:
    - name: "Create project directory"
      tool: "shell"
      command: "mkdir -p {{ projectName }}"

  # Templates are processed automatically here

  post:
    - name: "Initialize git"
      tool: "shell"
      command: "git init && git add ."

# Metadata
tags:
  - "typescript"
  - "setup"
difficulty: "beginner"
estimatedTime: "5 minutes"
```

## TypeScript Types

```typescript
// Kit Configuration Types
interface KitConfig {
  name: string;
  description: string;
  version: string;
  author?: string;
  homepage?: string;
  repository?: string;

  defaults?: KitDefaults;
  cookbooks: CookbookReference[];
  variables?: Record<string, VariableConfig>;
  tags?: string[];
  categories?: string[];
  shared?: SharedConfig;
}

interface KitDefaults {
  cookbook: string;
  recipe: string;
  cookbookDefaults?: Record<string, string>; // cookbookName -> defaultRecipe
}

interface CookbookReference {
  name: string;
  description: string;
  path: string;
  defaultRecipe?: string;
}

// Cookbook Configuration Types
interface CookbookConfig {
  name: string;
  description: string;
  version: string;
  defaultRecipe?: string;
  variables?: Record<string, VariableConfig>;
  recipes: RecipeReference[];
  extends?: string;
  hooks?: CookbookHooks;
}

interface RecipeReference {
  name: string;
  description: string;
  path: string;
}

interface CookbookHooks {
  preExecute?: string;
  postExecute?: string;
}

// Enhanced Recipe Types
interface RecipeConfig {
  name: string;
  description: string;
  version?: string;
  inheritVariables?: boolean;
  variables?: Record<string, VariableConfig>;
  steps: StepConfig[];
  tags?: string[];
  difficulty?: "beginner" | "intermediate" | "advanced";
  estimatedTime?: string;
}

interface VariableConfig {
  type: "string" | "number" | "boolean" | "enum" | "array" | "object" | "file" | "directory";
  prompt?: string;
  required?: boolean;
  default?: any;
  description?: string;
  validate?: ValidationConfig;
  values?: string[]; // for enum type
  items?: VariableConfig; // for array type
  properties?: Record<string, VariableConfig>; // for object type
}

interface ValidationConfig {
  pattern?: string;
  message?: string;
  min?: number;
  max?: number;
}

interface StepConfig {
  name: string;
  tool: "template" | "action" | "codemod" | "recipe" | "shell";
  condition?: string;
  [key: string]: any; // Tool-specific configuration
}

// Configuration Resolution
interface ResolvedConfig {
  kit?: KitConfig;
  cookbook?: CookbookConfig;
  recipe: RecipeConfig;
  variables: Record<string, any>;
}
```

## Command Resolution Logic

```typescript
// Resolution order for `hypergen KIT [COOKBOOK] [RECIPE]`
function resolveCommand(kitName: string, cookbookName?: string, recipeName?: string): ResolvedConfig {
  // 1. Load kit.yml
  const kit = loadKitConfig(kitName);

  // 2. Determine cookbook
  const targetCookbook = cookbookName || kit.defaults?.cookbook;
  if (!targetCookbook) {
    throw new Error(`No cookbook specified and no default defined in kit.yml`);
  }

  // 3. Load cookbook (check for cookbook.yml first, then use directory structure)
  const cookbook = loadCookbookConfig(kitName, targetCookbook);

  // 4. Determine recipe
  const targetRecipe = recipeName ||
                       cookbook?.defaultRecipe ||
                       kit.defaults?.cookbookDefaults?.[targetCookbook] ||
                       kit.defaults?.recipe;

  if (!targetRecipe) {
    throw new Error(`No recipe specified and no default found for cookbook: ${targetCookbook}`);
  }

  // 5. Load recipe.yml
  const recipe = loadRecipeConfig(kitName, targetCookbook, targetRecipe);

  // 6. Merge variables (kit → cookbook → recipe)
  const variables = mergeVariables(kit, cookbook, recipe);

  return { kit, cookbook, recipe, variables };
}
```

## Use Cases

### 1. Single Cookbook Package
```yaml
# kit.yml for @hyper-kits/typescript
name: "@hyper-kits/typescript"
description: "TypeScript configuration kit"
version: "1.0.0"

cookbooks:
  - name: "typescript"
    description: "TypeScript configuration"
    path: "./"
    # No defaultRecipe needed - will use recipe.yml in root
```

### 2. Multi-Cookbook Kit with Defaults
```yaml
# kit.yml for @hyper-kits/moon (current implementation)
name: "@hyper-kits/moon"
description: "Comprehensive Moon monorepo management"

defaults:
  cookbook: "repo"
  recipe: "create"
  cookbookDefaults:
    toolchain: "node"
    tasks: "typescript"
```

### 3. Cookbook with Multiple Recipes
```yaml
# cookbook.yml for complex cookbook
name: "frontend"
description: "Frontend framework setup"

defaultRecipe: "react"

recipes:
  - name: "react"
    description: "React with Vite"
    path: "./react"
  - name: "vue"
    description: "Vue with Vite"
    path: "./vue"
  - name: "svelte"
    description: "Svelte with Vite"
    path: "./svelte"
```

## Benefits

1. **Flexibility**: Supports both single and multi-cookbook packages
2. **Discoverability**: Clear defaults and descriptions improve UX
3. **Inheritance**: Variables and configuration can cascade
4. **Extensibility**: Hooks and shared templates enable advanced use cases
5. **Type Safety**: Full TypeScript support with validation
6. **Backward Compatibility**: Existing recipe.yml files continue to work

## Implementation Notes

1. **Lazy Loading**: Load configurations on-demand for performance
2. **Validation**: JSON Schema validation for all config files
3. **Caching**: Cache parsed configurations with invalidation
4. **Migration**: Provide migration tools for existing templates
5. **Documentation**: Auto-generate docs from configuration schemas