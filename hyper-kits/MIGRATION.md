# Migration Guide: Tera to LiquidJS

This guide helps you migrate from the original Tera-based moon templates to the new Hypergen kit with LiquidJS templates.

## Overview

The moon templates have been reorganized from a single collection of Tera templates into a single comprehensive Hypergen kit with multiple cookbooks:

1. **@hyper-kits/moon** - Single kit containing multiple cookbooks:
   - **repo** - Repository management
   - **toolchain** - Runtime toolchain management
   - **tasks** - Task configuration for specific tools
   - **project** - Project management within monorepos

## Key Changes

### 1. Template Engine
- **From**: Tera (`*.tera` files)
- **To**: LiquidJS (`*.liquid` files)

### 2. Organization
- **From**: Single template directory with all files
- **To**: Multiple cookbooks with focused recipes

### 3. Configuration
- **From**: `template.yml` with variables and skip conditions
- **To**: `recipe.yml` with variables and steps

### 4. File Updates
- **From**: Templates only create new files
- **To**: Templates can update existing files with injection

## Template Syntax Changes

### Conditionals

**Tera:**
```tera
{% if "eslint" in tags -%}
"eslint": "^8.56.0",
{% endif -%}
```

**LiquidJS:**
```liquid
{%- if tools contains "eslint" %}
"eslint": "^8.56.0",
{%- endif %}
```

### Loops

**Tera:**
```tera
{% for output in outputs %}
  - {{output}}
{% endfor %}
```

**LiquidJS:**
```liquid
{%- for format in formats %}
- "{{ format }}"
{%- endfor %}
```

### String Operations

**Tera:**
```tera
{{ name | upper }}
```

**LiquidJS:**
```liquid
{{ name | upcase }}
```

### Array Operations

**Tera:**
```tera
{% if languages is containing("typescript") %}
```

**LiquidJS:**
```liquid
{%- if tools contains "typescript" %}
```

## File Injection

The new system supports updating existing files:

```yaml
---
to: .moon/toolchain.yml
inject: true
after: "node:"
---
# New content to inject
```

## Migration Steps

### Step 1: Install Cookbooks

```bash
# Install all moon-related cookbooks
npm install -g @hyper-kits/moon @hyper-kits/toolchain @hyper-kits/tasks
```

### Step 2: Replace Template Usage

**Old (Tera):**
```bash
# Using moon templates directly
moon generate moon.repo
```

**New (Hypergen):**
```bash
# Using Hypergen cookbooks
hypergen @hyper-kits/moon create
```

### Step 3: Update Custom Templates

If you have custom Tera templates, convert them to LiquidJS:

1. Change file extension from `.tera` to `.liquid`
2. Update syntax as shown above
3. Add proper frontmatter for file injection if needed
4. Test with the new recipe system

### Step 4: Migrate Variables

**Old Tera Variables:**
- `tags` - Array of selected tools
- `languages` - Array of languages
- `platform` - Single platform selection

**New LiquidJS Variables:**
- `tools` - Array of selected tools
- `platform` - Single platform selection
- `project_types` - Array of project types
- `package_manager` - Package manager selection

## Common Patterns

### 1. Tool Selection

**Old:**
```tera
{% if "eslint" in tags %}
  // Include ESLint configuration
{% endif %}
```

**New:**
```liquid
{%- if tools contains "eslint" %}
  // Include ESLint configuration
{%- endif %}
```

### 2. Multiple Selections

**Old:**
```tera
{% for type in projectTypes %}
  - "{{ type }}/*"
{% endfor %}
```

**New:**
```liquid
{%- for type in project_types %}
  - "{{ type }}/*"
{%- endfor %}
```

### 3. Conditional File Generation

**Old:**
```yaml
---
skip: {{ "typescript" not in languages }}
---
```

**New:**
```yaml
---
to: .moon/tasks/tag-typescript.yml
# No skip needed - recipe handles this
---
```

## Recipe Structure

### Old Template Structure
```
moon.repo/
├── template.yml
├── package.json.tera
├── .moon/
│   ├── workspace.yml.tera
│   └── tasks/
│       └── *.yml.tera
└── README.md.tera
```

### New Recipe Structure
```
@hyper-kits/moon/
├── kit.yml
├── create/
│   ├── recipe.yml
│   └── templates/
│       ├── package.json.liquid
│       └── ...
├── toolchain/
│   ├── recipe.yml
│   └── templates/
└── project/
    ├── recipe.yml
    └── templates/
```

## Benefits of Migration

1. **Better UX**: Interactive prompts with validation
2. **Composability**: Use only what you need
3. **Maintainability**: Smaller, focused cookbooks
4. **File Updates**: Can modify existing configurations
5. **Performance**: Faster loading and execution

## Troubleshooting

### Common Issues

1. **Variable not found**: Check variable names match between recipe and template
2. **Syntax errors**: Ensure proper LiquidJS syntax (note the `{%-` vs `{%`)
3. **File not updating**: Verify `inject: true` and correct positioning

### Debug Mode

Run Hypergen with debug output:
```bash
DEBUG=hypergen hypergen @hyper-kits/moon create
```

## Getting Help

- Check the [Hypergen documentation](https://hypergen.dev)
- Review the [Moon documentation](https://moonrepo.dev)
- File issues on the [GitHub repository](https://github.com/hypergen/hyper-kits)

## Summary

The migration from Tera to LiquidJS brings significant improvements in usability and maintainability. While the syntax changes require some updates, the benefits of the new system make it worthwhile. The modular cookbook approach allows for more focused and reusable configurations."}

Let me run the test script to verify everything works:

```bash
bash /work/hyperdev/hyper-kits/test-recipes.sh
```