# Nodes Module

**Custom TSDoc node types for enhanced markdown features**

## Overview

The nodes module provides custom TSDoc `DocNode` subclasses that extend the standard TSDoc documentation model with additional markdown elements. These custom nodes enable richer documentation output with features like headings, tables, note boxes, and expandable sections that aren't available in standard TSDoc.

## Architecture

### Node Hierarchy

```
DocNode (TSDoc base)
├── DocEmphasisSpan - Bold/italic text spans
├── DocHeading - Section headings (h1-h5)
├── DocNoteBox - Information/warning boxes
├── DocExpandable - Collapsible content sections
└── DocTable - Table structures
    ├── DocTableRow - Table rows
    └── DocTableCell - Table cells
```

### Design Patterns

- **Extension Pattern**: Extend TSDoc's DocNode with custom types
- **Factory Registration**: Register custom nodes with TSDocConfiguration
- **Composition**: Nodes can contain other nodes (tree structure)
- **Singleton Configuration**: Single shared TSDocConfiguration instance

## Files

### `CustomDocNodeKind.ts`

Central registration point for all custom node types.

**Responsibilities:**
- Define CustomDocNodeKind enum
- Register custom nodes with TSDocConfiguration
- Define parent-child relationships
- Provide shared configuration instance

**Node Types:**

| Kind | Class | Purpose |
|------|-------|---------|
| `EmphasisSpan` | DocEmphasisSpan | Bold/italic text |
| `Heading` | DocHeading | Section headers (h1-h5) |
| `NoteBox` | DocNoteBox | Info/warning boxes |
| `Table` | DocTable | Table structures |
| `TableRow` | DocTableRow | Table rows |
| `TableCell` | DocTableCell | Table cells |
| `Expandable` | DocExpandable | Collapsible sections |

**Allowable Children:**

```typescript
// EmphasisSpan can contain:
- DocNodeKind.PlainText
- DocNodeKind.SoftBreak

// Section can contain:
- CustomDocNodeKind.Heading
- CustomDocNodeKind.NoteBox
- CustomDocNodeKind.Table
- CustomDocNodeKind.Expandable

// Paragraph can contain:
- CustomDocNodeKind.EmphasisSpan
```

**Usage:**

```typescript
import { CustomDocNodes } from '../nodes/CustomDocNodeKind';

// Get shared configuration
const config = CustomDocNodes.configuration;

// Use in TSDoc parser
const parser = new TSDocParser(config);
```

**⚠️ Known Issue**: Line 33 has typo `@micrososft` (should be `@microsoft`)

---

### `DocEmphasisSpan.ts`

Inline text with emphasis (bold, italic, or code formatting).

**Properties:**
- `bold`: boolean
- `italic`: boolean

**Usage:**
```typescript
new DocEmphasisSpan({
  configuration,
  bold: true,
  italic: false
}, [
  new DocPlainText({ text: 'Important text' })
]);
```

**Renders as:** `**Important text**`

---

### `DocHeading.ts`

Section heading with configurable level (1-5).

**Properties:**
- `title`: string - Heading text
- `level`: number - Heading level (1-5, default 1)

**Validation:** Throws error if level < 1 or level > 5

**Usage:**
```typescript
new DocHeading({
  configuration,
  title: 'Getting Started',
  level: 2
});
```

**Renders as:** `## Getting Started`

---

### `DocNoteBox.ts`

Bordered information box for notes, warnings, or tips.

**Properties:**
- `content`: DocSection - Box content

**Usage:**
```typescript
new DocNoteBox(
  { configuration },
  [
    new DocParagraph(...)  // Child nodes
  ]
);
```

**Renders as Mintlify:**
```mdx
<Note>
Content here
</Note>
```

---

### `DocExpandable.ts`

Collapsible/expandable content section.

**Properties:**
- `title`: string - Section title
- `content`: DocSection - Expandable content

**Usage:**
```typescript
new DocExpandable({
  configuration,
  title: 'Click to expand'
}, [
  new DocParagraph(...)  // Hidden content
]);
```

**Renders as Mintlify:**
```mdx
<Accordion title="Click to expand">
Content here
</Accordion>
```

---

### `DocTable.ts`

Table structure with header and data rows.

**Properties:**
- `header`: DocTableRow - Table header
- `rows`: DocTableRow[] - Data rows

**Usage:**
```typescript
const header = new DocTableRow([
  new DocTableCell({ content: new DocPlainText({ text: 'Name' }) }),
  new DocTableCell({ content: new DocPlainText({ text: 'Type' }) })
]);

const row = new DocTableRow([
  new DocTableCell({ content: new DocPlainText({ text: 'id' }) }),
  new DocTableCell({ content: new DocPlainText({ text: 'string' }) })
]);

new DocTable({
  configuration,
  header,
  rows: [row]
});
```

**Renders as:**
```markdown
| Name | Type |
|------|------|
| id   | string |
```

---

### `DocTableRow.ts`

Single row in a table.

**Properties:**
- `cells`: DocTableCell[] - Row cells

**Usage:**
```typescript
new DocTableRow(
  { configuration },
  [
    new DocTableCell({ ... }),
    new DocTableCell({ ... })
  ]
);
```

---

### `DocTableCell.ts`

Single cell in a table row.

**Properties:**
- `content`: DocSection - Cell content

**Usage:**
```typescript
new DocTableCell(
  { configuration },
  [
    new DocPlainText({ text: 'Cell content' })
  ]
);
```

## Usage for Contributors

### Creating Custom Nodes

```typescript
import { CustomDocNodes, CustomDocNodeKind } from '../nodes/CustomDocNodeKind';
import { DocHeading, DocNoteBox } from '../nodes';

// Get configuration
const config = CustomDocNodes.configuration;

// Create heading
const heading = new DocHeading({
  configuration: config,
  title: 'API Reference',
  level: 2
});

// Create note box
const noteBox = new DocNoteBox(
  { configuration: config },
  [
    new DocParagraph({ configuration: config }, [
      new DocPlainText({ text: 'This API is deprecated' })
    ])
  ]
);
```

### Rendering Custom Nodes

```typescript
import { CustomMarkdownEmitter } from '../markdown/CustomMarkdownEmitter';

// Custom emitter knows how to render all custom nodes
const emitter = new CustomMarkdownEmitter(apiModel);

// Render a node
if (node.kind === CustomDocNodeKind.Heading) {
  const heading = node as DocHeading;
  emitter.write('#'.repeat(heading.level) + ' ' + heading.title + '\n\n');
}

if (node.kind === CustomDocNodeKind.NoteBox) {
  const noteBox = node as DocNoteBox;
  emitter.write('<Note>\n');
  emitter.writeNode(noteBox.content);
  emitter.write('</Note>\n\n');
}
```

### Adding New Custom Nodes

To add a new custom node type (e.g., `DocCodeBlock`):

1. **Create node class:**
```typescript
// src/nodes/DocCodeBlock.ts
import { IDocNodeParameters, DocNode } from '@microsoft/tsdoc';
import { CustomDocNodeKind } from './CustomDocNodeKind';

export interface IDocCodeBlockParameters extends IDocNodeParameters {
  code: string;
  language: string;
}

export class DocCodeBlock extends DocNode {
  public readonly code: string;
  public readonly language: string;

  constructor(parameters: IDocCodeBlockParameters) {
    super(parameters);
    this.code = parameters.code;
    this.language = parameters.language;
  }

  public get kind(): string {
    return CustomDocNodeKind.CodeBlock;
  }
}
```

2. **Add to CustomDocNodeKind enum:**
```typescript
// src/nodes/CustomDocNodeKind.ts
export enum CustomDocNodeKind {
  // ... existing kinds ...
  CodeBlock = 'CodeBlock'
}
```

3. **Register with TSDocConfiguration:**
```typescript
// src/nodes/CustomDocNodeKind.ts
configuration.docNodeManager.registerDocNodes('@microsoft/mintlify-tsdocs', [
  // ... existing registrations ...
  { docNodeKind: CustomDocNodeKind.CodeBlock, constructor: DocCodeBlock }
]);

// Define allowable parents
configuration.docNodeManager.registerAllowableChildren(DocNodeKind.Section, [
  // ... existing children ...
  CustomDocNodeKind.CodeBlock
]);
```

4. **Add rendering logic:**
```typescript
// src/markdown/CustomMarkdownEmitter.ts
if (node.kind === CustomDocNodeKind.CodeBlock) {
  const codeBlock = node as DocCodeBlock;
  this.write('```' + codeBlock.language + '\n');
  this.write(codeBlock.code);
  this.write('\n```\n\n');
}
```

### Testing Custom Nodes

```typescript
import { CustomDocNodes, DocHeading } from '../nodes';

describe('DocHeading', () => {
  it('should validate heading level', () => {
    const config = CustomDocNodes.configuration;

    expect(() => new DocHeading({
      configuration: config,
      title: 'Test',
      level: 6  // Invalid
    })).toThrow('must be a number between 1 and 5');
  });

  it('should have correct kind', () => {
    const heading = new DocHeading({
      configuration: CustomDocNodes.configuration,
      title: 'Test',
      level: 2
    });

    expect(heading.kind).toBe(CustomDocNodeKind.Heading);
    expect(heading.title).toBe('Test');
    expect(heading.level).toBe(2);
  });
});
```

## Known Issues

### 🔴 Critical

1. **Package Name Typo** (CustomDocNodeKind.ts:33)
   - **Issue**: `@micrososft/mintlify-tsdocs` should be `@microsoft/mintlify-tsdocs`
   - **Impact**: Incorrect package identification in TSDoc registration
   - **Fix**: Correct the typo:
   ```typescript
   configuration.docNodeManager.registerDocNodes('@microsoft/mintlify-tsdocs', [
   ```

### 🟡 Major

2. **Singleton Configuration** (CustomDocNodeKind.ts:27-62)
   - **Issue**: Single static TSDocConfiguration instance
   - **Impact**: Cannot have different configurations, testing is difficult
   - **Fix**: Allow configuration injection:
   ```typescript
   public static createConfiguration(): TSDocConfiguration {
     const configuration = new TSDocConfiguration();
     // ... register nodes ...
     return configuration;
   }
   ```

3. **No Validation in Node Constructors**
   - **Issue**: Only DocHeading validates its parameters
   - **Impact**: Invalid nodes could be created
   - **Fix**: Add validation to all node constructors:
   ```typescript
   constructor(parameters: IDocTableParameters) {
     super(parameters);
     if (!this.header) {
       throw new Error('Table must have a header');
     }
   }
   ```

4. **Missing Documentation**
   - **Issue**: Node classes lack detailed JSDoc comments
   - **Impact**: Unclear how to use nodes, what they render as
   - **Fix**: Add comprehensive JSDoc:
   ```typescript
   /**
    * Represents a table in documentation.
    *
    * @remarks
    * Tables are rendered as markdown tables with a header row and data rows.
    *
    * @example
    * ```typescript
    * const table = new DocTable({
    *   configuration,
    *   header: headerRow,
    *   rows: [dataRow1, dataRow2]
    * });
    * ```
    *
    * @public
    */
   ```

### 🟢 Minor

5. **No Type Guards**
   - **Issue**: No helper functions to check node types
   - **Enhancement**: Add type guards:
   ```typescript
   export function isDocHeading(node: DocNode): node is DocHeading {
     return node.kind === CustomDocNodeKind.Heading;
   }
   ```

6. **Inconsistent Parameter Interfaces**
   - **Issue**: Some have rich parameters, others are empty
   - **Enhancement**: Standardize parameter interfaces

7. **No Node Factory**
   - **Issue**: Creating nodes requires verbose constructor calls
   - **Enhancement**: Add factory methods:
   ```typescript
   export class DocNodeFactory {
     static createHeading(title: string, level: number = 2): DocHeading {
       return new DocHeading({
         configuration: CustomDocNodes.configuration,
         title,
         level
       });
     }
   }
   ```

## Performance Characteristics

### Time Complexity

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Node creation | O(1) | Simple object construction |
| Get configuration | O(1) | Cached singleton |
| Tree traversal | O(n) | n = number of nodes |

### Memory Usage

- **Configuration**: ~10KB (singleton, shared)
- **Per node**: ~200 bytes + content
- **Tree of 100 nodes**: ~20KB

## Dependencies

### External Dependencies
- `@microsoft/tsdoc` - TSDoc parsing and node system

### Internal Dependencies
- None - standalone module

## Related Modules

- **`markdown/CustomMarkdownEmitter`** - Renders custom nodes to markdown
- **`documenters/`** - Uses custom nodes for rich documentation

## References

- [TSDoc Specification](https://tsdoc.org/)
- [@microsoft/tsdoc API](https://www.npmjs.com/package/@microsoft/tsdoc)
- [Mintlify Components](https://mintlify.com/docs/content/components)

---

## Quick Reference

### Available Node Types

```typescript
// Text emphasis
new DocEmphasisSpan({ bold: true, italic: false }, [...children]);

// Headings
new DocHeading({ title: 'Section', level: 2 });

// Note boxes
new DocNoteBox({}, [...children]);

// Expandable sections
new DocExpandable({ title: 'Details' }, [...children]);

// Tables
new DocTable({ header: headerRow, rows: [row1, row2] });
new DocTableRow({}, [cell1, cell2]);
new DocTableCell({}, [...children]);
```

### Node Hierarchy

```
- DocEmphasisSpan can contain: PlainText, SoftBreak
- DocHeading: leaf node (just title)
- DocNoteBox can contain: any Section content
- DocExpandable can contain: any Section content
- DocTable can contain: DocTableRow
- DocTableRow can contain: DocTableCell
- DocTableCell can contain: any Section content
```

### Using Configuration

```typescript
import { CustomDocNodes } from '../nodes/CustomDocNodeKind';

const config = CustomDocNodes.configuration;
// Use this config for all custom nodes
```
