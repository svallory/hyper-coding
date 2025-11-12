# Documenters Module

**Core documentation generation orchestration and MDX file creation**

## Overview

The documenters module contains the main documentation generator that orchestrates the entire documentation generation process. It coordinates template rendering, navigation generation, file writing, and component installation to produce complete Mintlify-compatible MDX documentation from TypeScript API models.

## Architecture

### Orchestration Flow

```
MarkdownDocumenter
├── 1. Load API Model (from .api.json files)
├── 2. Initialize Subsystems
│   ├── NavigationManager
│   ├── TemplateDataConverter
│   ├── LiquidTemplateManager
│   └── CustomMarkdownEmitter
├── 3. Generate Documentation
│   ├── For each API item:
│   │   ├── Convert to template data
│   │   ├── Render template
│   │   ├── Generate MDX with frontmatter
│   │   ├── Add to navigation
│   │   └── Write file
│   └── Generate index.mdx (package overview)
├── 4. Post-Processing
│   ├── Generate navigation (docs.json)
│   ├── Install Mintlify components
│   └── Copy README (optional)
└── 5. Cleanup and Reporting
```

### Design Patterns

- **Facade Pattern**: MarkdownDocumenter provides unified interface to complex subsystems
- **Template Method**: Defines documentation generation algorithm
- **Strategy Pattern**: Different strategies for different API item kinds
- **Visitor Pattern**: Traverses API model tree

## Files

### `MarkdownDocumenter.ts` ⭐⭐⭐⭐⭐

Main documentation generator and orchestrator.

**Responsibilities:**

1. **API Model Processing**
   - Load API packages from .api.json files
   - Traverse API model hierarchy
   - Filter items for documentation

2. **File Generation**
   - Generate MDX files for each API item
   - Create frontmatter (title, description, icon)
   - Generate breadcrumb navigation
   - Handle README conversion to index.mdx

3. **Template Rendering**
   - Initialize template system
   - Convert API items to template data
   - Render Liquid templates
   - Generate table of contents structures

4. **Navigation Management**
   - Track all generated pages
   - Update docs.json with navigation structure
   - Organize by API item kind (classes, interfaces, functions)

5. **Component Installation**
   - Copy React components to docs/snippets/tsdocs/
   - Ensure Mintlify can find components
   - Separate from user's components to avoid conflicts

6. **Error Handling**
   - Graceful degradation for rendering errors
   - Detailed error messages with context
   - Continue on non-critical errors

**Configuration Options:**

```typescript
interface IMarkdownDocumenterOptions {
  apiModel: ApiModel;                    // API model to document
  outputFolder: string;                  // Output directory
  docsJsonPath?: string;                 // Path to docs.json
  tabName?: string;                      // Mintlify tab name
  groupName?: string;                    // Mintlify group name
  enableMenu?: boolean;                  // Enable menu in navigation
  convertReadme?: boolean;               // Convert README to index.mdx
  readmeTitle?: string;                  // Custom README title
}
```

**Key Methods:**

| Method | Purpose |
|--------|---------|
| `generateFiles()` | Main entry point - generate all documentation |
| `_generatePageForApiItem(item)` | Generate MDX for one API item |
| `_buildFrontmatter(item)` | Create YAML frontmatter |
| `_buildBreadcrumb(item)` | Generate breadcrumb navigation |
| `_getLinkFilenameForApiItem(item)` | Generate filename for API item |
| `_installMintlifyComponents()` | Copy components to docs/snippets/tsdocs |
| `_convertReadmeToIndex()` | Convert README.md → index.mdx |

**Usage Example:**

```typescript
import { MarkdownDocumenter } from './documenters/MarkdownDocumenter';
import { ApiModel } from '@microsoft/api-extractor-model';

// Load API model
const apiModel = new ApiModel();
apiModel.loadPackage('./my-package.api.json');

// Create documenter
const documenter = new MarkdownDocumenter({
  apiModel,
  outputFolder: './docs/api',
  docsJsonPath: './docs/docs.json',
  tabName: 'API Reference',
  groupName: 'Core API',
  enableMenu: true,
  convertReadme: true,
  readmeTitle: 'Overview'
});

// Generate documentation
documenter.generateFiles();
```

**Generated File Structure:**

```
docs/
├── api/
│   ├── index.mdx             # Package overview (from README)
│   ├── MyClass.mdx           # Class documentation
│   ├── IMyInterface.mdx      # Interface documentation
│   ├── myFunction.mdx        # Function documentation
│   └── MyEnum.mdx            # Enum documentation
└── snippets/
    └── tsdocs/               # mintlify-tsdocs components (separate from user's)
        └── TypeTree.jsx      # React component for type trees
```

**MDX File Format:**

```mdx
---
title: "MyClass"
description: "A sample class for demonstration"
icon: "box"
---

# MyClass

> **Package:** my-package

## Constructor

### MyClass(options)

Creates a new instance of MyClass.

**Parameters:**
- `options`: Configuration options

## Properties

### publicProperty

**Type:** `string`

A public property.

## Methods

### doSomething(param)

**Parameters:**
- `param`: Input parameter

**Returns:** `Promise<void>`

Performs an action.

## Example

```typescript
const instance = new MyClass({ config: true });
await instance.doSomething('test');
```
```

**Critical Fixes Applied:**

1. **Breadcrumb Empty DisplayName Fix:**
```typescript
private _buildBreadcrumb(apiItem: ApiItem): Array<{ name: string; path?: string }> {
  // ...
  if (!ancestor.displayName || ancestor.displayName.trim().length === 0) {
    continue;  // Skip items with empty display names
  }
  // ...
}
```

2. **Filename Generation Fix:**
```typescript
private _getLinkFilenameForApiItem(apiItem: ApiItem): string | undefined {
  // Skip EntryPoint and Model before processing
  if (
    apiItem.kind === ApiItemKind.EntryPoint ||
    apiItem.kind === ApiItemKind.Model ||
    apiItem.kind === ApiItemKind.None
  ) {
    return undefined;
  }
  // ... generate filename ...
}
```

3. **Component Installation Error Handling:**
```typescript
private async _installMintlifyComponents(outputFolder: string): Promise<void> {
  const componentsToCopy = ['TypeTree.jsx'];

  for (const componentFile of componentsToCopy) {
    const sourcePath = path.join(__dirname, '..', 'components', componentFile);

    if (!FileSystem.exists(sourcePath)) {
      throw new FileSystemError(
        `Component source not found: ${componentFile}`,
        ErrorCode.FILE_NOT_FOUND,
        {
          resource: sourcePath,
          operation: 'installComponents',
          suggestion: 'Ensure components are built and available in lib/components/'
        }
      );
    }
    // ... copy component ...
  }
}
```

**Performance Features:**

- **Parallel processing**: Can process multiple API items concurrently (future enhancement)
- **Template caching**: Templates compiled once and reused
- **API resolution caching**: Cross-references cached to avoid repeated lookups
- **Type analysis caching**: Complex type structures cached

**Security Features:**

- **Path validation**: All output paths validated to prevent traversal
- **Content sanitization**: YAML frontmatter sanitized for injection prevention
- **Filename validation**: Generated filenames validated for safety
- **JSON validation**: docs.json validated before writing

**Code Quality:** ⭐⭐⭐⭐⭐

## Usage for Contributors

### Basic Documentation Generation

```typescript
import { MarkdownDocumenter } from '../documenters/MarkdownDocumenter';

const documenter = new MarkdownDocumenter({
  apiModel,
  outputFolder: './docs/api'
});

documenter.generateFiles();
```

### With Mintlify Integration

```typescript
const documenter = new MarkdownDocumenter({
  apiModel,
  outputFolder: './docs/api',
  docsJsonPath: './docs/docs.json',
  tabName: 'API Reference',
  groupName: 'Core',
  enableMenu: true
});

documenter.generateFiles();
```

### Custom README Conversion

```typescript
const documenter = new MarkdownDocumenter({
  apiModel,
  outputFolder: './docs/api',
  convertReadme: true,
  readmeTitle: 'Package Overview'  // Custom title
});

documenter.generateFiles();
```

### Extending MarkdownDocumenter

To add custom processing:

```typescript
import { MarkdownDocumenter } from './MarkdownDocumenter';

class CustomDocumenter extends MarkdownDocumenter {
  protected override _generatePageForApiItem(apiItem: ApiItem): void {
    // Custom pre-processing
    this._myCustomLogic(apiItem);

    // Call parent implementation
    super._generatePageForApiItem(apiItem);

    // Custom post-processing
    this._generateSupplementaryFiles(apiItem);
  }

  private _myCustomLogic(apiItem: ApiItem): void {
    // Your custom logic here
  }
}
```

### Testing Documentation Generation

```typescript
import { MarkdownDocumenter } from '../documenters/MarkdownDocumenter';
import { ApiModel } from '@microsoft/api-extractor-model';
import * as fs from 'fs';
import * as path from 'path';

describe('MarkdownDocumenter', () => {
  let apiModel: ApiModel;
  let tempDir: string;

  beforeEach(() => {
    apiModel = new ApiModel();
    apiModel.loadPackage('./test-fixtures/test-package.api.json');

    tempDir = fs.mkdtempSync('/tmp/doc-test-');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true });
  });

  it('should generate MDX files for all API items', () => {
    const documenter = new MarkdownDocumenter({
      apiModel,
      outputFolder: tempDir
    });

    documenter.generateFiles();

    // Check files were created
    const files = fs.readdirSync(tempDir);
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('index.mdx');
  });

  it('should include proper frontmatter', () => {
    const documenter = new MarkdownDocumenter({
      apiModel,
      outputFolder: tempDir
    });

    documenter.generateFiles();

    const content = fs.readFileSync(
      path.join(tempDir, 'MyClass.mdx'),
      'utf-8'
    );

    expect(content).toContain('---\n');
    expect(content).toContain('title:');
    expect(content).toContain('description:');
  });

  it('should update docs.json', () => {
    const docsJsonPath = path.join(tempDir, 'docs.json');

    const documenter = new MarkdownDocumenter({
      apiModel,
      outputFolder: tempDir,
      docsJsonPath
    });

    documenter.generateFiles();

    expect(fs.existsSync(docsJsonPath)).toBe(true);

    const docsJson = JSON.parse(fs.readFileSync(docsJsonPath, 'utf-8'));
    expect(docsJson.navigation).toBeDefined();
  });
});
```

## Known Issues

### 🔴 Critical

**None identified** (all critical issues from conversation have been fixed)

### 🟡 Major

1. **No Parallel Processing** (MarkdownDocumenter.ts)
   - **Issue**: API items processed sequentially
   - **Impact**: Slow for large API surfaces (1000+ items)
   - **Enhancement**: Add parallel processing:
   ```typescript
   async generateFiles(): Promise<void> {
     const items = this._collectApiItems();

     // Process in parallel with concurrency limit
     await Promise.all(
       items.map(item =>
         this._generatePageForApiItem(item)
       )
     );
   }
   ```

2. **No Progress Reporting** (MarkdownDocumenter.ts)
   - **Issue**: Silent processing, no feedback during generation
   - **Impact**: User doesn't know if it's working or stuck
   - **Enhancement**: Add progress callback:
   ```typescript
   interface IMarkdownDocumenterOptions {
     onProgress?: (current: number, total: number, item: string) => void;
   }

   this.options.onProgress?.(index + 1, items.length, apiItem.displayName);
   ```

3. **No Incremental Generation** (MarkdownDocumenter.ts)
   - **Issue**: Always regenerates all files
   - **Impact**: Slow for iterative development
   - **Enhancement**: Add incremental mode:
   ```typescript
   interface IMarkdownDocumenterOptions {
     incrementalMode?: boolean;
     cacheFile?: string;  // Track file hashes
   }
   ```

4. **Memory Usage for Large APIs** (MarkdownDocumenter.ts)
   - **Issue**: Loads entire API model in memory
   - **Impact**: High memory usage for large projects
   - **Enhancement**: Implement streaming generation

### 🟢 Minor

5. **Hardcoded Component List** (MarkdownDocumenter.ts)
   - **Issue**: `componentsToCopy = ['TypeTree.jsx']` is hardcoded
   - **Enhancement**: Auto-discover components:
   ```typescript
   const componentDir = path.join(__dirname, '..', 'components');
   const componentsToCopy = fs.readdirSync(componentDir)
     .filter(f => f.endsWith('.jsx') || f.endsWith('.tsx'));
   ```

6. **No Dry-Run Mode** (MarkdownDocumenter.ts)
   - **Enhancement**: Add dry-run to preview changes:
   ```typescript
   interface IMarkdownDocumenterOptions {
     dryRun?: boolean;  // Don't write files, just report
   }
   ```

7. **Limited Customization** (MarkdownDocumenter.ts)
   - **Issue**: Hard to customize without subclassing
   - **Enhancement**: Add hooks/plugins:
   ```typescript
   interface IMarkdownDocumenterOptions {
     beforeGenerate?: (item: ApiItem) => void;
     afterGenerate?: (item: ApiItem, output: string) => void;
     customIcons?: Record<ApiItemKind, string>;
   }
   ```

8. **No Output Validation** (MarkdownDocumenter.ts)
   - **Enhancement**: Validate generated MDX:
   ```typescript
   private _validateMdxOutput(content: string): ValidationResult {
     // Check for:
     // - Valid frontmatter
     // - Balanced JSX tags
     // - Valid links
     // - Proper markdown syntax
   }
   ```

## Performance Characteristics

### Time Complexity

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Load API model | O(n) | n = .api.json file size |
| Generate all docs | O(m) | m = number of API items |
| Render template | O(t) | t = template complexity |
| Write file | O(f) | f = file size |
| Update navigation | O(m) | m = number of items |

**Total**: O(n + m×(t + f)) where m typically >> n

### Memory Usage

- **API Model**: O(n) where n = total API items
- **Template cache**: ~100KB
- **Navigation tracking**: O(m) where m = generated pages
- **Temp files**: ~500KB for merged templates

### Optimization Opportunities

1. **Parallel generation**: Process independent API items concurrently
2. **Streaming writes**: Write files as they're generated
3. **Incremental mode**: Only regenerate changed items
4. **Worker threads**: Offload template rendering to workers

## Dependencies

### External Dependencies
- `@microsoft/api-extractor-model` - API model
- `@rushstack/node-core-library` - File operations
- `@rushstack/terminal` - Console output

### Internal Dependencies
- `../templates/` - Template system
- `../navigation/` - Navigation management
- `../markdown/` - Markdown emission
- `../utils/` - Utilities (SecurityUtils, Utilities)
- `../cache/` - Caching system
- `../errors/` - Error handling

## Related Modules

All modules in the project are orchestrated by MarkdownDocumenter:
- **cli/** - Invokes MarkdownDocumenter
- **templates/** - Renders documentation content
- **navigation/** - Manages docs.json
- **markdown/** - Converts TSDoc to markdown
- **components/** - React components for docs
- **utils/** - Various utilities
- **cache/** - Performance optimization
- **errors/** - Error handling

## References

- [Mintlify Documentation](https://mintlify.com/docs)
- [API Extractor](https://api-extractor.com/)
- [TSDoc](https://tsdoc.org/)

---

## Quick Reference

### Basic Usage

```typescript
import { MarkdownDocumenter } from './documenters';

const documenter = new MarkdownDocumenter({
  apiModel,
  outputFolder: './docs/api'
});

documenter.generateFiles();
```

### Full Configuration

```typescript
const documenter = new MarkdownDocumenter({
  apiModel,
  outputFolder: './docs/api',
  docsJsonPath: './docs/docs.json',
  tabName: 'API Reference',
  groupName: 'Core API',
  enableMenu: true,
  convertReadme: true,
  readmeTitle: 'Overview'
});
```

### Generated Output

```
docs/
├── api/
│   ├── index.mdx          # Package overview
│   ├── MyClass.mdx        # Class docs
│   ├── IMyInterface.mdx   # Interface docs
│   └── myFunction.mdx     # Function docs
└── snippets/
    └── tsdocs/            # mintlify-tsdocs components
        └── TypeTree.jsx   # Component
```

### Integration Points

| Module | Purpose |
|--------|---------|
| templates/ | Liquid template rendering |
| navigation/ | docs.json updates |
| markdown/ | TSDoc → Markdown conversion |
| components/ | React component installation |
| utils/ | Filename generation, security |
| cache/ | Performance optimization |
| errors/ | Error handling |

---

## Summary

The MarkdownDocumenter is the **heart of mintlify-tsdocs**. It orchestrates all subsystems to transform TypeScript API documentation into beautiful, navigable Mintlify MDX documentation. It handles:

✅ API model traversal
✅ Template rendering
✅ MDX file generation
✅ Navigation structure
✅ Component installation
✅ Error handling
✅ Performance optimization

Every module in the project ultimately serves MarkdownDocumenter's goal: **generating high-quality, accessible API documentation**.
