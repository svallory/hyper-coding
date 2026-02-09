# Recipe Step System Parser Integration

This document describes the integration of the V8 Recipe Step System with the Hypergen template parser, enabling recipe.yml files to define complex multi-step code generation workflows.

## Overview

The template parser has been enhanced to support the new Recipe Step System while maintaining full backward compatibility with existing template.yml files. The parser can now:

- Parse recipe.yml files with step definitions
- Validate step configurations for all tool types
- Check for circular dependencies
- Convert TemplateConfig to RecipeConfig format
- Maintain compatibility with legacy templates

## Configuration Format

### Legacy Template (Still Supported)

```yaml
name: my-template
description: A simple template
variables:
  name:
    type: string
    required: true
```

### V8 Recipe with Steps (New!)

```yaml
name: my-recipe
description: Recipe with coordinated steps
version: 1.0.0

variables:
  name:
    type: string
    required: true
  skipTests:
    type: boolean
    default: false

steps:
  - name: Generate component
    tool: template
    template: component.jig
    outputDir: src/components
    
  - name: Setup project files
    tool: action
    action: setup-project
    parameters:
      projectType: library
    dependsOn: ["Generate component"]
    
  - name: Add imports
    tool: codemod
    codemod: add-import
    files: ["src/**/*.ts"]
    dependsOn: ["Setup project files"]
    
  - name: Generate tests
    tool: template
    template: test.jig
    when: "!{{ skipTests }}"
    dependsOn: ["Generate component"]
    parallel: true

settings:
  timeout: 30000
  retries: 2
  continueOnError: false
  maxParallelSteps: 3
```

## Step Types and Configuration

### Template Step

Executes a template to generate files.

```yaml
- name: Generate files
  tool: template
  template: component.jig
  outputDir: src/components      # Optional: override output directory
  overwrite: true               # Optional: overwrite existing files
  exclude: ["*.test.ts"]        # Optional: file patterns to exclude
  templateConfig:               # Optional: template-specific config
    variables:
      className: { type: string }
```

### Action Step

Executes a V8 decorator-based action.

```yaml
- name: Setup project
  tool: action
  action: setup-component
  parameters:                   # Optional: action parameters
    projectType: library
  dryRun: false                # Optional: run in dry-run mode
  force: true                  # Optional: force execution
  actionConfig:                # Optional: action-specific config
    communication:
      actionId: setup-1
      subscribeTo: ["project-created"]
```

### CodeMod Step

Executes code transformations.

```yaml
- name: Transform code
  tool: codemod
  codemod: add-import
  files: ["src/**/*.ts"]       # Required: file patterns
  backup: true                 # Optional: create backup files
  parser: typescript           # Optional: typescript, javascript, json, auto
  parameters:                  # Optional: codemod parameters
    importPath: ./utils
  codemodConfig:              # Optional: codemod-specific config
    transform:
      preserveFormatting: true
    validation:
      validateSyntax: true
```

### Recipe Step

Executes another recipe as a sub-recipe.

```yaml
- name: Run sub-recipe
  tool: recipe
  recipe: base-setup
  version: "^1.0.0"           # Optional: version constraint
  inheritVariables: true      # Optional: inherit parent variables
  variableOverrides:          # Optional: override specific variables
    projectType: library
  recipeConfig:               # Optional: recipe-specific config
    execution:
      isolated: true
      workingDir: ./sub-project
```

## Step Features

### Dependencies

Steps can depend on other steps to enforce execution order:

```yaml
steps:
  - name: step1
    tool: template
    template: base.jig
    
  - name: step2
    tool: action
    action: setup
    dependsOn: ["step1"]      # Wait for step1 to complete
    
  - name: step3
    tool: template
    template: final.jig
    dependsOn: ["step1", "step2"]  # Wait for both steps
```

### Conditional Execution

Steps can be conditionally executed based on variable expressions:

```yaml
steps:
  - name: Generate tests
    tool: template
    template: test.jig
    when: "{{ generateTests }}"     # Execute only if generateTests is true
    
  - name: Skip expensive step
    tool: action
    action: expensive-action
    when: "!{{ skipExpensive }}"    # Execute only if skipExpensive is false
```

### Parallel Execution

Steps can run in parallel when dependencies allow:

```yaml
steps:
  - name: base-step
    tool: template
    template: base.jig
    
  - name: parallel-step-1
    tool: template
    template: style.jig
    dependsOn: ["base-step"]
    parallel: true              # Can run in parallel with other parallel steps
    
  - name: parallel-step-2
    tool: template
    template: test.jig
    dependsOn: ["base-step"]
    parallel: true              # Will run simultaneously with parallel-step-1
```

### Error Handling

Configure how steps handle errors:

```yaml
steps:
  - name: optional-step
    tool: action
    action: optional-setup
    continueOnError: true       # Continue recipe if this step fails
    
  - name: critical-step
    tool: template
    template: critical.jig
    retries: 3                  # Retry up to 3 times on failure
    timeout: 60000              # Timeout after 60 seconds
```

## Validation Features

The parser performs comprehensive validation:

### Step Configuration Validation

- **Required fields**: Each step must have `name` and `tool`
- **Tool-specific validation**: Each tool type validates its specific configuration
- **Type checking**: Parameters are validated for correct types
- **Pattern validation**: File patterns and expressions are checked

### Dependency Validation

- **Circular dependency detection**: Prevents infinite loops in step execution
- **Reference validation**: Ensures all dependencies reference existing steps
- **Duplicate name detection**: Step names must be unique within a recipe

### Variable Integration

- **Variable references**: Steps can reference recipe-level variables
- **Type consistency**: Variable usage is checked against definitions
- **Default value handling**: Missing variables use configured defaults

## Parser API

### Basic Usage

```typescript
import { TemplateParser } from './config/template-parser'

// Parse a recipe file
const result = await TemplateParser.parseTemplateFile('recipe.yml')

if (result.isValid) {
  console.log('Recipe parsed successfully:', result.config)
  
  // Check if it uses the Recipe Step System
  if (TemplateParser.isRecipeConfig(result.config)) {
    console.log('This is a V8 recipe with steps:', result.config.steps)
    
    // Convert to RecipeConfig format
    const recipeConfig = TemplateParser.toRecipeConfig(result.config)
    console.log('RecipeConfig:', recipeConfig)
  }
} else {
  console.error('Parsing errors:', result.errors)
  console.warn('Parsing warnings:', result.warnings)
}
```

### Validation Only

```typescript
// Validate step configuration without execution
const errors: string[] = []
const warnings: string[] = []

TemplateParser.validateStepToolConfiguration(step, errors, warnings)

if (errors.length > 0) {
  console.error('Step validation failed:', errors)
}
```

## Migration Guide

### From Legacy Templates

Existing template.yml files continue to work without changes:

```yaml
# This continues to work exactly as before
name: legacy-template
variables:
  name: { type: string, required: true }
```

### To Recipe Steps

To migrate to the Recipe Step System, add a steps array:

```yaml
# Enhanced with steps
name: migrated-recipe
variables:
  name: { type: string, required: true }

steps:
  - name: Generate files
    tool: template
    template: original-template.jig  # Reference your existing template
```

### Gradual Migration

You can start with a single template step and gradually add more steps:

```yaml
name: gradual-migration
variables:
  name: { type: string, required: true }

steps:
  # Start with existing template
  - name: Generate base files
    tool: template
    template: existing-template.jig
    
  # Add new steps incrementally
  - name: Setup additional files
    tool: action
    action: setup-extras
    dependsOn: ["Generate base files"]
```

## Best Practices

### Step Organization

1. **Clear naming**: Use descriptive step names that explain their purpose
2. **Logical grouping**: Group related steps with dependencies
3. **Parallel optimization**: Use parallel execution for independent steps
4. **Error boundaries**: Set appropriate error handling for each step

### Configuration

1. **Variable validation**: Define strict variable types and validation
2. **Default values**: Provide sensible defaults where possible
3. **Documentation**: Use descriptions for complex steps
4. **Version constraints**: Specify version requirements for dependencies

### Performance

1. **Parallel execution**: Identify steps that can run simultaneously
2. **Conditional logic**: Use `when` conditions to skip unnecessary work
3. **Resource management**: Set appropriate timeouts and retry limits
4. **Dependency optimization**: Minimize unnecessary step dependencies

## Error Messages

The parser provides detailed error messages for common issues:

- `Step must have a name (string)` - Missing or invalid step name
- `Step must have a valid tool type` - Invalid or missing tool type
- `Template step must have a template` - Missing template reference
- `Circular dependency detected: step1 -> step2 -> step1` - Circular dependencies
- `Duplicate step name: 'step-name'` - Non-unique step names
- `Step depends on undefined step: 'missing-step'` - Invalid dependency reference

## Integration Points

The Recipe Step System parser integrates with:

- **RecipeEngine**: Executes parsed recipes
- **StepExecutor**: Runs individual steps
- **Tool Registry**: Validates tool-specific configurations
- **Variable System**: Resolves variables across steps
- **Error Handling**: Provides consistent error reporting

This integration enables seamless workflow from parsing to execution while maintaining backward compatibility and extensibility for future enhancements.