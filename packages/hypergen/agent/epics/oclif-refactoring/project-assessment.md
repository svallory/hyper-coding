# Project Assessment for oclif-refactoring

## Codebase Analysis

- **Architecture**: The Hypergen codebase is a modular TypeScript project. The core logic is separated into distinct systems, each with its own directory and `README.md` under `src/`. Key modules include the Actions System (`src/actions`), a comprehensive Configuration System (`src/config`), a Generator Discovery module (`src/discovery`), and a V8 Recipe Engine (`src/recipe-engine`) for complex workflows. The CLI layer, which is the target of this refactoring, is currently implemented as a large, monolithic class (`src/cli/cli.ts`) that manually parses arguments and routes commands. This refactoring will replace that monolithic class with `oclif`'s command structure.

- **Technology Stack**:
  - **Language**: TypeScript
  - **Runtime**: Bun
  - **Package Manager**: Bun
  - **CLI Framework (Current)**: A custom, `yargs-parser`-based solution.
  - **CLI Framework (Proposed)**: `oclif`
  - **Testing**: `bun:test`
  - **Linting**: ESLint
  - **Formatting**: Prettier

- **Database Design**: Not applicable. This is a command-line tool that operates on the file system.

- **API Patterns**: The CLI interacts with the internal APIs of other modules (e.g., `ActionExecutor`, `RecipeEngine`). These modules appear to be well-encapsulated. The refactoring will change how the CLI calls these internal APIs, but not the APIs themselves.

- **Frontend Architecture**: Not applicable.

- **Testing Strategy**: The project has a `tests/` directory with extensive tests for various modules. The filenames (`*.test.ts`, `*.spec.ts`) and content suggest a combination of unit and integration testing using `bun:test`. The existing CLI tests will need to be rewritten to support the new `oclif` command structure.

- **Build & Deploy**: The project uses `bun` for its build process. Deployment and CI are managed through GitHub Actions, with workflow files located in `.github/workflows/`.

## Recent Changes

- **Last 10 commits**: I do not have access to the project's git history.
- **Active branches**: I do not have access to the project's git history.
- **Open PRs**: I do not have access to the project's git history.

## Technical Debt & Constraints

- **Legacy code**: The primary source of technical debt is the `src/cli/cli.ts` file. It's a large, 2,200+ line class that handles all command routing and execution logic via a large `switch` statement. This makes it difficult to maintain and extend. The `src/cli/README.md` file even contains a TODO list for unimplemented functions within this class, highlighting existing debt. This refactoring directly addresses this debt.
- **Constraints**: The public-facing API of the CLI (commands, arguments, flags) should remain as consistent as possible to avoid breaking changes for existing users.

## Resource Analysis

- **Existing libraries**: The current CLI uses `yargs-parser` for argument parsing. This will be replaced by `oclif`'s built-in parsing. The project also uses `@clack/prompts` for interactive prompts, which can be integrated with or replaced by `oclif`'s own prompt utilities.
- **Reusable components**: The core logic is well-separated into modules like `ActionExecutor`, `GeneratorDiscovery`, `RecipeEngine`, and `GeneratorScaffolding`. These services are highly reusable and will be called from the new `oclif` commands, preserving the core business logic.
- **Development patterns**: The project follows standard TypeScript and ES module conventions. The modular structure is a strong pattern to follow. The refactoring should adhere to this by creating a `src/commands` directory with each command in its own file, following `oclif` conventions.
