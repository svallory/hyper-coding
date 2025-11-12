# Deep Dive: TSDoc AST Nodes Layer

This document covers the TSDoc Abstract Syntax Tree (AST) Nodes layer, which provides the in-memory representation of the documentation before it is rendered to MDX.

**Primary Components:** `@src/nodes/*.ts`

## The Role of the TSDoc AST

Instead of writing Markdown strings directly, `mintlify-tsdocs` first builds a tree structure that semantically represents the document. This tree is the TSDoc AST, and each element in the tree is a `DocNode`.

This approach has several advantages:
-   **Separation of Concerns**: The logic for what a document *contains* (in `MarkdownDocumenter`) is separate from how it *looks* (in `CustomMarkdownEmitter`).
-   **Maintainability**: To change the output for a specific element (e.g., how tables are rendered), you only need to modify the emitter's handling for that node type, without touching the document generation logic.
-   **Extensibility**: We can define our own custom `DocNode` types to represent unique concepts that don't exist in the base TSDoc standard.

## Custom Doc Nodes

`mintlify-tsdocs` extends the standard set of TSDoc nodes with its own custom types to better represent the structure of API documentation.

These custom nodes are defined in the `@src/nodes/` directory and registered in `@src/nodes/CustomDocNodeKind.ts`.

### Key Custom Nodes

-   **`DocHeading`**: Represents a section heading (e.g., `<h2>`, `<h3>`). It holds a `title` and a `level`.
-   **`DocNoteBox`**: Represents a "note" or "warning" box, which is rendered as a blockquote. It contains a `DocSection` for its content.
-   **`DocTable`**: Represents a complete table. It contains a `DocTableRow` for the header and an array of `DocTableRow`s for the body. This is one of the most important custom nodes, as the emitter inspects it to decide whether to render a standard HTML `<table>` or Mintlify's `<ParamField>` / `<ResponseField>` components.
-   **`DocTableRow`**: Represents a single row in a `DocTable`, containing an array of `DocTableCell`s.
-   **`DocTableCell`**: Represents a single cell in a `DocTableRow`, containing a `DocSection` for its content.
-   **`DocEmphasisSpan`**: A container for text that should be rendered as bold, italic, or both.
-   **`DocExpandable`**: Represents a Mintlify `<Expandable>` component, containing a `title` and a `DocSection` for its content. This is used for rendering nested object properties.

### Registration

The `CustomDocNodes.configuration` static getter in `CustomDocNodeKind.ts` is where these custom nodes are registered with the TSDoc system. This configuration is then used throughout the application to ensure the TSDoc parser and other components recognize these custom node types and their allowed child nodes.
