# Requirements Session: oclif-refactoring

## User Problem Definition

**Q1**: What specific problem does this solve?
**A1**: The current `hypergen` CLI is implemented in a single, large, monolithic class (`src/cli/cli.ts`) that is difficult to maintain, extend, and test. It uses custom logic for command routing and argument parsing, which adds to the maintenance overhead. Furthermore, this custom structure prevents `hypergen` from being used as a plugin for other CLIs, specifically the `hyper` CLI.

**Q2**: Who experiences this problem and how often?
**A2**: Developers working on the `hypergen` codebase experience this problem whenever they need to add or modify CLI commands. Users of the `hyper` CLI ecosystem also experience this problem indirectly, as they cannot use `hypergen`'s functionality within the main `hyper` CLI.

**Q3**: What's the cost of not solving this?
**A3**: The cost is increased development time, a higher risk of introducing regressions when modifying the CLI, and a continued barrier to integrating `hypergen` into the broader `hyper` CLI ecosystem. The codebase will become progressively harder to maintain.

## Solution Scope

**Q4**: What's the minimal viable solution?
**A4**: The minimal viable solution would be to migrate a few of the most important commands (e.g., `action`, `list`, `init`) to the `oclif` framework. This would establish the new architecture, prove the plugin concept, and allow for incremental migration of the remaining commands.

**Q5**: What would "done" look like for users?
**A5**: For end-users, the CLI's behavior, commands, and flags should remain functionally identical to the previous version. For developers using the `hyper` CLI, "done" means they can install `hypergen` as a plugin and access its commands via `hyper gen ...`. For developers maintaining `hypergen`, "done" means the old `HypergenCLI` class is gone, and all commands are implemented as `oclif` command classes in a `src/commands` directory.

**Q6**: What's explicitly out of scope?
**A6**: This refactoring is strictly limited to the CLI layer. Any changes to the core business logic of the action system, recipe engine, generator discovery, or template rendering are out of scope. The functionality of the underlying services should not be altered, only how they are invoked by the CLI.

## Technical Requirements

**Q7**: What are the performance requirements?
**A7**: The performance of the new `oclif`-based CLI (in terms of startup time and command execution speed) should be at least as good as, and ideally better than, the current implementation. `oclif`'s command lazy-loading should help with this.

**Q8**: What are the security/compliance needs?
**A8**: No new security vulnerabilities should be introduced. By moving from a custom-rolled parsing and routing solution to a well-maintained, popular framework like `oclif`, the security posture should be improved.

**Q9**: What external integrations are required?
**A9**: The primary integration is making `hypergen` a plugin for the `hyper` CLI. This requires structuring the `oclif` project in a way that it's a valid plugin.

## Implementation Constraints

**Q10**: What's the timeline/deadline pressure?
**A10**: No specific timeline was given, but the work should be completed efficiently to unblock future feature development.

**Q11**: What resources are available?
**A11**: The agent (me) is the resource for implementing this refactoring.

**Q12**: What can't change in existing systems?
**A12**: The public interface of the CLI commands must not change. All existing commands, subcommands, arguments, and flags must be preserved to ensure a non-breaking change for end-users of the standalone `hypergen` CLI.
