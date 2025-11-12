# Markdown Module

**TSDoc to Markdown/MDX rendering with Mintlify-specific formatting**

## Overview

The markdown module handles the conversion of TSDoc documentation nodes into Markdown and MDX output. It includes a base markdown emitter that understands standard TSDoc nodes, and a custom emitter that extends it with Mintlify-specific features like code blocks, tables, expandable sections, and cross-reference resolution.

## Architecture

### Class Hierarchy

```
MarkdownEmitter (Base)
  ├── Handles standard TSDoc nodes
  ├── Text escaping and formatting
  └── Emphasis (bold/italic) management

CustomMarkdownEmitter (Extended)
  ├── Inherits from MarkdownEmitter
  ├── Mintlify-specific formatting
  ├── Custom node rendering (Heading, NoteBox, Table, etc.)
  ├── Cross-reference resolution with caching
  └── Security sanitization
```

### Design Patterns

- **Visitor Pattern**: Traverse TSDoc tree and emit markdown for each node type
- **Template Method**: Base class defines algorithm, subclass customizes steps
- **Strategy Pattern**: Different rendering strategies for different node types
- **Context Object**: IMarkdownEmitterContext carries state through rendering

## Files

### `MarkdownEmitter.ts` ⭐⭐⭐⭐⭐

Base markdown emitter for standard TSDoc nodes.

**Responsibilities:**
- Render TSDoc DocNode tree to Markdown
- Handle text escaping for Markdown syntax
- Manage bold/italic emphasis
- Format links, code spans, paragraphs
- Table escaping

**Key Features:**
- ✅ Recursive node traversal
- ✅ Markdown syntax escaping (`*`, `#`, `[`, `]`, etc.)
- ✅ Bold and italic emphasis tracking
- ✅ HTML entity encoding (`&amp;`, `&lt;`, `&gt;`)
- ✅ Context-aware formatting (tables vs regular text)

**API:**

```typescript
interface IMarkdownEmitterOptions {}

interface IMarkdownEmitterContext {
  writer: IndentedWriter;
  boldRequested: boolean;
  italicRequested: boolean;
  writingBold: boolean;
  writingItalic: boolean;
  options: IMarkdownEmitterOptions;
}

class MarkdownEmitter {
  emit(stringBuilder: StringBuilder, docNode: DocNode, options): string;
  protected writeNode(docNode: DocNode, context, docNodeSiblings): void;
  protected getEscapedText(text: string): string;
  protected getTableEscapedText(text: string): string;
}
```

**Supported Node Types:**
- `DocPlainText` - Plain text content
- `DocCodeSpan` - Inline code (`\`code\``)
- `DocLinkTag` - Links (`[text](url)`)
- `DocParagraph` - Paragraphs with spacing
- `DocFencedCode` - Code blocks (```lang```)
- `DocSection` - Document sections
- `DocHtmlStartTag` / `DocHtmlEndTag` - HTML passthrough
- `DocEscapedText` - Pre-escaped text
- `DocErrorText` - Error markers
- `DocBlockTag` - Block-level tags

**Usage Example:**

```typescript
import { MarkdownEmitter } from './MarkdownEmitter';
import { StringBuilder } from '@microsoft/tsdoc';

const emitter = new MarkdownEmitter();
const output = new StringBuilder();

const markdown = emitter.emit(output, docNode, {});
console.log(markdown);
```

**Code Quality:** ⭐⭐⭐⭐⭐

---

### `CustomMarkdownEmitter.ts` ⭐⭐⭐⭐⭐

Extended emitter with Mintlify-specific formatting and custom nodes.

**Responsibilities:**
- Extend MarkdownEmitter with custom node types
- Render Mintlify-compatible MDX components
- Resolve cross-references to other API items
- Apply security sanitization to output
- Handle complex table structures

**Key Features:**
- ✅ Custom node support (Heading, NoteBox, Table, Expandable, EmphasisSpan)
- ✅ Cross-reference resolution with caching (ApiResolutionCache)
- ✅ Mintlify component rendering (`<Expandable>`, `<Note>`, etc.)
- ✅ Security sanitization (JSX attributes, YAML frontmatter)
- ✅ Relative link generation
- ✅ Broken link warnings

**Custom Node Rendering:**

| Node Type | Renders As |
|-----------|------------|
| `Heading` | `## Title` (h2-h5) |
| `NoteBox` | `> blockquote` |
| `Table` | Mintlify table components |
| `EmphasisSpan` | `**bold**` or `*italic*` |
| `Expandable` | `<Expandable title="...">` |

**API:**

```typescript
interface ICustomMarkdownEmitterOptions extends IMarkdownEmitterOptions {
  contextApiItem: ApiItem | undefined;
  onGetFilenameForApiItem: (apiItem: ApiItem) => string | undefined;
}

class CustomMarkdownEmitter extends MarkdownEmitter {
  constructor(apiModel: ApiModel);
  emit(stringBuilder: StringBuilder, docNode: DocNode, options: ICustomMarkdownEmitterOptions): string;
  protected writeNode(docNode: DocNode, context, docNodeSiblings): void;
}
```

**Cross-Reference Resolution:**

```typescript
// In documentation comment:
/**
 * See {@link MyClass} for more information.
 */

// CustomMarkdownEmitter resolves to:
// See [MyClass](./MyClass.mdx) for more information.
```

**Component Import Generation:**

When complex types or tables are rendered, CustomMarkdownEmitter automatically adds the TypeTree component import:

```typescript
// Generated import in MDX:
import { TypeTree } from "/snippets/tsdocs/TypeTree.jsx";
```

This allows templates to use the TypeTree component for rendering complex type structures. The import is added only once per document.

**Usage Example:**

```typescript
import { CustomMarkdownEmitter } from './CustomMarkdownEmitter';
import { StringBuilder } from '@microsoft/tsdoc';

const emitter = new CustomMarkdownEmitter(apiModel);
const output = new StringBuilder();

const markdown = emitter.emit(output, docNode, {
  contextApiItem: currentApiItem,
  onGetFilenameForApiItem: (item) => `${item.displayName}.mdx`
});

console.log(markdown);
```

**Caching:**

Uses `ApiResolutionCache` to cache cross-reference lookups:
- Cache size: 500 entries
- LRU eviction
- Improves performance for documents with many cross-references

**Security Features:**

1. **JSX Attribute Sanitization:**
```typescript
// Prevents XSS in JSX attributes
const sanitized = SecurityUtils.sanitizeJsxAttribute(userTitle, 'title');
writer.writeLine(`<Expandable title="${sanitized}">`);
```

2. **Text Escaping:**
```typescript
// Escapes markdown special characters
const escaped = this.getEscapedText(userText);
```

3. **YAML Frontmatter Sanitization:**
```typescript
// Prevents YAML injection
const safe = SecurityUtils.sanitizeYamlText(description);
```

**Code Quality:** ⭐⭐⭐⭐⭐

## Usage for Contributors

### Basic Markdown Emission

```typescript
import { MarkdownEmitter } from '../markdown/MarkdownEmitter';
import { StringBuilder } from '@microsoft/tsdoc';

const emitter = new MarkdownEmitter();
const sb = new StringBuilder();

// Emit TSDoc node to markdown
const markdown = emitter.emit(sb, tsdocComment.summarySection, {});
```

### Custom Markdown with Cross-References

```typescript
import { CustomMarkdownEmitter } from '../markdown/CustomMarkdownEmitter';
import { StringBuilder } from '@microsoft/tsdoc';

const emitter = new CustomMarkdownEmitter(apiModel);
const sb = new StringBuilder();

const markdown = emitter.emit(sb, tsdocComment.summarySection, {
  contextApiItem: apiClass,
  onGetFilenameForApiItem: (item) => {
    return `${item.displayName}.mdx`;
  }
});
```

### Extending CustomMarkdownEmitter

To add support for new custom nodes:

```typescript
import { CustomMarkdownEmitter } from './CustomMarkdownEmitter';
import type { IMarkdownEmitterContext } from './MarkdownEmitter';

class MyCustomEmitter extends CustomMarkdownEmitter {
  protected writeNode(
    docNode: DocNode,
    context: IMarkdownEmitterContext,
    docNodeSiblings: boolean
  ): void {
    switch (docNode.kind) {
      case 'MyCustomNodeKind': {
        const myNode = docNode as MyCustomNode;
        context.writer.writeLine(`Custom output: ${myNode.content}`);
        break;
      }
      default:
        // Delegate to parent class
        super.writeNode(docNode, context, docNodeSiblings);
    }
  }
}
```

### Testing Markdown Output

```typescript
import { CustomMarkdownEmitter } from '../markdown/CustomMarkdownEmitter';
import { DocHeading } from '../nodes/DocHeading';
import { CustomDocNodes } from '../nodes/CustomDocNodeKind';
import { StringBuilder } from '@microsoft/tsdoc';

describe('CustomMarkdownEmitter', () => {
  it('should render headings correctly', () => {
    const emitter = new CustomMarkdownEmitter(apiModel);
    const heading = new DocHeading({
      configuration: CustomDocNodes.configuration,
      title: 'Test Heading',
      level: 2
    });

    const sb = new StringBuilder();
    const markdown = emitter.emit(sb, heading, {
      contextApiItem: undefined,
      onGetFilenameForApiItem: () => undefined
    });

    expect(markdown).toBe('## Test Heading\n\n');
  });
});
```

## Known Issues

### 🔴 Critical

**None identified**

### 🟡 Major

1. **No Async Support** (MarkdownEmitter.ts)
   - **Issue**: Rendering is synchronous, blocking for large documents
   - **Impact**: Could block event loop for very large API surfaces
   - **Enhancement**: Add async rendering:
   ```typescript
   async emitAsync(stringBuilder: StringBuilder, docNode: DocNode): Promise<string>
   ```

2. **No Streaming** (MarkdownEmitter.ts)
   - **Issue**: Accumulates entire output in memory
   - **Impact**: High memory usage for large documentation sets
   - **Enhancement**: Support streaming output:
   ```typescript
   emitStream(docNode: DocNode, outputStream: Writable): Promise<void>
   ```

3. **Limited Error Recovery** (CustomMarkdownEmitter.ts:116)
   - **Issue**: Uses `sanitizeJsxAttribute` which might not exist
   - **Impact**: Runtime error if SecurityUtils doesn't have that method
   - **Fix**: Verify method exists or add fallback:
   ```typescript
   const sanitized = SecurityUtils.sanitizeJsxAttribute
     ? SecurityUtils.sanitizeJsxAttribute(title, 'title')
     : SecurityUtils.sanitizeYamlText(title);
   ```

### 🟢 Minor

4. **Magic Numbers** (CustomMarkdownEmitter.ts:71)
   - **Issue**: Hardcoded `|| 2` for heading level default
   - **Fix**: Extract constant:
   ```typescript
   const DEFAULT_HEADING_LEVEL = 2;
   let prefix = "#".repeat(docHeading.level || DEFAULT_HEADING_LEVEL);
   ```

5. **No Output Format Validation**
   - **Issue**: Generated markdown isn't validated
   - **Enhancement**: Add linting/validation:
   ```typescript
   validateMarkdown(markdown: string): ValidationResult {
     // Check for unclosed tags, malformed tables, etc.
   }
   ```

6. **Limited Table Support**
   - **Issue**: Complex tables might not render correctly
   - **Enhancement**: Support colspan, rowspan, nested tables

7. **No Markdown Dialect Configuration**
   - **Issue**: Assumes GitHub-flavored markdown
   - **Enhancement**: Support CommonMark, MDX, etc.:
   ```typescript
   interface IMarkdownEmitterOptions {
     dialect?: 'gfm' | 'commonmark' | 'mdx';
   }
   ```

## Performance Characteristics

### Time Complexity

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| emit() | O(n) | n = number of nodes |
| writeNode() | O(1) | Per node |
| getEscapedText() | O(m) | m = text length |
| Cross-reference lookup | O(1) | Cached |

### Memory Usage

- **StringBuilder**: O(n) where n = output size
- **Context stack**: O(d) where d = tree depth
- **ApiResolutionCache**: O(500) entries = ~50KB

### Optimization Opportunities

1. **Reuse StringBuilder**: Don't create new StringBuilder each time
2. **Batch Writes**: Buffer small writes before flushing to writer
3. **Lazy Escaping**: Only escape text that needs it
4. **Parallel Rendering**: Render independent sections in parallel

## Dependencies

### External Dependencies
- `@microsoft/tsdoc` - TSDoc node types
- `@microsoft/api-extractor-model` - API model
- `@rushstack/terminal` - Console coloring (Colorize)

### Internal Dependencies
- `../nodes/` - Custom node types
- `../utils/IndentedWriter` - Formatted output
- `../utils/DocumentationHelper` - API item helpers
- `../utils/SecurityUtils` - Sanitization
- `../cache/ApiResolutionCache` - Cross-reference caching

## Related Modules

- **`nodes/`** - Custom DocNode types rendered by CustomMarkdownEmitter
- **`documenters/`** - Uses CustomMarkdownEmitter for MDX generation
- **`utils/`** - Provides IndentedWriter and security utilities

## References

- [Markdown Specification](https://spec.commonmark.org/)
- [GitHub Flavored Markdown](https://github.github.com/gfm/)
- [TSDoc Specification](https://tsdoc.org/)
- [Mintlify MDX Syntax](https://mintlify.com/docs/content/components)

---

## Quick Reference

### Basic Usage

```typescript
// Standard markdown
const emitter = new MarkdownEmitter();
const markdown = emitter.emit(new StringBuilder(), docNode, {});

// Custom markdown with cross-refs
const customEmitter = new CustomMarkdownEmitter(apiModel);
const mdx = customEmitter.emit(new StringBuilder(), docNode, {
  contextApiItem: apiClass,
  onGetFilenameForApiItem: (item) => `${item.displayName}.mdx`
});
```

### Custom Node Rendering

| Node | Markdown Output |
|------|----------------|
| DocHeading | `## Title` |
| DocNoteBox | `> Note text` |
| DocEmphasisSpan | `**bold**` or `*italic*` |
| DocExpandable | `<Expandable title="...">` |
| DocTable | Mintlify table component |

### Text Escaping

```typescript
// Regular text escaping
const escaped = emitter.getEscapedText('Text with * and #');

// Table cell escaping
const cellText = emitter.getTableEscapedText('Text with | and "');
```

### Cross-References

```typescript
// In TSDoc:
/** See {@link MyClass} for details */

// Rendered as:
// See [MyClass](./MyClass.mdx) for details
```
