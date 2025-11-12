# JSON Schemas

This document explains the JSON schemas included in `mintlify-tsdocs` and their purpose.

**Location:** `@src/schemas/`

## Overview

The schemas directory contains JSON Schema files that define the structure and validation rules for configuration files used by `mintlify-tsdocs`. These schemas enable:

- **Editor support** - IntelliSense and autocomplete in VS Code and other IDEs
- **Validation** - Automatic validation of configuration files
- **Documentation** - Self-documenting configuration format

## Schema Files

### 1. mintlify-tsdocs.schema.json

**Purpose:** Defines the configuration file structure for API Documenter.

**Location:** `src/schemas/mintlify-tsdocs.schema.json`

**Usage:** Reference this schema in your configuration file to enable validation:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/mintlify-tsdocs.schema.json"
}
```

#### Schema Structure

```json
{
  "title": "API Documenter Configuration",
  "type": "object",
  "properties": {
    "$schema": {
      "description": "URL of the schema for validation",
      "type": "string"
    },
    "outputTarget": {
      "description": "Type of documentation to generate",
      "type": "string",
      "enum": ["docfx", "markdown"]
    },
    "newlineKind": {
      "description": "Newline style for output files",
      "type": "string",
      "enum": ["crlf", "lf", "os"],
      "default": "crlf"
    },
    "newDocfxNamespaces": {
      "description": "Enable namespace documentation (DocFX only)",
      "type": "boolean"
    },
    "plugins": {
      "description": "Plugin packages to load",
      "type": "array"
    },
    "tableOfContents": {
      "description": "Table of contents configuration",
      "type": "object",
      "additionalProperties": true
    },
    "showInheritedMembers": {
      "description": "Show inherited members on API pages",
      "type": "boolean"
    }
  }
}
```

#### Properties Explained

##### `outputTarget`
**Type:** `"docfx" | "markdown"`
**Purpose:** Specifies output format

**Note:** For `mintlify-tsdocs`, this is largely legacy. The tool now focuses on Mintlify-compatible MDX output, which is invoked via the CLI rather than configuration file.

##### `newlineKind`
**Type:** `"crlf" | "lf" | "os"`
**Default:** `"crlf"`
**Purpose:** Controls line ending style in generated files

**Recommendations:**
- `"lf"` - For Linux/macOS projects or when committing to Git
- `"crlf"` - For Windows projects
- `"os"` - Match the operating system default

##### `newDocfxNamespaces`
**Type:** `boolean`
**Purpose:** Enables namespace documentation for DocFX output

**Note:** This is a DocFX-specific feature and doesn't apply to Mintlify MDX generation.

##### `plugins`
**Type:** `array`
**Purpose:** Defines plugin packages to extend functionality

**Example:**
```json
{
  "plugins": [
    {
      "packageName": "doc-plugin-example",
      "enabledFeatureNames": ["example-feature"]
    }
  ]
}
```

**Note:** Plugin support is inherited from the original API Documenter. Custom Mintlify plugins are not currently supported but could be added in future versions.

##### `tableOfContents`
**Type:** `object`
**Purpose:** Configures table of contents generation

**Note:** For Mintlify, navigation is controlled via the `docs.json` file and CLI parameters (`--tab-name`, `--group`) rather than this configuration.

##### `showInheritedMembers`
**Type:** `boolean`
**Default:** `false`
**Purpose:** When true, inherited members are documented on each class's page

### 2. mintlify-tsdocs-template.json

**Purpose:** Provides a template/example configuration file with comments explaining each option.

**Location:** `src/schemas/mintlify-tsdocs-template.json`

**Usage:** Copy this file to your project root as `api-documenter.json` or `mintlify-tsdocs.json` and customize as needed.

#### Key Sections

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/mintlify-tsdocs.schema.json",

  "outputTarget": "markdown",

  "newlineKind": "lf",

  "plugins": [],

  "tableOfContents": {
    "catchAllCategory": "References",
    "noDuplicateEntries": true,
    "filterByApiItemName": false,
    "filterByInlineTag": "@docCategory"
  },

  "showInheritedMembers": false
}
```

## Configuration vs. CLI Parameters

### When to Use Configuration Files

Configuration files (`api-documenter.json`) are useful for:
- Setting default output preferences
- Configuring plugins
- Defining table of contents structure for DocFX output

### When to Use CLI Parameters

For Mintlify-specific features, use CLI parameters instead:

```bash
mintlify-tsdocs markdown \
  -i ./temp \
  -o ./docs/api \
  --docs-json ./docs/docs.json \
  --tab-name "API Reference" \
  --group "Core Package" \
  --menu \
  --readme
```

**Why?** The CLI parameters provide Mintlify-specific functionality that isn't part of the legacy configuration schema.

## Practical Examples

### Example 1: Basic Configuration

Create `api-documenter.json` in your project root:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/mintlify-tsdocs.schema.json",
  "outputTarget": "markdown",
  "newlineKind": "lf",
  "showInheritedMembers": false
}
```

Then run:
```bash
mintlify-tsdocs markdown -i ./temp -o ./docs/api
```

### Example 2: With Plugins

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/mintlify-tsdocs.schema.json",
  "outputTarget": "markdown",
  "plugins": [
    {
      "packageName": "@microsoft/api-documenter-plugin-example",
      "enabledFeatureNames": ["custom-tags"]
    }
  ]
}
```

### Example 3: Showing Inherited Members

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/mintlify-tsdocs.schema.json",
  "outputTarget": "markdown",
  "showInheritedMembers": true
}
```

**Result:** When `showInheritedMembers` is true, if `ChildClass` extends `ParentClass`, the documentation for `ChildClass` will include all methods and properties from `ParentClass`.

## IDE Support

### VS Code

When you create a configuration file with the `$schema` property, VS Code automatically provides:

1. **Autocomplete** - Ctrl+Space shows available properties
2. **Validation** - Invalid values are highlighted with red squiggles
3. **Hover Documentation** - Hover over properties to see descriptions
4. **Quick Info** - See allowed values for enum properties

### Other IDEs

Most modern IDEs that support JSON Schema will provide similar features:
- IntelliJ IDEA
- WebStorm
- Sublime Text (with plugins)
- Vim/Neovim (with plugins)

## Schema Validation in CI/CD

You can validate configuration files in your CI pipeline:

```bash
# Using ajv-cli
npm install -g ajv-cli
ajv validate -s src/schemas/mintlify-tsdocs.schema.json -d api-documenter.json

# Using check-jsonschema
pip install check-jsonschema
check-jsonschema --schemafile src/schemas/mintlify-tsdocs.schema.json api-documenter.json
```

## Future Enhancements

The schema system could be extended to support:

1. **Mintlify-specific configuration**
   - Component preferences (which Mintlify components to use)
   - Icon mapping rules
   - Custom frontmatter templates

2. **Template customization**
   - MDX template paths
   - Custom heading levels
   - Section ordering preferences

3. **Type analysis configuration**
   - Nesting depth limits
   - Type simplification rules
   - Custom type display names

4. **Navigation structure**
   - Group organization rules
   - Sorting preferences
   - Icon selection logic

## Migration from API Documenter

If you're migrating from the original API Documenter:

1. Your existing `api-documenter.json` will continue to work
2. The `outputTarget` should be set to `"markdown"`
3. DocFX-specific options will be ignored
4. Add Mintlify-specific options via CLI parameters

**Example Migration:**

**Before (API Documenter):**
```bash
api-documenter markdown -i ./temp -o ./docs
```

**After (mintlify-tsdocs):**
```bash
mintlify-tsdocs markdown \
  -i ./temp \
  -o ./docs/api \
  --docs-json ./docs/docs.json \
  --tab-name "API" \
  --group "Reference"
```

## Related Documentation

- [CLI Layer](./cli-layer.md) - Command-line parameters and options
- [Architecture](./architecture.md) - Overall tool architecture
- [API Extractor Configuration](https://api-extractor.com/pages/setup/configure_api_report/) - Generating .api.json files

## Resources

- [JSON Schema Official Site](https://json-schema.org/)
- [VS Code JSON Schema Support](https://code.visualstudio.com/docs/languages/json#_json-schemas-and-settings)
- [API Extractor Documentation](https://api-extractor.com/)
