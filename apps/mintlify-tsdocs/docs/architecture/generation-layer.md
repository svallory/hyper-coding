# Deep Dive: Documentation Generation Layer

This document explores the documentation generation layer, which is the core orchestrator of `mintlify-tsdocs`. It is responsible for traversing the API model and constructing the semantic structure of each documentation page.

**Primary Component:** `@src/documenters/MarkdownDocumenter.ts`

## Key Responsibilities

The `MarkdownDocumenter` class takes the `ApiModel` (from the CLI layer) and a set of configuration options, and its primary job is to generate the corresponding `.mdx` files.

1.  **File Management**: The main `generateFiles()` method begins by calling `_deleteOldOutputFiles()` to ensure a clean output directory.
2.  **API Traversal**: It starts by calling `_writeApiItemPage()` on the root `ApiModel`. This recursively traverses the API model, generating pages for packages, namespaces, classes, interfaces, and other top-level exports. Member-level items (like methods and properties) are documented within their parent's page, not as separate files.
3.  **AST Construction**: For each page, `MarkdownDocumenter` does **not** write Markdown directly. Instead, it builds an Abstract Syntax Tree (AST) using `DocNode` objects from `@microsoft/tsdoc`. This tree represents the document's structure.
    -   `_writeApiItemPage()` creates the main heading and summary.
    -   Methods like `_writeClassTables()`, `_writeInterfaceTables()`, and `_writeParameterTables()` are called to generate tables for API members.
    -   These methods create custom AST nodes like `DocTable`, `DocTableRow`, and `DocTableCell` to represent the tabular data.
    -   This AST approach decouples the documentation structure from the final output syntax, making the system more maintainable.
4.  **Frontmatter Generation**: The `_generateFrontmatter()` method creates the YAML frontmatter block required by Mintlify at the top of each `.mdx` file, including the `title`, `icon`, and a `description` derived from the item's TSDoc summary.
5.  **Invoking the Emitter**: Once the `DocNode` tree for a page is complete, `MarkdownDocumenter` passes it to the `CustomMarkdownEmitter`, which is responsible for serializing the AST into an MDX string.
6.  **Navigation Generation**: After all files have been written, `generateNavigation()` is called. It reads the existing `docs.json` file (if any), merges the newly generated page paths into the navigation structure under the correct tab and group, and writes the file back to disk. It uses the `_navigationItems` array, which was populated during the file generation process, to build this structure.

## Code Flow for a Single Page (e.g., a Class)

1.  `_writeApiItemPage(apiClass)` is called.
2.  A root `DocSection` is created to hold the page's content.
3.  `_writeBreadcrumb()` adds the navigation breadcrumb at the top.
4.  A `DocHeading` is created for the class title (e.g., "MyClass class").
5.  The class's TSDoc summary and remarks are appended to the AST.
6.  `_writeHeritageTypes()` adds the `Extends` and `Implements` sections.
7.  `_writeClassTables()` is called to document the class members.
    -   It creates `DocTable` nodes for Constructors, Properties, and Methods.
    -   It iterates over `apiClass.members`.
    -   For each member, it creates a `DocTableRow` containing cells (`DocTableCell`) for the member's name, modifiers, type, and description. The name cell contains a `DocLinkTag` to allow for intra-page linking if needed in the future.
8.  The completed `DocSection` (the page's AST) is passed to `this._markdownEmitter.emit()`.
9.  The resulting string is written to a file (e.g., `myclass.mdx`).
10. A navigation entry for the new page is added to `this._navigationItems`.
