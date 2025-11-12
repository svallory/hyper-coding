# Architecture Overview

This document provides a high-level overview of the `mintlify-tsdocs` codebase, intended for contributors.

## Introduction

`mintlify-tsdocs` is a command-line tool that generates [Mintlify](https://mintlify.com/)-compatible API documentation from the `*.api.json` files produced by [API Extractor](https://api-extractor.com/).

The core architecture is a multi-stage pipeline that transforms structured API data into final MDX files.

`[api.json files]` --> `[API Model]` --> `[TSDoc AST]` --> `[MDX String]` --> `[*.mdx files]`

The main libraries underpinning this process are:
-   `@rushstack/ts-command-line`: For building the command-line interface.
-   `@microsoft/api-extractor-model`: For loading `api.json` files into a traversable object model (`ApiModel`).
-   `@microsoft/tsdoc`: For creating an Abstract Syntax Tree (AST) of the documentation content before it's rendered.

## Component Deep Dive

The codebase is organized into several distinct layers, each with a specific responsibility. We'll explore them in a top-down fashion, following the flow of data.

### 1. CLI Layer (`@src/cli`)

This layer is the main entry point and is responsible for parsing user input.

-   **`@src/start.ts`**: The executable entry point that initializes and runs the CLI.
-   **`ApiDocumenterCommandLine.ts`**: The main CLI parser class. It defines the tool's identity and registers the available commands (currently, only `markdown`).
-   **`BaseAction.ts`**: An abstract base class for all actions. Its primary role is to handle common setup, such as parsing the `--input-folder` and `--output-folder` parameters and loading the `api.json` files into an `ApiModel` instance using the `buildApiModel()` method.
-   **`MarkdownAction.ts`**: This is the implementation of the `markdown` command. It defines all the Mintlify-specific flags (e.g., `--docs-json`, `--group`). Its `onExecuteAsync()` method orchestrates the entire documentation generation process by creating and invoking the `MarkdownDocumenter`.

### 2. Documentation Generation Layer (`@src/documenters`)

This layer is the central orchestrator that drives the conversion from the API model to documentation pages.

-   **`MarkdownDocumenter.ts`**: This is the most important class in the application.
    -   **Orchestration**: Its `generateFiles()` method is the main driver. It first deletes old output, then iterates through the packages and items in the `ApiModel`.
    -   **Page Generation**: For each `ApiItem` (like a class, interface, or function), it calls `_writeApiItemPage()`. This method is responsible for building the structure of a single documentation page.
    -   **AST Construction**: Inside `_writeApiItemPage()`, the document is constructed as a tree of `DocNode` objects from the `@microsoft/tsdoc` library. For example, it creates `DocHeading` nodes for titles and `DocTable` nodes for lists of members (properties, methods, etc.). This AST represents the semantic structure of the document, independent of the final output format.
    -   **Navigation**: After generating all files, it calls `generateNavigation()` to read, update, and write the `docs.json` file, injecting the hierarchical navigation structure for the newly created pages.

### 3. Markdown Emission Layer (`@src/markdown`)

This layer is responsible for serializing the TSDoc AST into the final MDX string.

-   **`CustomMarkdownEmitter.ts`**: This class extends the base `MarkdownEmitter` and contains all the Mintlify-specific rendering logic.
    -   **Node Rendering**: It overrides the `writeNode()` method to provide custom rendering for different `DocNode` types. For example, it renders `DocHeading` as `## Title`.
    -   **Mintlify Component Logic**: Its most critical feature is the custom handling of `DocTable`. Instead of rendering a standard HTML `<table>`, it inspects the table's content. If it determines the table is for properties or methods, it calls internal methods (`_writePropertySection`, `_writeMethodSection`) that use `DocumentationHelper` to generate rich Mintlify components like `<ParamField>` and `<ResponseField>`. This is the key to the tool's rich UI output.
    -   **Link Resolution**: It's also responsible for resolving cross-references between API items and generating the correct relative links for the MDX files.

### 4. Utilities and AST Nodes (`@src/utils`, `@src/nodes`)

These are supporting components that provide reusable functionality.

-   **`@src/nodes`**: This directory defines custom TSDoc AST nodes (e.g., `DocTable`, `DocHeading`, `DocEmphasisSpan`). These provide a structured, in-memory representation of the documentation that `MarkdownDocumenter` can build and `CustomMarkdownEmitter` can consume.
-   **`DocumentationHelper.ts`**: A helper class used by the emitter to abstract away the logic for creating Mintlify components. It uses `ObjectTypeAnalyzer` to parse type strings and identify nested object structures, and `JsDocExtractor` to enrich properties with their JSDoc descriptions.
-   **`ObjectTypeAnalyzer.ts`**: A sophisticated utility that parses TypeScript type strings to identify their structure (e.g., primitives, arrays, object literals with properties, unions, intersections, and generics). This enables the `DocumentationHelper` to recursively document nested objects inside `<ParamField>` components with proper type analysis.
-   **`JsDocExtractor.ts`**: Extracts JSDoc descriptions for nested properties, enabling rich documentation of complex object types with proper descriptions for each nested field.
-   **`IndentedWriter.ts`**: A simple but essential utility for building the output string with proper indentation.
-   **`Utilities.ts`**: Provides helper functions for generating concise function signatures and safe filenames for API items.

## How to Contribute

Understanding the pipeline is key to contributing:

-   **To change MDX output or add a new Mintlify component:** The work will likely be in `CustomMarkdownEmitter.ts` and potentially `DocumentationHelper.ts`. You might also need a new `DocNode` in `@src/nodes`.
-   **To change the structure of a page (e.g., add a new section):** The changes will be in `MarkdownDocumenter.ts`, where the `DocNode` tree is constructed.
-   **To add a new CLI option:** Start in `MarkdownAction.ts` to define the parameter, then pass the value down to `MarkdownDocumenter` and use it where needed.
