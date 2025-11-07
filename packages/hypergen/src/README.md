# Hypergen Core Source (`src/`)

This directory contains the core source code for the Hypergen engine. It is organized into several modules, each responsible for a specific part of the code generation process.

## High-Level Architecture

```mermaid
graph TD
    A[User/CLI] --> B(HypergenCLI)
    B --> C{Core Engine}
    C --> D[Configuration System]
    C --> E[Generator Discovery]
    C --> F[Template Engines]
    C --> G[Action System]
    C --> H[Recipe Engine]
    C --> I[Operations Module]
    C --> J[Error Handling]
    C --> K[Indexed Store]
    C --> L[Utilities/Helpers]

    D --> D1[hypergen-config]
    D --> D2[template-parser]
    D --> D3[template-composition]
    D --> D4[dependency-manager]
    D --> D5[URL Resolution]

    E --> E1[GeneratorDiscovery]

    F --> F1[LiquidJS Engine]
    F --> F2[EJS Engine]
    F --> F3[Plugin System]

    G --> G1[ActionExecutor]
    G --> G2[ActionRegistry]
    G --> G3[ParameterResolver]
    G --> G4[LifecycleManager]
    G --> G5[CommunicationManager]
    G --> G6[ActionPipelines]

    H --> H1[StepExecutor]
    H --> H2[ToolRegistry]
    H --> H3[TemplateTool]
    H --> H4[ActionTool]
    H --> H5[CodeModTool]
    H --> H6[RecipeTool]

    I --> I1[Add Operation]
    I --> I2[Inject Operation]
    I3[Shell Operation]
    I4[Setup Operation]
    I5[Echo Operation]

    D5 --> D51[URLManager]
    D5 --> D52[URLCache]
    D5 --> D53[LocalResolver]
    D5 --> D54[GitHubResolver]

    subgraph Core Engine and CLI
        C
        B
    end

    subgraph Configuration
        D
        D1
        D2
        D3
        D4
        D5
        D51
        D52
        D53
        D54
    end

    subgraph Generation and Templating
        F
        F1
        F2
        F3
    end

    subgraph Execution and Operations
        I
        I1
        I2
        I3
        I4
        I5
    end

    subgraph Actions and Recipe Engine (V8)
        G
        G1
        G2
        G3
        G4
        G5
        G6
        H
        H1
        H2
        H3
        H4
        H5
        H6
    end

    subgraph Utilities and Helpers
        J
        K
        L
    end
```

## Module Overview

### Core Engine and CLI

-   **`bin.ts`**: The main CLI entry point for Hypergen. It parses command-line arguments, initializes the `HypergenCLI` class, and executes commands.
-   **`bin.timed.ts`**: A wrapper around `bin.ts` that uses `time-require` to measure module loading performance.
-   **`engine.ts`**: The main Hypergen V8 engine. It handles command-line arguments, displays help messages, and orchestrates the overall execution through the `HypergenCLI`.
-   **`index.ts`**: The main export point for the Hypergen package. It exports the `runner`, `engine`, and other key components.

### Configuration

-   **`config.ts`**: Implements the `ConfigResolver` class, which is responsible for finding and loading Hypergen configuration files (`.hypergen.js`, etc.) by traversing up the directory tree.
-   **`config-resolver.ts`**: The main configuration resolver for Hypergen. It normalizes `templates` configuration, resolves template paths, and merges configurations from different sources.

### Generation and Templating

-   **`generators.ts`**: Handles the discovery and loading of generators from template directories. It resolves action conflicts and populates the `TemplateStore`.
-   **`render.ts`**: Responsible for rendering templates using different template engines (EJS, LiquidJS). It processes frontmatter and injects variables into templates.
-   **`TemplateStore.ts`**: A high-performance, in-memory store for templates, generators, and actions. It uses an indexed data structure for fast lookups.

### Execution and Operations

-   **`execute.ts`**: Executes a series of rendered actions. It resolves which operations (add, inject, shell, etc.) to run based on the template's frontmatter and executes them sequentially.
-   **[`ops/`](src/ops/README.md)**: A directory containing the individual file operations that can be triggered from templates (e.g., `add`, `inject`, `shell`).

### Actions and Recipe Engine (V8)

-   **[`actions/`](src/actions/README.md)**: The V8 action system, which provides a decorator-based, TypeScript-first way to define reusable, composable actions.
-   **[`recipe-engine/`](src/recipe-engine/README.md)**: The V8 recipe step system, which orchestrates complex, multi-step code generation workflows.

### Command-Line Interface

-   **[`cli/`](src/cli/README.md)**: The core CLI module that implements all command handlers for Hypergen (e.g., `action`, `discover`, `list`, `init`).
-   **`params.ts`**: Parses and resolves command-line arguments, including generator, action, and name.
-   **`prompt.ts`**: Handles interactive prompting for missing parameters using `enquirer`.
-   **[`prompts/`](src/prompts/README.md)**: A modern interactive prompting system based on `@clack/prompts`.
-   **`help.ts`**: Generates and displays help messages for the CLI.

### Utilities and Helpers

-   **`constants.ts`**: Defines project-wide constants, such as the Hypergen version and default action name.
-   **`context.ts`**: Creates the context object that is available inside templates, providing variables and helper functions.
-   **`helpers.ts`**: A collection of utility functions (e.g., `capitalize`, `inflection`, `changeCase`) that are exposed to templates.
-   **`logger.ts`**: A simple logging utility with support for colored output using `chalk`.
-   **`newline.ts`**: A utility for detecting and normalizing line endings in template files.
-   **`types.ts`**: Contains the core TypeScript interfaces and type definitions for the Hypergen engine.

### Other Modules

-   **[`discovery/`](src/discovery/README.md)**: The generator auto-discovery system, which finds and registers generators from various sources (local, npm, workspace).
-   **[`errors/`](src/errors/README.md)**: A comprehensive error handling system with user-friendly messages and suggestions.
-   **[`indexed-store/`](src/indexed-store/README.md)**: A high-performance, type-safe data structure for fast lookups and multi-property indexing.
-   **[`plugin-system/`](src/plugin-system/README.md)**: An extensible plugin system for adding custom template engines, validators, and more.
-   **[`template-engines/`](src/template-engines/README.md)**: An abstraction layer for template rendering, with support for LiquidJS and EJS.
-   **[`templates/`](src/templates/README.md)**: Legacy built-in templates from the original Hygen project, used for bootstrapping new generators.
