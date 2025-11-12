# Utils Module

**Utility functions for documentation generation, security, and type analysis**

## Overview

The utils module provides essential utility functions used throughout the documentation generator. It includes security utilities for input validation, helpers for working with API documentation, type analyzers for complex TypeScript types, and general-purpose utilities for file operations and formatting.

## Architecture

### Module Organization

```
utils/
├── SecurityUtils - Input validation, sanitization, path security
├── Utilities - Filename sanitization, API signature generation
├── DocumentationHelper - API item processing and formatting
├── ObjectTypeAnalyzer - TypeScript type structure analysis
├── JsDocExtractor - JSDoc comment extraction
├── IndentedWriter - Indented text output
└── index - Barrel exports
```

### Design Principles

- **Security First**: All user input is validated and sanitized
- **Single Responsibility**: Each utility has one clear purpose
- **Reusability**: Functions are pure and composable
- **Error Handling**: Uses DocumentationError hierarchy

## Files

### `SecurityUtils.ts` ⭐⭐⭐⭐⭐

Security validation and sanitization utilities.

**Key Functions:**

| Function | Purpose |
|----------|---------|
| `validateFilePath(basePath, filePath)` | Prevent path traversal attacks |
| `validateFilename(filename)` | Validate filename safety |
| `sanitizeYamlText(text)` | Escape YAML special characters |
| `validateJsonContent(json)` | Detect dangerous JSON patterns |
| `validateCliInput(input, name)` | Validate CLI parameters |

**Usage Example:**

```typescript
import { SecurityUtils } from '../utils/SecurityUtils';

// Prevent path traversal
const safePath = SecurityUtils.validateFilePath(
  '/project/docs',
  userInput  // Could be "../../../etc/passwd"
);

// Validate filename
const safeFilename = SecurityUtils.validateFilename(
  userInput  // Could be "CON" or "../../secret"
);

// Sanitize YAML frontmatter
const yamlValue = SecurityUtils.sanitizeYamlText(
  'Title with "quotes" and: colons'
);

// Validate JSON
SecurityUtils.validateJsonContent(jsonString);  // Throws on __proto__ etc.
```

**Reserved Filenames:**
- Windows: `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`
- Dangerous: `.htaccess`, `.htpasswd`, `web.config`, `php.ini`
- System: `.git`, `.DS_Store`, `Thumbs.db`

**Security Checks:**
- ✅ Path traversal (`..`, `~`, `/`)
- ✅ Reserved filenames (Windows, system files)
- ✅ Dangerous characters in filenames
- ✅ YAML injection (`__proto__`, `constructor`)
- ✅ JSON prototype pollution
- ✅ Filename length limits (255 chars)
- ✅ CLI injection patterns

---

### `Utilities.ts` ⭐⭐⭐⭐

General-purpose utility functions for API documentation.

**Key Functions:**

| Function | Purpose |
|----------|---------|
| `getConciseSignature(apiItem)` | Generate function signatures |
| `getSafeFilenameForName(name)` | Sanitize names for filenames |

**Usage Example:**

```typescript
import { Utilities } from '../utils/Utilities';

// Generate function signature
const signature = Utilities.getConciseSignature(apiFunction);
// Returns: "getArea(width, height)"

// Create safe filename
const filename = Utilities.getSafeFilenameForName('My Class!');
// Returns: "my_class_"
```

**Filename Sanitization Rules:**
- Converts to lowercase
- Replaces non-alphanumeric characters with `_`
- Removes path traversal patterns
- Limits length to 50 characters
- Falls back to secure default on validation failure

---

### `DocumentationHelper.ts` ⭐⭐⭐⭐

Helper functions for processing API items and generating documentation metadata.

**Key Responsibilities:**
- Extract API item metadata (name, kind, modifiers)
- Generate breadcrumbs and navigation paths
- Format API signatures and descriptions
- Handle inheritance and type hierarchies

**Usage Example:**

```typescript
import { DocumentationHelper } from '../utils/DocumentationHelper';

// Get formatted name
const name = DocumentationHelper.getItemName(apiItem);

// Generate breadcrumb path
const breadcrumb = DocumentationHelper.getBreadcrumb(apiItem);

// Extract modifiers (public, static, readonly, etc.)
const modifiers = DocumentationHelper.getModifiers(apiItem);
```

---

### `ObjectTypeAnalyzer.ts` ⭐⭐⭐⭐

Analyzes and parses complex TypeScript object type structures.

**Purpose:** Convert TypeScript type strings like `{ name: string; age: number }` into structured data for documentation.

**Key Features:**
- ✅ Parse object literals
- ✅ Handle nested types
- ✅ Extract property names and types
- ✅ Support arrays and unions
- ✅ Cache analysis results (performance)

**Usage Example:**

```typescript
import { ObjectTypeAnalyzer } from '../utils/ObjectTypeAnalyzer';

const analyzer = new ObjectTypeAnalyzer();

// Analyze object type
const structure = analyzer.analyze('{ name: string; config: { host: string } }');

// Returns:
// {
//   properties: [
//     { name: 'name', type: 'string' },
//     { name: 'config', type: '{ host: string }', nested: [...] }
//   ]
// }
```

**Performance:** Uses LRU cache for previously analyzed types.

---

### `JsDocExtractor.ts` ⭐⭐⭐⭐

Extracts and processes JSDoc comments from API items.

**Key Functions:**
- Extract `@example` tags
- Parse `@param` descriptions
- Get `@returns` documentation
- Extract custom tags

**Usage Example:**

```typescript
import { JsDocExtractor } from '../utils/JsDocExtractor';

const extractor = new JsDocExtractor(apiItem);

// Get examples
const examples = extractor.getExamples();

// Get parameter descriptions
const params = extractor.getParameterDescriptions();

// Get return type documentation
const returnDoc = extractor.getReturnDescription();
```

---

### `IndentedWriter.ts` ⭐⭐⭐⭐⭐

Writer class for generating indented text output (code, markdown, etc.).

**Key Features:**
- ✅ Automatic indentation management
- ✅ Configurable indent string (spaces/tabs)
- ✅ Support for inline and block output
- ✅ Newline normalization
- ✅ String builder pattern

**Usage Example:**

```typescript
import { IndentedWriter } from '../utils/IndentedWriter';

const writer = new IndentedWriter();

writer.writeLine('function example() {');
writer.increaseIndent();
writer.writeLine('const x = 1;');
writer.writeLine('return x;');
writer.decreaseIndent();
writer.writeLine('}');

console.log(writer.toString());
// Output:
// function example() {
//   const x = 1;
//   return x;
// }
```

**Methods:**

| Method | Purpose |
|--------|---------|
| `write(text)` | Write text without newline |
| `writeLine(text)` | Write text with newline |
| `increaseIndent()` | Increase indentation level |
| `decreaseIndent()` | Decrease indentation level |
| `toString()` | Get accumulated output |
| `clear()` | Clear accumulated text |

---

### `index.ts`

Barrel export file for the utils module.

**Exports:**
- `SecurityUtils`
- `Utilities`
- `DocumentationHelper`
- `ObjectTypeAnalyzer`
- Error classes (re-exported from errors module)
- ErrorBoundary utilities (re-exported from errors module)

## Usage for Contributors

### Security Best Practices

**Always validate user input:**

```typescript
import { SecurityUtils } from '../utils';

// ❌ NEVER use user input directly
const outputPath = userInput;
fs.writeFileSync(outputPath, data);  // Path traversal risk!

// ✅ ALWAYS validate first
const safePath = SecurityUtils.validateFilePath(baseDir, userInput);
fs.writeFileSync(safePath, data);  // Safe
```

**Sanitize content for different contexts:**

```typescript
// For YAML frontmatter
const yamlSafe = SecurityUtils.sanitizeYamlText(userDescription);

// For filenames
const filenameSafe = Utilities.getSafeFilenameForName(userTitle);

// For CLI input
const cliSafe = SecurityUtils.validateCliInput(argv.output, 'output folder');
```

### Working with API Items

```typescript
import { Utilities, DocumentationHelper } from '../utils';

// Generate signature
const signature = Utilities.getConciseSignature(apiFunction);

// Extract metadata
const name = DocumentationHelper.getItemName(apiItem);
const kind = apiItem.kind;
const modifiers = DocumentationHelper.getModifiers(apiItem);

// Generate filename
const filename = Utilities.getSafeFilenameForName(apiItem.displayName) + '.mdx';
```

### Analyzing Complex Types

```typescript
import { ObjectTypeAnalyzer } from '../utils/ObjectTypeAnalyzer';

const analyzer = new ObjectTypeAnalyzer();

// Analyze a complex type
const typeString = apiItem.excerpt.text;
const structure = analyzer.analyze(typeString);

// Use structured data in template
if (structure.properties.length > 0) {
  // Render properties table
}
```

### Generating Formatted Output

```typescript
import { IndentedWriter } from '../utils/IndentedWriter';

const writer = new IndentedWriter();

// Write markdown with proper indentation
writer.writeLine('## Parameters');
writer.writeLine();

for (const param of parameters) {
  writer.writeLine(`- **${param.name}**: ${param.type}`);
  writer.increaseIndent();
  writer.writeLine(param.description);
  writer.decreaseIndent();
}

return writer.toString();
```

### Testing Utilities

```typescript
import { SecurityUtils, Utilities } from '../utils';

describe('SecurityUtils', () => {
  it('should detect path traversal', () => {
    expect(() => {
      SecurityUtils.validateFilePath('/base', '../../../etc/passwd');
    }).toThrow('Path traversal detected');
  });

  it('should reject reserved filenames', () => {
    expect(() => {
      SecurityUtils.validateFilename('CON');
    }).toThrow('Reserved filename detected');
  });
});

describe('Utilities', () => {
  it('should generate safe filenames', () => {
    const safe = Utilities.getSafeFilenameForName('My Class!');
    expect(safe).toBe('my_class_');
  });
});
```

## Known Issues

### 🔴 Critical

**None identified**

### 🟡 Major

1. **Double Validation in getSafeFilenameForName** (Utilities.ts:24-54)
   - **Issue**: Validates with SecurityUtils then sanitizes again
   - **Impact**: Performance overhead, confusing logic
   - **Fix**: Choose one approach:
   ```typescript
   // Option 1: Just sanitize (no validation)
   public static getSafeFilenameForName(name: string): string {
     return name
       .replace(/\.{2,}/g, '')
       .replace(/[~\/\\]/g, '')
       .replace(this._badFilenameCharsRegExp, '_')
       .toLowerCase()
       .substring(0, 50);
   }

   // Option 2: Validate first, then simple sanitization
   public static getSafeFilenameForName(name: string): string {
     const validated = SecurityUtils.validateFilename(name);
     return validated.replace(this._badFilenameCharsRegExp, '_').toLowerCase();
   }
   ```

2. **ObjectTypeAnalyzer Not in CODE_REVIEW_REPORT** (ObjectTypeAnalyzer.ts)
   - **Issue**: Missing from comprehensive code review
   - **Impact**: Potential issues not documented
   - **Action**: Add to CODE_REVIEW_REPORT.md

3. **No IndentedWriter Test Coverage** (except one test file)
   - **Issue**: IndentedWriter is critical but may lack comprehensive tests
   - **Impact**: Bugs in indentation logic could affect all output
   - **Fix**: Add comprehensive tests

### 🟢 Minor

4. **Hardcoded Indent String** (IndentedWriter.ts)
   - **Issue**: No easy way to switch between spaces and tabs
   - **Enhancement**: Make configurable:
   ```typescript
   constructor(indentString: string = '  ') {
     this._indentString = indentString;
   }
   ```

5. **No Max Indent Level** (IndentedWriter.ts)
   - **Issue**: Could create deeply nested output
   - **Enhancement**: Add max depth check:
   ```typescript
   increaseIndent(): void {
     if (this._indentLevel >= this._maxIndent) {
       throw new Error('Max indent level exceeded');
     }
     this._indentLevel++;
   }
   ```

6. **Missing JSDoc Documentation**
   - **Issue**: Many utility functions lack detailed JSDoc
   - **Impact**: Unclear how to use utilities
   - **Fix**: Add comprehensive JSDoc to all public methods

7. **No Utility for Common Operations**
   - **Enhancement**: Add utilities for:
     - Pluralization (`getPlural('class')` → `'classes'`)
     - Title casing (`toTitleCase('my-class')` → `'My Class'`)
     - Path normalization (cross-platform path handling)

## Performance Characteristics

| Utility | Complexity | Notes |
|---------|-----------|-------|
| SecurityUtils.validateFilePath | O(n) | n = path length |
| SecurityUtils.validateJsonContent | O(n) | n = JSON size |
| Utilities.getSafeFilenameForName | O(n) | n = filename length |
| ObjectTypeAnalyzer.analyze | O(n) | n = type string length, cached |
| IndentedWriter.writeLine | O(1) | String concatenation |

**Caching:**
- ObjectTypeAnalyzer uses LRU cache (see cache module)

**Memory:**
- IndentedWriter accumulates strings (O(n) where n = total output size)

## Dependencies

### External Dependencies
- `@microsoft/api-extractor-model` - API item types
- `@rushstack/node-core-library` - FileSystem

### Internal Dependencies
- `../errors/DocumentationError` - Error handling
- `../cache/CacheManager` - Type analysis caching (ObjectTypeAnalyzer)

## Related Modules

- **`cli/`** - Uses SecurityUtils for input validation
- **`documenters/`** - Uses all utilities extensively
- **`markdown/`** - Uses IndentedWriter for output
- **`templates/`** - Uses DocumentationHelper for data preparation

## References

- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)
- [YAML Security](https://yaml.org/spec/1.2.2/#security)
- [Node.js Path Module](https://nodejs.org/api/path.html)

---

## Quick Reference

### Security Utilities

```typescript
// Path validation
const safe = SecurityUtils.validateFilePath(baseDir, userPath);

// Filename validation
const filename = SecurityUtils.validateFilename(userFilename);

// YAML sanitization
const yaml = SecurityUtils.sanitizeYamlText(userText);

// CLI validation
const input = SecurityUtils.validateCliInput(argv.input, 'input folder');
```

### General Utilities

```typescript
// Function signature
const sig = Utilities.getConciseSignature(apiItem);

// Safe filename
const file = Utilities.getSafeFilenameForName(name);
```

### IndentedWriter

```typescript
const writer = new IndentedWriter();
writer.writeLine('function foo() {');
writer.increaseIndent();
writer.writeLine('return 42;');
writer.decreaseIndent();
writer.writeLine('}');
console.log(writer.toString());
```

### Type Analysis

```typescript
const analyzer = new ObjectTypeAnalyzer();
const structure = analyzer.analyze('{ x: number; y: number }');
```
