# Docs Automation

This document explains the two documentation generation systems for `hypergen` and how they integrate with Mintlify.

## Overview

We have configured **two parallel documentation systems** to compare their development experience:

1. **TsDoc System**: Microsoft API Extractor + mintlify-tsdocs → MDX for Mintlify
2. **TypeDoc System**: TypeDoc → HTML documentation for comparison

Both systems are fully operational and can be used independently.

## System 1: TsDoc (Microsoft API Extractor + mintlify-tsdocs)

### Purpose
Generates Mintlify-compatible MDX documentation with automatic navigation integration.

### Key Components
- **`packages/hypergen/api-extractor.json`**: API Extractor configuration
- **`apps/mintlify-tsdocs/`**: Custom tool that converts API data to MDX
- **`apps/docs/packages/hypergen-tsdoc/`**: Output directory for MDX files
- **`apps/docs/docs.json`**: Automatically updated with navigation structure

### Scripts
```bash
# Extract API information to .api.json
bun run tsdoc:extract

# Generate MDX documentation
bun run tsdoc:generate

# Run both steps
bun run tsdoc:all
```

### How it Works
1. **API Extraction**: `api-extractor` analyzes TypeScript source and creates `hypergen.api.json`
2. **MDX Generation**: `mintlify-tsdocs` converts API data to Mintlify-compatible MDX
3. **Navigation Integration**: Automatically updates `docs.json` with proper tab and groups
4. **Output**: Professional MDX files with Mintlify frontmatter

### Expected Output
- **89 MDX pages** generated in `/apps/docs/packages/hypergen-tsdoc/`
- **5 navigation groups** in docs.json (Interfaces, Classes, Functions, etc.)
- **Tab name**: "Hypergen SDK (TsDoc)" in Mintlify sidebar
- **Format**: Mintlify-compatible MDX with frontmatter and components

## System 2: TypeDoc (Direct HTML Generation)

### Purpose
Generates interactive HTML documentation for comparison and standalone use.

### Key Components
- **`packages/hypergen/typedoc.json`**: TypeDoc configuration
- **`apps/docs/packages/hypergen-typedoc/`**: Output directory for HTML

### Scripts
```bash
# Generate HTML documentation
bun run typedoc:generate

# Generate with watch mode for development
bun run typedoc:watch

# Run generation
bun run typedoc:all
```

### Configuration
- **Entry point**: `./src/index.ts`
- **Output**: `../../apps/docs/packages/hypergen-typedoc/`
- **Format**: Standard HTML with assets
- **Plugins**: None (clean TypeDoc output)

### Expected Output
- **Interactive HTML documentation** with search and navigation
- **Multiple files**: `index.html`, `modules.html`, `hierarchy.html`
- **Assets directory**: CSS, JS, and styling resources
- **Professional UI**: Standard TypeDoc appearance with cross-references

## Development Experience Comparison

### TsDoc System
**Best for Mintlify Integration**
- ✅ Native MDX output for Mintlify
- ✅ Automatic docs.json navigation updates
- ✅ Professional API documentation format
- ✅ Handles complex TypeScript types well
- ⚠️ Two-step process (extract → generate)
- ⚠️ More configuration files
- ⚠️ API Extractor warnings about exports/tags

### TypeDoc System
**Best for Standalone Documentation**
- ✅ Simple, single-step generation
- ✅ Interactive HTML with search
- ✅ Standard TypeScript documentation format
- ✅ Quick setup and execution
- ⚠️ Requires manual Mintlify integration
- ⚠️ HTML output needs conversion for MDX systems

## Usage Recommendations

### Use TsDoc When:
- Building documentation for Mintlify sites
- Need automatic navigation integration
- Want professional API reference format
- Working with complex TypeScript APIs

### Use TypeDoc When:
- Need quick standalone documentation
- Want interactive HTML with search
- Prefer simple setup process
- Building general TypeScript project docs

## Package Updates

Both systems use the latest package versions:
- TypeDoc: `^0.28.14`
- Microsoft API Extractor: `^7.55.0`
- TypeScript: `^5.9.3`

## File Locations

| System | Configuration | Scripts | Output |
|--------|--------------|---------|---------|
| **TsDoc** | `api-extractor.json` | `tsdoc:*` | `/apps/docs/packages/hypergen-tsdoc/` |
| **TypeDoc** | `typedoc.json` | `typedoc:*` | `/apps/docs/packages/hypergen-typedoc/` |

## Summary

Both documentation systems are **fully operational** and ready for comparison:

- **TsDoc**: 89 MDX pages with Mintlify integration
- **TypeDoc**: Interactive HTML documentation
- **Both**: Updated to latest versions, properly configured

Choose based on your documentation needs and target platform!
