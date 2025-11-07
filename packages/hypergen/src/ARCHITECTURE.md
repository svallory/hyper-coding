# Hypergen Architecture

## Summary

Hypergen is a modern, scalable code generator built with TypeScript. Its architecture is designed for extensibility, performance, and a rich developer experience, supporting both direct action execution and complex multi-step recipe workflows. The core engine orchestrates various modules responsible for configuration, template rendering, action execution, code transformations, and CLI interactions.

## Module Descriptions

Here's a brief description of each core module within Hypergen:

*   **[Actions Module](src/actions/README.md)**: Hypergen's V8 action system, a decorator-based, TypeScript-first system for defining and executing reusable, composable actions within templates and workflows.
*   **[CLI Module](src/cli/README.md)**: The command-line interface layer for Hypergen, providing the primary user-facing commands and interactions.
*   **[Configuration System Module](src/config/README.md)**: Provides the comprehensive configuration management system for Hypergen, handling loading, parsing, validating, and composing template configurations.
    *   **[URL Resolution System](src/config/url-resolution/README.md)**: Provides a robust, extensible framework for resolving template references from multiple sources (local files, GitHub repositories, npm packages, HTTP endpoints) with intelligent caching, security controls, and integrity verification.
        *   **[URL Resolution Resolvers](src/config/url-resolution/resolvers/README.md)**: Contains the resolver implementations for Hypergen's template URL resolution system, responsible for fetching and resolving template configurations from various sources.
*   **[Generator Discovery Module](src/discovery/README.md)**: A core subsystem that automatically discovers and catalogs generators from multiple sources (local, npm, workspace, git).
*   **[Error System Module](src/errors/README.md)**: Provides comprehensive error handling and validation for Hypergen, with user-friendly messages, actionable suggestions, and context-aware error reporting.
*   **[Indexed Store Module](src/indexed-store/README.md)**: A high-performance, type-safe data structure library for fast lookups and multi-property indexing.
*   **[Operations Module](src/ops/README.md)**: The heart of Hypergen's file generation and manipulation system, providing a plugin-style architecture for executing different types of actions (file creation, code injection, shell commands, etc.).
*   **[Plugin System Module](src/plugin-system/README.md)**: An extensible plugin system for adding custom template engines, validators, and more.
*   **[Interactive Prompts Module](src/prompts/README.md)**: Provides a comprehensive interactive prompting system for Hypergen's code generation workflow, enabling beautiful, user-friendly CLI prompts.
*   **[Recipe Engine Module](src/recipe-engine/README.md)**: A comprehensive orchestration system for coordinating complex, multi-step code generation and transformation workflows, unifying templates, actions, codemods, and sub-recipes.
    *   **[Recipe Step System - Tools Framework](src/recipe-engine/tools/README.md)**: Contains the core tools framework for the Recipe Step System, coordinating template generation, action execution, code modifications, and recipe composition.
*   **[Template Engines Module](src/template-engines/README.md)**: Provides a pluggable, abstraction layer for template rendering in Hypergen, decoupling the core generation engine from specific template engine implementations.
*   **[Built-in Template Directory](src/templates/README.md)**: Contains legacy built-in templates from the original Hygen project, providing a bootstrapping mechanism for creating new generators and template repositories.
    *   **[Init Templates - Meta-Template System](src/templates/init/README.md)**: Contains the legacy meta-template system inherited from Hygen, where templates generate other templates.

## High-Level Architecture Diagram

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
