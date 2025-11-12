# Schemas Module

**JSON Schema definitions and configuration templates**

## Overview

The schemas module contains JSON Schema definitions and configuration file templates. These schemas define the structure for mintlify-tsdocs configuration files, though many of the defined options are inherited from the original api-documenter and may not be fully implemented in the current mintlify-tsdocs version.

## Files

### `mintlify-tsdocs.schema.json`

JSON Schema definition for mintlify-tsdocs configuration files.

**Purpose:** Provides IDE autocomplete and validation for configuration files.

**Schema Structure:**

```json
{
  "title": "API Documenter Configuration",
  "type": "object",
  "properties": {
    "$schema": "string",
    "outputTarget": "enum[docfx, markdown]",
    "newlineKind": "enum[crlf, lf, os]",
    "newDocfxNamespaces": "boolean",
    "plugins": "array",
    "tableOfContents": "object",
    "showInheritedMembers": "boolean"
  },
  "additionalProperties": false
}
```

**Configuration Options:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `$schema` | string | - | JSON Schema URL for validation |
| `outputTarget` | enum | - | Output format: `docfx` or `markdown` |
| `newlineKind` | enum | `crlf` | Newline style: `crlf`, `lf`, or `os` |
| `newDocfxNamespaces` | boolean | - | Enable namespace documentation (DocFX only) |
| `plugins` | array | - | Plugin packages to load |
| `tableOfContents` | object | - | Table of contents configuration |
| `showInheritedMembers` | boolean | - | Show inherited members on API pages |

**Usage in IDE:**

```json
{
  "$schema": "./node_modules/mintlify-tsdocs/lib/schemas/mintlify-tsdocs.schema.json",
  "outputTarget": "markdown",  // ← Autocomplete works here
  "newlineKind": "lf"          // ← Validation applies here
}
```

**Code Quality:** ⭐⭐⭐ (see issues below)

---

### `mintlify-tsdocs-template.json`

Template configuration file with commented examples.

**Purpose:** Starter configuration file for new projects.

**Features:**
- ✅ All configuration options documented with inline comments
- ✅ Default values specified
- ✅ Example plugin configuration
- ✅ Detailed table of contents configuration

**Usage:**

```bash
# Copy template to project
cp node_modules/mintlify-tsdocs/lib/schemas/mintlify-tsdocs-template.json \
   ./api-documenter.json

# Customize as needed
vim api-documenter.json
```

**Example Configuration:**

```jsonc
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

**Code Quality:** ⭐⭐⭐⭐

## Usage for Contributors

### Adding New Configuration Options

To add a new configuration option:

1. **Update schema:**
```json
// mintlify-tsdocs.schema.json
{
  "properties": {
    // ... existing properties ...
    "myNewOption": {
      "description": "Description of the new option",
      "type": "boolean",
      "default": false
    }
  }
}
```

2. **Update template:**
```jsonc
// mintlify-tsdocs-template.json
{
  /**
   * My new option description.
   *
   * DEFAULT VALUE: false
   */
  // "myNewOption": false
}
```

3. **Implement in code:**
```typescript
// src/cli/BaseAction.ts or similar
interface DocumenterConfig {
  myNewOption?: boolean;
}

const config = this._loadConfig();
if (config.myNewOption) {
  // Handle the option
}
```

4. **Document in README or docs:**
```markdown
## Configuration Options

### myNewOption

Controls whether...

**Type:** `boolean`
**Default:** `false`

**Example:**
```json
{
  "myNewOption": true
}
```

### Schema Validation

The schemas are copied to `lib/schemas/` during build via `package.json` build script:

```json
{
  "scripts": {
    "build": "tsc && cp -r src/schemas lib/"
  },
  "files": [
    "lib/schemas/"
  ]
}
```

**Validation in Code:**

```typescript
import * as fs from 'fs';
import Ajv from 'ajv';

const ajv = new Ajv();
const schema = require('../schemas/mintlify-tsdocs.schema.json');
const validate = ajv.compile(schema);

const config = JSON.parse(fs.readFileSync('api-documenter.json', 'utf-8'));

if (!validate(config)) {
  console.error('Invalid configuration:', validate.errors);
  process.exit(1);
}
```

### Testing Configuration Options

```typescript
describe('Configuration Schema', () => {
  it('should validate correct configuration', () => {
    const config = {
      outputTarget: 'markdown',
      newlineKind: 'lf'
    };

    const valid = validate(config);
    expect(valid).toBe(true);
  });

  it('should reject invalid outputTarget', () => {
    const config = {
      outputTarget: 'invalid'
    };

    const valid = validate(config);
    expect(valid).toBe(false);
    expect(validate.errors).toContainEqual(
      expect.objectContaining({
        keyword: 'enum',
        params: { allowedValues: ['docfx', 'markdown'] }
      })
    );
  });
});
```

## Known Issues

### 🔴 Critical

**None identified**

### 🟡 Major

1. **Unimplemented Options** (mintlify-tsdocs.schema.json)
   - **Issue**: Many schema options aren't implemented in mintlify-tsdocs
   - **Options**: `outputTarget`, `newDocfxNamespaces`, `tableOfContents`, `showInheritedMembers`
   - **Impact**: Misleading documentation, users may try to use non-functional options
   - **Fix**: Either implement or remove unused options:
   ```json
   {
     "properties": {
       // Remove or mark as deprecated
       "outputTarget": {
         "description": "[DEPRECATED] Not used in mintlify-tsdocs",
         "type": "string",
         "enum": ["markdown"]  // Only support markdown
       }
     }
   }
   ```

2. **No Schema Validation in CLI** (schemas)
   - **Issue**: Schemas exist but aren't used for validation
   - **Impact**: Invalid configurations silently accepted
   - **Fix**: Add validation to CLI:
   ```typescript
   import Ajv from 'ajv';
   import * as schema from '../schemas/mintlify-tsdocs.schema.json';

   const ajv = new Ajv();
   const validate = ajv.compile(schema);

   if (!validate(config)) {
     throw new ValidationError(
       'Invalid configuration',
       { data: { errors: validate.errors } }
     );
   }
   ```

3. **Hardcoded Schema URL** (mintlify-tsdocs-template.json:5)
   - **Issue**: Points to microsoft.com URL that may not exist
   - **Impact**: Schema validation fails in offline scenarios
   - **Fix**: Use local schema or make URL configurable:
   ```json
   {
     "$schema": "./node_modules/mintlify-tsdocs/lib/schemas/mintlify-tsdocs.schema.json"
   }
   ```

### 🟢 Minor

4. **JSON Comments in Template**
   - **Issue**: JSON doesn't support comments, uses `.json` extension
   - **Impact**: Standard JSON parsers will fail
   - **Mitigation**: Rename to `.jsonc` or document that it's JSONC:
   ```bash
   mv mintlify-tsdocs-template.json mintlify-tsdocs-template.jsonc
   ```

5. **Missing Required Properties**
   - **Issue**: Schema doesn't mark any properties as required
   - **Impact**: Empty config files are considered valid
   - **Enhancement**: Add required properties:
   ```json
   {
     "required": ["outputTarget"],
     "properties": { ... }
   }
   ```

6. **No Examples in Schema**
   - **Issue**: Schema lacks `examples` property for each option
   - **Impact**: Less helpful IDE autocomplete
   - **Enhancement**: Add examples:
   ```json
   {
     "newlineKind": {
       "description": "Newline style",
       "type": "string",
       "enum": ["crlf", "lf", "os"],
       "examples": ["lf"]
     }
   }
   ```

7. **Table of Contents Schema Too Permissive**
   - **Issue**: `"additionalProperties": true` allows any properties
   - **Impact**: Typos won't be caught
   - **Fix**: Define explicit schema:
   ```json
   {
     "tableOfContents": {
       "type": "object",
       "properties": {
         "catchAllCategory": { "type": "string" },
         "noDuplicateEntries": { "type": "boolean" },
         "filterByApiItemName": { "type": "boolean" },
         "filterByInlineTag": { "type": "string" }
       },
       "additionalProperties": false
     }
   }
   ```

## Performance Characteristics

### Schema Validation

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Load schema | O(1) | Cached after first load |
| Validate config | O(n) | n = config properties |
| Compile schema | O(m) | m = schema size |

**Memory:** ~10KB per schema

**Best Practices:**
- Compile schema once, reuse validator
- Cache validated configs
- Skip validation in production if config is bundled

## Dependencies

### External Dependencies
- None - Pure JSON files

### Runtime Dependencies (if validation used)
- `ajv` - JSON Schema validator (optional)

## Related Modules

- **`cli/`** - Could use schemas for config validation
- **`documenters/`** - Could read configuration options

## References

- [JSON Schema Specification](https://json-schema.org/)
- [Ajv JSON Schema Validator](https://ajv.js.org/)
- [VS Code JSON Schema Support](https://code.visualstudio.com/docs/languages/json#_json-schemas-and-settings)

---

## Quick Reference

### Using Schema in Project

**In package.json:**
```json
{
  "name": "my-project",
  "scripts": {
    "docs": "mintlify-tsdocs markdown -i docs/api"
  }
}
```

**In api-documenter.json:**
```json
{
  "$schema": "./node_modules/mintlify-tsdocs/lib/schemas/mintlify-tsdocs.schema.json",
  "outputTarget": "markdown",
  "newlineKind": "lf"
}
```

### Available Configuration Options

**Currently Implemented:**
- None - mintlify-tsdocs uses CLI parameters instead

**Schema Defined (Not Implemented):**
- `outputTarget` - Output format
- `newlineKind` - Newline style
- `newDocfxNamespaces` - Namespace documentation
- `plugins` - Plugin system
- `tableOfContents` - TOC configuration
- `showInheritedMembers` - Inheritance display

**Note:** The schema is inherited from api-documenter but mintlify-tsdocs uses a different configuration approach via CLI parameters. Consider updating or removing these schemas.
