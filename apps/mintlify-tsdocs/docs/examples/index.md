# Usage Examples

This document provides practical examples of using `mintlify-tsdocs` in real-world scenarios.

## Table of Contents

1. [Basic Setup](#basic-setup)
2. [Single Package Documentation](#single-package-documentation)
3. [Monorepo with Multiple Packages](#monorepo-with-multiple-packages)
4. [Custom Navigation Structure](#custom-navigation-structure)
5. [README Integration](#readme-integration)
6. [Advanced Type Documentation](#advanced-type-documentation)
7. [CI/CD Integration](#cicd-integration)
8. [Troubleshooting Common Issues](#troubleshooting-common-issues)

---

## Basic Setup

### Prerequisites

```bash
# Install API Extractor globally or as dev dependency
bun add -D @microsoft/api-extractor

# Install mintlify-tsdocs
bun add -D mintlify-tsdocs
```

### Step 1: Configure API Extractor

Create `api-extractor.json` in your project root:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
  "mainEntryPointFilePath": "<projectFolder>/dist/index.d.ts",
  "apiReport": {
    "enabled": false
  },
  "docModel": {
    "enabled": true,
    "apiJsonFilePath": "<projectFolder>/temp/<unscopedPackageName>.api.json"
  },
  "dtsRollup": {
    "enabled": false
  }
}
```

### Step 2: Build TypeScript and Extract API

```bash
# Build your TypeScript project
bun run build

# Extract API documentation
api-extractor run --local
```

### Step 3: Generate Mintlify Documentation

```bash
mintlify-tsdocs markdown \
  -i ./temp \
  -o ./docs/api \
  --docs-json ./docs/docs.json \
  --tab-name "API Reference"
```

**Result:** MDX files are generated in `./docs/api/` and `docs.json` is updated with navigation entries.

---

## Single Package Documentation

### Scenario: Simple TypeScript Library

**Project Structure:**
```
my-library/
├── src/
│   ├── index.ts
│   ├── utils.ts
│   └── types.ts
├── dist/           # Compiled output
├── temp/           # API Extractor output
├── docs/
│   ├── docs.json
│   └── api/        # Generated MDX files
└── package.json
```

### Configuration

**package.json:**
```json
{
  "name": "my-library",
  "scripts": {
    "build": "tsc",
    "docs:extract": "api-extractor run --local",
    "docs:generate": "mintlify-tsdocs markdown -i ./temp -o ./docs/api --docs-json ./docs/docs.json --tab-name 'API' --group 'Core'",
    "docs": "bun run build && bun run docs:extract && bun run docs:generate"
  }
}
```

### Usage

```bash
bun run docs
```

### Generated Output

```
docs/api/
├── index.mdx           # Package overview
├── myfunction.mdx      # Function documentation
├── myclass.mdx         # Class documentation
└── myinterface.mdx     # Interface documentation
```

### docs.json Update

```json
{
  "tabs": [
    {
      "name": "API",
      "navigation": [
        {
          "group": "Core",
          "pages": [
            "api/index",
            "api/myfunction",
            "api/myclass",
            "api/myinterface"
          ]
        }
      ]
    }
  ]
}
```

---

## Monorepo with Multiple Packages

### Scenario: Multiple Packages in a Monorepo

**Project Structure:**
```
monorepo/
├── packages/
│   ├── core/
│   │   ├── src/
│   │   ├── temp/core.api.json
│   │   └── api-extractor.json
│   ├── utils/
│   │   ├── src/
│   │   ├── temp/utils.api.json
│   │   └── api-extractor.json
│   └── plugins/
│       ├── src/
│       ├── temp/plugins.api.json
│       └── api-extractor.json
└── docs/
    ├── docs.json
    └── api/
```

### Build Script

**Root package.json:**
```json
{
  "scripts": {
    "docs:extract": "bun run --filter './packages/*' docs:extract",
    "docs:generate": "bun run docs:generate:core && bun run docs:generate:utils && bun run docs:generate:plugins",
    "docs:generate:core": "mintlify-tsdocs markdown -i ./packages/core/temp -o ./docs/api/core --docs-json ./docs/docs.json --tab-name 'API' --group 'Core Package'",
    "docs:generate:utils": "mintlify-tsdocs markdown -i ./packages/utils/temp -o ./docs/api/utils --docs-json ./docs/docs.json --tab-name 'API' --group 'Utilities'",
    "docs:generate:plugins": "mintlify-tsdocs markdown -i ./packages/plugins/temp -o ./docs/api/plugins --docs-json ./docs/docs.json --tab-name 'API' --group 'Plugins'",
    "docs": "bun run docs:extract && bun run docs:generate"
  }
}
```

### Generated Navigation

```json
{
  "tabs": [
    {
      "name": "API",
      "navigation": [
        {
          "group": "Core Package",
          "pages": [
            "api/core/index",
            "api/core/engine",
            "api/core/config"
          ]
        },
        {
          "group": "Utilities",
          "pages": [
            "api/utils/index",
            "api/utils/helpers",
            "api/utils/formatters"
          ]
        },
        {
          "group": "Plugins",
          "pages": [
            "api/plugins/index",
            "api/plugins/transformer",
            "api/plugins/validator"
          ]
        }
      ]
    }
  ]
}
```

---

## Custom Navigation Structure

### Scenario: Organize API Docs in Multiple Tabs

### Separate Documentation Sections

```bash
# Public API
mintlify-tsdocs markdown \
  -i ./temp/public \
  -o ./docs/api/public \
  --docs-json ./docs/docs.json \
  --tab-name "Public API" \
  --group "Core"

# Internal API
mintlify-tsdocs markdown \
  -i ./temp/internal \
  -o ./docs/api/internal \
  --docs-json ./docs/docs.json \
  --tab-name "Internal API" \
  --group "Advanced"
```

### With Menu Enabled

```bash
mintlify-tsdocs markdown \
  -i ./temp \
  -o ./docs/api \
  --docs-json ./docs/docs.json \
  --tab-name "API Reference" \
  --group "SDK Reference" \
  --menu  # Enables expandable menu for the group
```

### Result in docs.json

```json
{
  "tabs": [
    {
      "name": "Public API",
      "navigation": [
        {
          "group": "Core",
          "pages": ["api/public/..."]
        }
      ]
    },
    {
      "name": "Internal API",
      "navigation": [
        {
          "group": "Advanced",
          "menu": true,
          "pages": ["api/internal/..."]
        }
      ]
    }
  ]
}
```

---

## README Integration

### Scenario: Convert Package README to Index Page

Many packages have a `README.md` with overview information. Convert it to an `index.mdx` page:

```bash
mintlify-tsdocs markdown \
  -i ./temp \
  -o ./docs/api \
  --docs-json ./docs/docs.json \
  --tab-name "API Reference" \
  --group "Getting Started" \
  --readme \
  --readme-title "Overview"
```

### What Happens

1. Finds `README.md` in the input directory
2. Converts Markdown to MDX
3. Adds Mintlify frontmatter
4. Saves as `index.mdx` in the output directory
5. Adds to navigation with title "Overview"

### Generated index.mdx

```mdx
---
title: Overview
description: Package overview and introduction
---

# My Package

Welcome to the documentation...

[Rest of README content]
```

---

## Advanced Type Documentation

### Scenario: Complex TypeScript Types with Nested Objects

**Source TypeScript:**
```typescript
/**
 * Configuration for database connection
 */
export interface DatabaseConfig {
  /**
   * Connection settings
   */
  connection: {
    /**
     * Database host address
     */
    host: string;

    /**
     * Database port number
     */
    port: number;

    /**
     * SSL configuration
     */
    ssl?: {
      /**
       * Enable SSL
       */
      enabled: boolean;

      /**
       * Path to certificate
       */
      cert?: string;
    };
  };

  /**
   * Connection pool settings
   */
  pool?: {
    min: number;
    max: number;
  };
}
```

### Generated MDX Output

```mdx
## DatabaseConfig

Configuration for database connection

### Properties

<ParamField name="connection" type="object" required>
  Connection settings

  <ParamField name="host" type="string" required>
    Database host address
  </ParamField>

  <ParamField name="port" type="number" required>
    Database port number
  </ParamField>

  <ParamField name="ssl" type="object">
    SSL configuration

    <ParamField name="enabled" type="boolean" required>
      Enable SSL
    </ParamField>

    <ParamField name="cert" type="string">
      Path to certificate
    </ParamField>
  </ParamField>
</ParamField>

<ParamField name="pool" type="object">
  Connection pool settings

  <ParamField name="min" type="number" required>
  </ParamField>

  <ParamField name="max" type="number" required>
  </ParamField>
</ParamField>
```

### Rendered in Mintlify

The above generates an interactive, expandable UI where users can:
- Expand/collapse nested objects
- See type information for each property
- Identify required vs. optional fields
- Read JSDoc descriptions for each nested property

---

## CI/CD Integration

### GitHub Actions

**`.github/workflows/docs.yml`:**
```yaml
name: Generate API Documentation

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  docs:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Build TypeScript
        run: bun run build

      - name: Extract API
        run: bun run docs:extract

      - name: Generate Documentation
        run: bun run docs:generate

      - name: Commit Documentation
        if: github.event_name == 'push'
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          git add docs/
          git diff --quiet && git diff --staged --quiet || git commit -m "docs: update API documentation"
          git push
```

### GitLab CI

**`.gitlab-ci.yml`:**
```yaml
stages:
  - build
  - docs

build:
  stage: build
  image: oven/bun:latest
  script:
    - bun install
    - bun run build
  artifacts:
    paths:
      - dist/

docs:
  stage: docs
  image: oven/bun:latest
  dependencies:
    - build
  script:
    - bun install
    - bun run docs:extract
    - bun run docs:generate
  artifacts:
    paths:
      - docs/api/
  only:
    - main
```

### Pre-commit Hook

**`.husky/pre-commit`:**
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Regenerate docs if TypeScript files changed
if git diff --cached --name-only | grep -q '\.ts$'; then
  echo "TypeScript files changed, regenerating API docs..."
  bun run build
  bun run docs:extract
  bun run docs:generate
  git add docs/
fi
```

---

## Troubleshooting Common Issues

### Issue 1: No MDX Files Generated

**Symptoms:**
- Command runs without error
- No files in output directory

**Common Causes:**
1. No `*.api.json` files in input folder
2. Input folder path is incorrect

**Solution:**
```bash
# Verify .api.json files exist
ls -la ./temp/*.api.json

# Run with absolute paths
mintlify-tsdocs markdown \
  -i "$(pwd)/temp" \
  -o "$(pwd)/docs/api" \
  --docs-json "$(pwd)/docs/docs.json"
```

### Issue 2: docs.json Not Updated

**Symptoms:**
- MDX files generated correctly
- Navigation doesn't include new pages

**Common Causes:**
1. `--docs-json` path is incorrect
2. `docs.json` has syntax errors
3. File permissions

**Solution:**
```bash
# Verify docs.json exists and is valid
cat docs/docs.json | jq .

# Ensure file is writable
chmod 644 docs/docs.json

# Try with absolute path
mintlify-tsdocs markdown \
  -i ./temp \
  -o ./docs/api \
  --docs-json "$(pwd)/docs/docs.json"
```

### Issue 3: Nested Properties Not Showing

**Symptoms:**
- Object types show as `object` without nested fields
- Expected `<ParamField>` nesting doesn't appear

**Common Causes:**
1. Type is a reference, not an object literal
2. JSDoc comments missing on nested properties

**Solution:**

**❌ Won't expand:**
```typescript
type Connection = {
  host: string;
  port: number;
};

interface Config {
  connection: Connection;  // Type reference
}
```

**✅ Will expand:**
```typescript
interface Config {
  connection: {  // Inline object literal
    host: string;
    port: number;
  };
}
```

### Issue 4: Special Characters in Output

**Symptoms:**
- Markdown/MDX syntax appears incorrectly
- Special characters like `<`, `>`, `|` cause rendering issues

**Common Causes:**
1. Type strings with special characters not properly escaped
2. JSDoc comments with Markdown syntax

**Solution:**
API Extractor and mintlify-tsdocs handle most escaping automatically. If you encounter issues:

1. Use code blocks in JSDoc comments
2. Escape special characters in type names
3. Simplify complex union types

### Issue 5: Build Performance

**Symptoms:**
- Documentation generation is slow
- Large memory usage

**Common Causes:**
1. Very large API surface
2. Deeply nested types
3. Many packages processed together

**Solution:**
```bash
# Process packages separately
for pkg in packages/*/temp/*.api.json; do
  mintlify-tsdocs markdown -i "$(dirname "$pkg")" -o "./docs/api/$(basename "$pkg" .api.json)"
done

# Use a more powerful machine in CI
# Add caching for node_modules and temp/
```

---

## Advanced Patterns

### Conditional Documentation

Generate docs only for public APIs:

**api-extractor.json:**
```json
{
  "docModel": {
    "enabled": true,
    "includeForgottenExports": false  // Exclude non-exported items
  }
}
```

### Custom Icon Mapping

While not currently supported, you can post-process the generated MDX files to add custom icons:

```bash
# After generating docs
for file in docs/api/*.mdx; do
  # Add custom icon to frontmatter based on file type
  if grep -q "interface" "$file"; then
    sed -i '2i icon: "square-i"' "$file"
  fi
done
```

### Version-specific Documentation

Generate docs for multiple versions:

```bash
# Generate for v1.x
mintlify-tsdocs markdown -i ./temp/v1 -o ./docs/api/v1 --tab-name "API v1"

# Generate for v2.x
mintlify-tsdocs markdown -i ./temp/v2 -o ./docs/api/v2 --tab-name "API v2"
```

---

## Best Practices

1. **Always run build before docs generation**
   ```bash
   bun run build && bun run docs:extract && bun run docs:generate
   ```

2. **Use scripts in package.json**
   - Makes commands consistent across team
   - Easier to maintain
   - Works with CI/CD

3. **Keep input and output separate**
   - Input: `./temp` (gitignored)
   - Output: `./docs/api` (committed)

4. **Document your nested types inline**
   ```typescript
   // ✅ Good - will expand
   interface Config {
     db: { host: string; port: number };
   }

   // ❌ Less discoverable - won't expand
   interface DbConfig { host: string; port: number }
   interface Config { db: DbConfig }
   ```

5. **Add JSDoc comments everywhere**
   - Interfaces
   - Properties
   - Nested fields
   - Type parameters

6. **Review generated docs before committing**
   - Check for rendering issues
   - Verify cross-references work
   - Test in actual Mintlify preview

---

## Next Steps

- [Architecture Overview](./architecture.md) - Understand how it works
- [CLI Reference](./cli-layer.md) - Complete CLI documentation
- [Contributing Guide](../CONTRIBUTING.md) - Contribute to the project
