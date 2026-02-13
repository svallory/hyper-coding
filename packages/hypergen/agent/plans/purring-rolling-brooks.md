# Plan: End-to-End Testing of Hypergen via generate-todo-app.sh

## Context

The `sandbox/generate-todo-app.sh` script demonstrates the full hypergen workflow for generating a multi-tenant todo app using the Next.js kit. We need to execute each command one at a time, verify what works vs what doesn't, and fix issues in real time.

## Two-Agent Coordination

### Agents

1. **User Agent** — Runs hypergen commands, states expectations before each run, compares expectation vs reality, reports errors in detail.

2. **Senior Dev Agent** — Diagnoses and fixes bugs in both hypergen core (`src/`) and the nextjs kit (`/work/hyperdev/packages/hyper-kits/nextjs/`).

### Protocol

Each round:
1. Launch **User Agent** with 1-3 commands
2. If errors → launch **Senior Dev Agent** with error context to fix
3. Re-launch **User Agent** to retry the failed command
4. Repeat until the command succeeds, then move to the next batch

### Model Policy — CRITICAL

**Subagents MUST use Haiku model by default.** Only use Sonnet when Haiku genuinely cannot handle the task.

| Task | Model |
|------|-------|
| Running commands, reporting output | **Haiku** |
| Simple file reads, directory listings | **Haiku** |
| Comparing expected vs actual | **Haiku** |
| Re-running commands to verify fixes | **Haiku** |
| Small targeted fixes (typos, missing imports, config) | **Haiku** |
| Complex multi-file bug diagnosis | **Sonnet** |
| Architectural changes across recipe engine layers | **Sonnet** |
| Tracing through template rendering pipeline | **Sonnet** |

**The User Agent is ALWAYS Haiku. The Senior Dev Agent starts as Haiku; escalate to Sonnet only when the bug is genuinely complex (multi-file, requires deep code understanding).**

## Setup

- Create clean sandbox dir: `sandbox/todo-app-test/`
- The kit is already "installed" via symlink at `kits/nextjs → ../../hyper-kits/nextjs`
- The user agent should consider the kit as pre-installed (it's a symlink to the real kit repo at `/work/hyperdev/packages/hyper-kits/nextjs/`)

## AI Configuration

After `hypergen init`, update `hypergen.config.js` to configure AI via command transport:

```js
export default {
  recipesDir: '_recipes',
  variables: {},
  trustedSources: ['@hyper-kits/*'],
  ai: {
    mode: 'command',
    command: 'klaude --model sonnet -p {prompt}',
    commandMode: 'batched',
  },
}
```

This uses the existing `CommandTransport` (`src/ai/transports/command-transport.ts`) which:
- Substitutes `{prompt}` in the command string (shell-escaped)
- In `batched` mode: sends all @ai blocks as one prompt, expects JSON response
- In `per-block` mode: one invocation per @ai block, raw text response

The `klaude` command (note the K) with `--model sonnet -p {prompt}` will be invoked for 2-pass AI resolution.

## Command Sequence

### Batch 1: Init + Kit Setup (Steps 1-2)
```bash
cd /work/hyperdev/packages/hypergen/sandbox/todo-app-test
bun run hypergen init --force
# Skip kit install — kit is already available via symlink
```
Note: We still need to verify the init'd project can discover the kit. The kit install copies to `.hyper/kits/` — since we're skipping that, we need the path resolver to find kits from the hypergen package's `kits/` directory OR we manually set up the `.hyper/kits/nextjs` symlink in the test project.

### Batch 2: Project Scaffold (Step 3)
```bash
bun run hypergen nextjs project create \
  --orm=drizzle --ui=shadcn \
  --description="A multi-tenant ToDo app where users belong to multiple organizations. Each organization has members with roles (admin, member, viewer) and its own set of todos. Todos can be assigned to members and have due dates."
bun run hypergen nextjs config drizzle --database=sqlite
bun run hypergen nextjs config shadcn --primitives=baseUI --theme=lyra --iconLibrary=lucide
```

### Batch 3: Domain Entities (Step 4a)
```bash
bun run hypergen nextjs domain entity organization --withRepository --ask=ai
bun run hypergen nextjs domain entity member --withRepository --ask=ai
bun run hypergen nextjs domain entity todo --withRepository --ask=ai
```
**2-pass flow**: These use `--ask=ai`. Pass 1 will output a prompt and exit with code 2. We capture the prompt, generate answers (or provide mock answers), then re-run with `--answers`.

### Batch 4: Domain Enums + Value Objects (Step 4b)
```bash
bun run hypergen nextjs domain enum UserRole --values=admin,member,viewer
bun run hypergen nextjs domain enum TodoStatus --values=pending,in_progress,done,cancelled
bun run hypergen nextjs domain value-object Email
bun run hypergen nextjs domain value-object Slug
```
These don't use `--ask=ai`, so they should render directly.

### Batch 5: Domain Service (Step 4c)
```bash
bun run hypergen nextjs domain service MembershipManagement --entities=organization,member --ask=ai
```

### Batch 6: CRUD UI (Step 5)
```bash
bun run hypergen nextjs crud Todo --ask=ai
bun run hypergen nextjs crud Organization --ask=ai
bun run hypergen nextjs crud list-page Member --ask=ai
bun run hypergen nextjs crud create-page Member --ask=ai
```

### Batch 7: Static Pages (Steps 6-7)
```bash
bun run hypergen nextjs page add login
bun run hypergen nextjs page add signup
bun run hypergen nextjs page add dashboard
```

## Handling the 2-Pass AI Flow

With `ai.mode: 'command'` and `ai.command: 'klaude --model sonnet -p {prompt}'` configured, the 2-pass flow works automatically:

1. Pass 1: Recipe engine renders templates, `AiCollector` gathers all `@ai` blocks
2. If AI blocks exist, the `CommandTransport` is invoked with the assembled prompt
3. `klaude` resolves the prompt and returns a JSON response with all keys
4. Pass 2: Recipe engine re-renders templates with the AI answers injected

The `--ask=ai` flag on the CLI tells the variable resolver to use AI for missing variables too.

If a recipe has NO `@ai` blocks, the CLI auto-re-runs in write mode (no AI call needed).

**Known gap in `run.ts` (lines 157-172)**: When Pass 1 collects @ai blocks, `run.ts` ALWAYS writes the prompt to stdout and exits with code 2. It does NOT check `resolveTransport()` to see if a `CommandTransport` or `ApiTransport` is configured. This needs to be fixed:

When `collector.collectMode && collector.hasEntries()`:
1. Resolve the transport via `resolveTransport(this.hypergenConfig?.ai)`
2. If transport is `stdout` → current behavior (write prompt, exit 2)
3. If transport is `command` or `api` → invoke the transport to resolve answers, then re-run with those answers (Pass 2)

This fix goes in `src/commands/run.ts` in the `executeSingleRecipe` method.

Note: The **variable resolution** path (`--ask=ai` for missing vars) already uses the transport system correctly (in `recipe-engine.ts` lines 996-1050). Only the @ai block resolution in `run.ts` is broken.

## Key Files

**Hypergen Core:**
- `src/commands/init.ts` — init command
- `src/commands/kit/install.ts` — kit install
- `src/commands/run.ts` — recipe execution + 2-pass AI flow
- `src/hooks/command-not-found.ts` — shorthand syntax
- `src/config/path-resolver.ts` — maps segments to recipes
- `src/config/kit-parser.ts` — kit discovery
- `src/recipe-engine/recipe-engine.ts` — core engine
- `src/recipe-engine/step-executor.ts` — step execution
- `src/recipe-engine/tools/template-tool.ts` — template processing
- `src/recipe-engine/tools/install-tool.ts` — package install
- `src/template-engines/jig-engine.ts` — Jig rendering
- `src/ai/ai-collector.ts` — AI block collection
- `src/ai/prompt-assembler.ts` — prompt assembly

**Next.js Kit (`/work/hyperdev/packages/hyper-kits/nextjs/`):**
- `kit.yml` — kit metadata and cookbook globs
- `cookbooks/project/create/recipe.yml` + `templates/`
- `cookbooks/config/{drizzle,shadcn,tanstack-query}/recipe.yml` + `templates/`
- `cookbooks/domain/{entity,enum,value-object,service,repository}/recipe.yml` + `templates/`
- `cookbooks/crud/{resource,list-page,create-page,detail-page,edit-page,delete}/recipe.yml` + `templates/`
- `cookbooks/page/add/recipe.yml` + `templates/`

## Verification

After all commands succeed:
1. List all generated files
2. Verify the tree matches the script's Step 8 summary:
   - Domain: organization, member, todo entities + enums + value objects + repos + service
   - CRUD: Todo (4 pages), Organization (4 pages), Member (2 pages)
   - Pages: login, signup, dashboard
3. Run full `bun test` once at the very end to catch regressions
