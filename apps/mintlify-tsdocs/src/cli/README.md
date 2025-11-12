# CLI Module

**Command-line interface for generating Mintlify-compatible TypeScript API documentation**

## Overview

The CLI module provides the command-line interface for mintlify-tsdocs. It's built on top of [@rushstack/ts-command-line](https://www.npmjs.com/package/@rushstack/ts-command-line) and offers a clean, extensible architecture for adding new documentation generation commands.

## Architecture

### Component Hierarchy

```
ApiDocumenterCommandLine (DocumenterCli)
├── BaseAction (Abstract)
│   ├── MarkdownAction
│   └── InitTemplatesAction
```

### Design Patterns

- **Command Pattern**: Each action (command) encapsulates a complete documentation workflow
- **Template Method**: BaseAction provides common functionality; subclasses implement specific behavior
- **Error Boundary**: Centralized error handling with DocumentationError hierarchy

## Files

### `ApiDocumenterCommandLine.ts`

Main CLI parser and entry point for the tool.

**Responsibilities:**
- Register available commands/actions
- Parse command-line arguments
- Delegate to appropriate action

**Key Features:**
```typescript
const cli = new DocumenterCli();
// Registers: markdown, init-templates
cli.execute();
```

**Usage:**
```bash
mintlify-tsdocs markdown -i ./input -o ./docs/api
mintlify-tsdocs init-templates --template-dir ./my-templates
```

**Code Quality:** ⭐⭐⭐⭐⭐
- Clean, focused responsibility
- Well-documented
- Easy to extend

---

### `BaseAction.ts`

Abstract base class providing common CLI functionality.

**Responsibilities:**
- Define standard CLI parameters (`--input-folder`, `--output-folder`)
- Build and validate API model from .api.json files
- Apply `@inheritDoc` tag processing (temporary workaround)
- Security validation of file paths and content

**Key Features:**

1. **buildApiModel()**: Core method that loads API documentation
```typescript
protected buildApiModel(): IBuildApiModelResult {
  // 1. Validate input/output folders
  // 2. Load all .api.json files
  // 3. Validate JSON content (security)
  // 4. Apply @inheritDoc tags
  // 5. Return API model + validated paths
}
```

2. **Path Resolution**: Supports monorepo structures
```typescript
// Allows parent directories for monorepo context
const validatedOutputFolder = path.resolve(process.cwd(), outputFolder);
```

3. **Error Boundary**: Fail-fast error handling
```typescript
const errorBoundary = new ErrorBoundary({
  continueOnError: false,
  logErrors: true
});
```

**API:**
```typescript
interface IBuildApiModelResult {
  apiModel: ApiModel;
  inputFolder: string;
  outputFolder: string;
}
```

**Code Quality:** ⭐⭐⭐⭐ (see issues below)

---

### `MarkdownAction.ts`

CLI action for generating Mintlify-compatible MDX documentation.

**Responsibilities:**
- Define Mintlify-specific CLI parameters
- Configure and execute MarkdownDocumenter

**CLI Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `--input-folder` / `-i` | string | Input folder with .api.json files | `./input` |
| `--output-folder` / `-o` | string | Output folder (contents deleted!) | `./${actionName}` |
| `--docs-json` | string | Path to docs.json for navigation | None |
| `--tab-name` | string | Tab name in Mintlify navigation | `"API Reference"` |
| `--group` | string | Group name within the tab | None |
| `--menu` | flag | Enable menu for the group | `false` |
| `--readme` | flag | Convert README.md to index.mdx | `false` |
| `--readme-title` | string | Custom title for README page | `"README"` |

**Usage Example:**
```bash
mintlify-tsdocs markdown \
  -i docs/reference \
  --tab-name Reference \
  --group 'Code API' \
  --menu \
  --readme \
  -o docs/reference \
  --docs-json docs/docs.json
```

**Execution Flow:**
```
onExecuteAsync()
  └─> buildApiModel() [from BaseAction]
      └─> new MarkdownDocumenter(options)
          └─> generateFiles()
```

**Code Quality:** ⭐⭐⭐⭐⭐
- Clean delegation pattern
- Well-documented parameters
- Simple and focused

---

### `InitTemplatesAction.ts`

CLI action to initialize a template directory with default Liquid templates.

**Responsibilities:**
- Copy default templates to user-specified directory
- Add helpful documentation headers to templates
- Prevent accidental overwrites (unless `--force`)
- Provide guidance on next steps

**CLI Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `--template-dir` / `-t` | string | Directory for templates | `./templates` |
| `--force` / `-f` | flag | Overwrite existing templates | `false` |

**Usage Example:**
```bash
# Initialize with default location
mintlify-tsdocs init-templates

# Custom location
mintlify-tsdocs init-templates --template-dir ./my-templates

# Overwrite existing templates
mintlify-tsdocs init-templates --force
```

**Execution Flow:**
```
onExecuteAsync()
  ├─> Check if directory exists
  ├─> Validate --force flag if templates exist
  ├─> Find default templates (package directory)
  ├─> _copyTemplates()
  │   ├─> Filter .liquid files
  │   ├─> Add header comment
  │   └─> Write to destination
  └─> Print success message with next steps
```

**Template Header Injection:**
```liquid
<!--
  Mintlify TypeDoc Template

  This template controls how enum documentation is generated.

  Available variables:
  - apiItem: The API item being documented
  - page: Page metadata (title, description, icon, breadcrumb)
  ...

  Learn more: https://docs.mintlify-tsdocs.com/templates
-->
```

**Code Quality:** ⭐⭐⭐⭐ (see issues below)

## Usage for Contributors

### Adding a New CLI Action

To add a new command (e.g., `mintlify-tsdocs html`):

1. **Create action class:**
```typescript
// src/cli/HtmlAction.ts
import { BaseAction } from './BaseAction';

export class HtmlAction extends BaseAction {
  public constructor(parser: DocumenterCli) {
    super({
      actionName: 'html',
      summary: 'Generate HTML documentation',
      documentation: 'Generates API documentation as HTML files.'
    });

    // Define custom parameters
    this._styleParameter = this.defineStringParameter({
      parameterLongName: '--style',
      argumentName: 'THEME',
      description: 'HTML theme to use'
    });
  }

  protected override async onExecuteAsync(): Promise<void> {
    const { apiModel, outputFolder } = this.buildApiModel();

    // Your implementation here
    const htmlDocumenter = new HtmlDocumenter({
      apiModel,
      outputFolder,
      theme: this._styleParameter.value
    });
    htmlDocumenter.generateFiles();
  }
}
```

2. **Register in DocumenterCli:**
```typescript
// ApiDocumenterCommandLine.ts
import { HtmlAction } from './HtmlAction';

private _populateActions(): void {
  this.addAction(new MarkdownAction(this));
  this.addAction(new InitTemplatesAction());
  this.addAction(new HtmlAction(this)); // Add here
}
```

3. **Test:**
```bash
bun run build
./bin/mintlify-tsdocs html --help
```

### Working with CLI Parameters

**String Parameter:**
```typescript
this._myParam = this.defineStringParameter({
  parameterLongName: '--my-param',
  parameterShortName: '-m',  // Optional
  argumentName: 'VALUE',      // Placeholder in help
  description: 'Description for help text',
  defaultValue: 'default'     // Optional
});

// Access value:
const value = this._myParam.value || 'fallback';
```

**Flag Parameter:**
```typescript
this._myFlag = this.defineFlagParameter({
  parameterLongName: '--my-flag',
  parameterShortName: '-f',
  description: 'Enable something'
});

// Access value (true/false):
const enabled = this._myFlag.value;
```

**Integer Parameter:**
```typescript
this._myNumber = this.defineIntegerParameter({
  parameterLongName: '--my-number',
  argumentName: 'NUMBER',
  description: 'Numeric value'
});

const num = this._myNumber.value || 10;
```

### Error Handling Best Practices

**Use DocumentationError hierarchy:**
```typescript
import { DocumentationError, ErrorCode, FileSystemError } from '../errors/DocumentationError';

// Specific error type
throw new FileSystemError(
  'Failed to read template',
  ErrorCode.FILE_READ_ERROR,
  {
    resource: templatePath,
    operation: 'readTemplate',
    cause: originalError
  }
);

// Generic error
throw new DocumentationError(
  'Something went wrong',
  ErrorCode.UNKNOWN_ERROR,
  { suggestion: 'Check your input files' }
);
```

**Use ErrorBoundary for complex operations:**
```typescript
const errorBoundary = new ErrorBoundary({
  continueOnError: false,
  logErrors: true
});

const result = errorBoundary.executeSync(() => {
  // Your code that might throw
  return someValue;
});

if (!result.success) {
  throw result.error;
}
```

### Security Considerations

**Always validate user input:**
```typescript
// Validate CLI input
const inputFolder = SecurityUtils.validateCliInput(
  this._inputParameter.value,
  'Input folder'
);

// Validate filenames (prevents path traversal)
const safeFilename = SecurityUtils.validateFilename(filename);

// Validate full paths
const safePath = SecurityUtils.validateFilePath(baseDir, filename);

// Validate JSON content
SecurityUtils.validateJsonContent(fileContent);
```

**Path resolution for monorepo:**
```typescript
// ✅ Correct: Use path.resolve for monorepo support
const outputFolder = path.resolve(process.cwd(), userInput);

// ❌ Avoid: Strict validation blocks parent directories
const outputFolder = SecurityUtils.validateFilePath(process.cwd(), userInput);
```

### Testing CLI Actions

**Unit Testing:**
```typescript
import { MarkdownAction } from '../MarkdownAction';
import { DocumenterCli } from '../ApiDocumenterCommandLine';

describe('MarkdownAction', () => {
  it('should parse parameters correctly', () => {
    const cli = new DocumenterCli();
    const action = new MarkdownAction(cli);

    // Test parameter parsing
    action.defineParameters();
    expect(action._docsJsonParameter).toBeDefined();
  });

  it('should validate input folder', async () => {
    // Mock FileSystem
    const action = new MarkdownAction(cli);

    await expect(action.onExecuteAsync()).rejects.toThrow(
      'input folder does not exist'
    );
  });
});
```

**Integration Testing:**
```bash
# Test the actual CLI
bun run build

# Test with valid input
./bin/mintlify-tsdocs markdown -i ./test-fixtures -o ./test-output

# Test error handling
./bin/mintlify-tsdocs markdown -i ./nonexistent

# Test help text
./bin/mintlify-tsdocs markdown --help
```

## Common Workflows

### Generating Documentation

```bash
# Basic usage
mintlify-tsdocs markdown -i ./input -o ./output

# With Mintlify integration
mintlify-tsdocs markdown \
  -i docs/reference \
  -o docs/reference \
  --docs-json docs/docs.json \
  --tab-name "API Reference" \
  --group "Core API" \
  --menu \
  --readme
```

### Customizing Templates

```bash
# 1. Initialize templates
mintlify-tsdocs init-templates --template-dir ./custom-templates

# 2. Edit templates
vim ./custom-templates/class.liquid

# 3. Generate with custom templates
mintlify-tsdocs markdown \
  -i ./input \
  -o ./output \
  --template-dir ./custom-templates
```

## Known Issues

### 🔴 Critical

**None identified**

### 🟡 Major

1. **Outdated Template Documentation** (InitTemplatesAction.ts:143-147)
   - **Issue**: Template header comment still references `tables.*` structure
   - **Impact**: Misleading documentation for users customizing templates
   - **Location**: `_copyTemplates()` method
   - **Fix**: Update header comment to reflect semantic variable names:
   ```typescript
   // OLD (incorrect):
   // - tables: Structured data for constructors, properties, methods, etc.

   // NEW (correct):
   // - constructors, properties, methods, events: Array of table rows
   // - members: Enum members or type members
   // - returnType: Function return type information
   ```

2. **TODO: @inheritDoc Processing** (BaseAction.ts:159-161)
   - **Issue**: Temporary workaround for @inheritDoc tag processing
   - **Impact**: Should be handled by API Extractor instead
   - **Status**: Marked as TODO, needs tracking
   - **Action**: Create issue to migrate this to api-extractor's DocCommentEnhancer

3. **Inconsistent Error Handling**
   - **Issue**: InitTemplatesAction wraps errors; MarkdownAction doesn't
   - **Impact**: Inconsistent error messages and debugging experience
   - **Fix**: Add consistent error wrapping to all actions:
   ```typescript
   protected override async onExecuteAsync(): Promise<void> {
     try {
       // action implementation
     } catch (error) {
       throw new DocumentationError(
         `Failed to generate markdown: ${error.message}`,
         ErrorCode.GENERATION_ERROR,
         { cause: error }
       );
     }
   }
   ```

4. **Missing Template Directory Parameter** (MarkdownAction.ts)
   - **Issue**: No `--template-dir` parameter despite InitTemplatesAction existing
   - **Impact**: Users can initialize templates but can't use them without code changes
   - **Fix**: Add template directory parameter to MarkdownAction:
   ```typescript
   this._templateDirParameter = this.defineStringParameter({
     parameterLongName: '--template-dir',
     parameterShortName: '-t',
     argumentName: 'DIRECTORY',
     description: 'Custom template directory'
   });
   ```

### 🟢 Minor

5. **Documentation Link May Not Exist** (InitTemplatesAction.ts:106, 149)
   - **Issue**: References `https://docs.mintlify-tsdocs.com/templates`
   - **Impact**: Users may get 404 if documentation not deployed
   - **Fix**: Update to actual documentation URL or use placeholder

6. **No Path Comment** (BaseAction.ts:84)
   - **Issue**: Path resolution change (strict validation → path.resolve) lacks explanation
   - **Impact**: Future maintainers may not understand security trade-off
   - **Fix**: Add comment explaining monorepo support:
   ```typescript
   // NOTE: Use path.resolve instead of strict validation to support
   // monorepo structures where output may be in parent directories.
   // Input is already validated via SecurityUtils.validateCliInput()
   const validatedOutputFolder = path.resolve(process.cwd(), outputFolder);
   ```

7. **Magic Strings**
   - **Issue**: Hardcoded default values scattered in code
   - **Examples**: `'./input'`, `'./templates'`, `'API Reference'`
   - **Fix**: Extract to constants:
   ```typescript
   // src/cli/constants.ts
   export const CLI_DEFAULTS = {
     INPUT_FOLDER: './input',
     TEMPLATE_DIR: './templates',
     TAB_NAME: 'API Reference',
     README_TITLE: 'README'
   } as const;
   ```

## Performance Characteristics

### Time Complexity

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Parameter parsing | O(n) | n = number of CLI arguments |
| API model loading | O(m × s) | m = .api.json files, s = avg file size |
| @inheritDoc resolution | O(i × d) | i = items with @inheritDoc, d = tree depth |

### Memory Usage

- **API Model**: O(n) where n = total API items
- **Inheritance Processing**: O(d) where d = max inheritance depth
- **File I/O Buffers**: ~8KB per file read

### Optimization Opportunities

1. **Parallel File Loading**: Load multiple .api.json files concurrently
2. **Lazy @inheritDoc**: Only process @inheritDoc when rendering documentation
3. **Streaming JSON**: Use streaming parser for large .api.json files

## Dependencies

### External Dependencies
- `@rushstack/ts-command-line` - CLI framework
- `@rushstack/node-core-library` - FileSystem utilities
- `@rushstack/terminal` - Terminal output (colors)
- `@microsoft/api-extractor-model` - API documentation model
- `@microsoft/tsdoc` - TSDoc comment parsing

### Internal Dependencies
- `../documenters/MarkdownDocumenter` - MDX generation
- `../templates/TemplateMerger` - Template management
- `../utils/SecurityUtils` - Input validation
- `../errors/DocumentationError` - Error handling

## Related Modules

- **`documenters/`** - Document generation logic
- **`templates/`** - Template management and rendering
- **`utils/`** - Security validation and utilities
- **`errors/`** - Error types and handling

## References

- [@rushstack/ts-command-line Documentation](https://rushstack.io/pages/api/ts-command-line/)
- [API Extractor Documentation](https://api-extractor.com/)
- [TSDoc Specification](https://tsdoc.org/)

---

## Quick Reference

### Creating a New Action

1. Extend `BaseAction`
2. Define parameters in constructor
3. Implement `onExecuteAsync()`
4. Register in `ApiDocumenterCommandLine`
5. Test with `--help`

### Common Parameter Patterns

```typescript
// Input/output (inherited from BaseAction)
-i, --input-folder
-o, --output-folder

// Template customization
-t, --template-dir

// Boolean flags
--menu, --readme, --force

// String values
--tab-name, --group, --docs-json
```

### Error Handling Template

```typescript
try {
  // Your code
} catch (error) {
  if (error instanceof DocumentationError) {
    throw error; // Already wrapped
  }
  throw new DocumentationError(
    `Operation failed: ${error.message}`,
    ErrorCode.APPROPRIATE_CODE,
    { cause: error, operation: 'operationName' }
  );
}
```
