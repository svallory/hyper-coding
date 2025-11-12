# Deep Dive: CLI Layer

This document explores the command-line interface (CLI) layer of `mintlify-tsdocs`, which is responsible for parsing user commands and initiating the documentation generation process.

**Entry Point:** `@src/start.ts`

## Key Components

- **`@rushstack/ts-command-line`**: The framework used to build the CLI, providing a structured way to define commands, actions, and parameters.
- **`@src/start.ts`**: The executable entry point. It creates an instance of `DocumenterCli` and calls `executeAsync()` to run the parser.
- **`@src/cli/ApiDocumenterCommandLine.ts`**: The main `CommandLineParser` class. It configures the tool's name and description and is responsible for registering all available actions. Currently, it only registers the `MarkdownAction`.
- **`@src/cli/BaseAction.ts`**: An abstract class that provides foundational functionality for all actions. Its most important method is `buildApiModel()`, which:
    1.  Reads the `--input-folder` and `--output-folder` parameters.
    2.  Validates the existence of the input folder.
    3.  Creates an `ApiModel` instance from `@microsoft/api-extractor-model`.
    4.  Iterates through the input folder, finds all `*.api.json` files, and loads each one into the `ApiModel` using `apiModel.loadPackage()`.
    5.  Applies a workaround for `@inheritDoc` TSDoc tags.
- **`@src/cli/MarkdownAction.ts`**: The concrete implementation for the `markdown` command. It inherits from `BaseAction` and defines all the Mintlify-specific command-line parameters:
    -   `--docs-json`: Path to Mintlify navigation file.
    -   `--tab-name`: The navigation tab for the API docs.
    -   `--group`: The group within the tab.
    -   `--menu`: Enables the menu for the group.
    -   `--readme`: Triggers conversion of `README.md` to `index.mdx`.
    -   `--readme-title`: Custom title for the README page.

## Execution Flow

1.  A user runs `mintlify-tsdocs markdown ...` from their terminal.
2.  The `start.ts` script is executed.
3.  An instance of `DocumenterCli` is created.
4.  The `executeAsync()` method on the `DocumenterCli` instance parses the command-line arguments.
5.  Because the user specified the `markdown` action, the parser invokes the `onExecuteAsync()` method of the `MarkdownAction` class.
6.  Inside `MarkdownAction.onExecuteAsync()`:
    a.  `this.buildApiModel()` is called, which reads all `*.api.json` files and returns a fully populated `ApiModel` object.
    b.  A new `MarkdownDocumenter` is instantiated, passing the `ApiModel` and all the parsed CLI options (output folder, docs.json path, etc.).
    c.  `markdownDocumenter.generateFiles()` is called, handing off control to the documentation generation layer.
