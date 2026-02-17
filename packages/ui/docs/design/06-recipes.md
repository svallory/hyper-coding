# CLI Design System — Recipes

## Purpose

Recipes are documented compositions of components that are too common to leave undocumented but too large or domain-specific to be components. They're patterns, not abstractions — the DS does not ship executable recipe code. Instead, it shows how to compose existing components to produce well-known CLI output patterns.

**A recipe is:**
- A documented arrangement of components and primitives
- An expected output example
- Guidance on when to use it and when to deviate

**A recipe is NOT:**
- A new abstraction to import
- A rigid template that must be followed exactly
- A replacement for understanding the underlying components

---

## Recipe Catalog

| Recipe | Use case |
|---|---|
| [Error Recovery](#error-recovery) | An error occurred and you're suggesting next steps |
| [Command Summary](#command-summary) | A command completed and you're reporting what happened |
| [Deploy Output](#deploy-output) | A multi-step deployment or build process |
| [Test Report](#test-report) | Test suite results with pass/fail counts |
| [Install Report](#install-report) | Package installation output |
| [Task Runner](#task-runner) | Sequential or parallel task execution |
| [Config Display](#config-display) | Showing current configuration state |
| [Help Screen](#help-screen) | Full command help output |
| [Interactive Wizard](#interactive-wizard) | Multi-step prompt flow |
| [Init / Scaffold](#init--scaffold) | Project initialization output |
| [Changelog / Release Notes](#changelog--release-notes) | Version changelog display |
| [Audit Report](#audit-report) | Security or quality audit results |

---

## Error Recovery

**When to use:** An operation failed and the user needs to understand what happened and what to do next.

**Components used:** Message (error), Indent, StyledText (code), Message (hint)

**Structure:**

```
[Message: error]
  [Detail: what happened]

  [Hint: what to try next]
    [Code: command to run]
```

**Example:**

```
✗ Failed to connect to registry at https://registry.npmjs.org
  ETIMEDOUT — the request timed out after 30 seconds.

  Possible fixes:
    Check your internet connection
    Try setting a custom registry:
      npm config set registry https://registry.npmmirror.com
    Retry with increased timeout:
      myapp install --timeout 60
```

**Anti-patterns:**
- Don't dump a stack trace as the primary error. Put it behind `--verbose`.
- Don't say "An error occurred." Say what the error was.
- Don't suggest fixes that don't apply. If you don't know what went wrong, say so.

---

## Command Summary

**When to use:** A command completed (successfully or with mixed results) and you're summarizing what happened.

**Components used:** Message (success/warning), KeyValue or Indent, StyledText (dim for metadata)

**Structure:**

```
[Message: success/warning] [primary outcome]
  [Key detail 1]
  [Key detail 2]
  [dim: metadata]
```

**Examples:**

Simple success:
```
✓ Published myapp@2.1.0 to npm (4.2s)
```

Success with details:
```
✓ Database migration complete
  Applied 3 migrations
  Current version: 20240115_add_users
  Duration: 1.8s
```

Mixed results:
```
⚠ Build completed with warnings
  ✓ 12 modules compiled
  ⚠ 3 deprecation warnings
  ✗ 0 errors
  Duration: 8.4s
```

---

## Deploy Output

**When to use:** A multi-step build/deploy/release process where the user needs to see progress and the final result.

**Components used:** Spinner → StatusList, Message (success), KeyValue, Divider

**Structure:**

```
[StatusList: steps with live progress]

[Divider]

[Message: final result]
  [KeyValue: deployment details]
```

**Example (final state):**

```
✓ Build TypeScript (1.2s)
✓ Run tests — 42 passed (4.8s)
✓ Bundle for production (2.1s)
✓ Upload to CDN (3.4s)
✓ Update DNS (0.8s)

──────────────────────────────────

✓ Deployed to production

  URL        https://myapp.example.com
  Version    2.1.0
  Commit     a1b2c3d
  Duration   12.3s
```

---

## Test Report

**When to use:** Reporting test suite results.

**Components used:** Section, StatusList, Divider, Message (summary), StyledText

**Structure:**

```
[Section: Test Suite Name]
  [StatusList: individual tests with pass/fail]

[Divider]

[Summary line: counts]
[dim: timing]
```

**Example:**

```
Authentication
  ✓ should login with valid credentials (12ms)
  ✓ should reject invalid password (8ms)
  ✗ should handle expired tokens (45ms)
    Expected: 401 Unauthorized
    Received: 200 OK

API Endpoints
  ✓ GET /users returns user list (23ms)
  ✓ POST /users creates a user (31ms)
  ✓ DELETE /users/:id removes user (15ms)

────────────────────────────────

Tests:  5 passed, 1 failed, 6 total
Time:   0.134s
```

---

## Install Report

**When to use:** Package installation or dependency resolution.

**Components used:** Spinner → Message (success), Tree (optional), StyledText (dim)

**Structure:**

```
[Spinner → success: main outcome]
  [dim: detail counts]

[optional: Tree of added/removed packages]

[optional: warning messages]
```

**Example:**

```
✓ Installed 142 packages in 3.1s

  Added:    23
  Removed:  2
  Changed:  5
  Audited:  142 packages

⚠ 2 moderate vulnerabilities found
  Run `myapp audit fix` to resolve
```

---

## Task Runner

**When to use:** Executing a series of sequential or parallel tasks.

**Components used:** StatusList (live), Spinner, Indent, Message

**Structure:**

```
[StatusList with live updates]
  [Indent: sub-task output when relevant]
[Summary: counts]
```

**Example (sequential, in progress):**

```
✓ Clean build directory
✓ Compile TypeScript (1.2s)
⠋ Running tests...
◌ Lint source files
◌ Generate documentation
◌ Package for distribution
```

**Example (parallel, in progress):**

```
✓ Build API server (2.1s)
⠋ Build web client...
⠋ Build worker...
◌ Run integration tests
```

**Example (complete):**

```
✓ Clean build directory
✓ Compile TypeScript (1.2s)
✓ Run tests — 42 passed (4.8s)
✓ Lint source files (0.9s)
✗ Generate documentation
  Error: Missing JSDoc for exported function `processQueue`
○ Package for distribution (skipped)

5 of 6 tasks completed, 1 failed
```

---

## Config Display

**When to use:** Showing the current configuration state, resolved values, and their sources.

**Components used:** Section, KeyValue, StyledText (dim for source info)

**Structure:**

```
[Section: config group]
  [KeyValue: settings with values]
  [dim: source of each value]
```

**Example:**

```
Database
  Host       localhost         (from .env)
  Port       5432              (default)
  Name       myapp_dev         (from .env)
  SSL        false             (default)

Server
  Port       3000              (from --port flag)
  Workers    4                 (from CPU count)
  Log Level  debug             (from DEBUG env var)
```

---

## Help Screen

**When to use:** Displaying command help in response to `--help` or `help <command>`.

**Components used:** HelpLayout component (which composes Section, KeyValue, Columns, StyledText)

See the [HelpLayout component](05-components.md#helplayout) for the full specification.

**Example:**

```
Usage: myapp deploy [options] <target>

Deploy the application to the specified target environment.

Arguments:
  target            Deployment target (staging, production)

Options:
  -f, --force       Skip confirmation prompt
  -t, --tag <tag>   Deploy a specific version tag
      --dry-run     Show what would be deployed without deploying
  -v, --verbose     Show detailed output
  -h, --help        Show this help message

Examples:
  $ myapp deploy staging
  $ myapp deploy production --tag v2.1.0
  $ myapp deploy production --dry-run

See also: myapp rollback, myapp status
```

---

## Interactive Wizard

**When to use:** A multi-step setup or configuration flow using sequential prompts.

**Components used:** TextPrompt, SelectPrompt, MultiSelectPrompt, ConfirmPrompt, Message, Divider

**Structure:**

```
[Intro message]

[Prompt 1 → answer displayed]
[Prompt 2 → answer displayed]
[Prompt 3 → answer displayed]

[Divider]
[Summary of choices]
[Confirm prompt]
[Final message]
```

**Example (after completion):**

```
Let's set up your project.

✓ Project name: my-app
✓ Framework: Next.js
✓ Features: TypeScript, ESLint, Prettier
✓ Package manager: bun

──────────────────────────────────

Creating project with:
  Name        my-app
  Framework   Next.js
  Features    TypeScript, ESLint, Prettier
  Manager     bun

✓ Project created at ./my-app

  Next steps:
    cd my-app
    bun dev
```

---

## Init / Scaffold

**When to use:** Creating a new project or scaffolding files.

**Components used:** Spinner, StatusList, Tree, Message, Indent

**Structure:**

```
[Status steps for each scaffold action]
[Tree: files created]
[Success message]
[Hint: next steps]
```

**Example:**

```
✓ Created directory my-app
✓ Initialized git repository
✓ Generated project files
✓ Installed dependencies (142 packages)

my-app
├── src
│   └── index.ts
├── tests
│   └── index.test.ts
├── package.json
├── tsconfig.json
└── .gitignore

✓ Project ready

  Get started:
    cd my-app
    bun dev
```

---

## Changelog / Release Notes

**When to use:** Displaying a version changelog or release notes.

**Components used:** Section, List, StyledText, Badge

**Structure:**

```
[Section: version + date]
  [Subsection: change type]
    [List: changes]
```

**Example:**

```
v2.1.0 (2024-01-15)

  Features
    • Add dark mode support
    • New `deploy --preview` flag for preview deployments
    • Support for monorepo workspaces

  Fixes
    • Fix race condition in parallel builds
    • Correct exit code on partial failure

  Breaking Changes
    • Remove deprecated `--legacy` flag
    • Minimum Node.js version is now 18
```

---

## Audit Report

**When to use:** Reporting results of a security audit, code quality scan, or compliance check.

**Components used:** Table, Message, Section, StatusList, Badge, StyledText

**Structure:**

```
[Summary: counts by severity]
[Table: individual findings]
[Hint: remediation command]
```

**Example:**

```
Found 7 vulnerabilities in 142 packages

  Critical  1
  High      2
  Moderate  3
  Low       1

Package        Severity   Title                       Fix
────────────── ────────── ─────────────────────────── ──────────
lodash         Critical   Prototype Pollution         ≥4.17.21
express        High       Path Traversal              ≥4.19.0
axios          High       SSRF via URL parsing        ≥1.6.0
marked         Moderate   ReDoS in heading parser     ≥12.0.0
semver         Moderate   ReDoS vulnerability         ≥7.5.2
tar            Moderate   Arbitrary file overwrite    ≥6.2.1
debug          Low        Memory leak in long output  ≥4.3.5

Run `myapp audit fix` to auto-fix 5 of 7 vulnerabilities.
2 require manual review (semver, tar).
```

---

## Recipe Guidelines

### When to follow a recipe

Recipes are defaults, not mandates. Follow them when:

- You don't have a strong reason to deviate
- Your output should feel familiar to CLI users
- Consistency across the ecosystem matters

### When to deviate

Deviate when:

- Your domain has established conventions that differ (e.g., git's diff format)
- The recipe doesn't fit your data shape
- Rigid adherence would make the output worse

### Creating new recipes

If you find yourself composing the same component pattern across multiple commands, document it as a recipe. A recipe needs:

1. **A name** that describes the pattern, not the implementation
2. **A "when to use"** section
3. **The component list** — which components compose the recipe
4. **A structure** — the visual arrangement
5. **An example** — what it looks like in the terminal
6. **Anti-patterns** — what to avoid
