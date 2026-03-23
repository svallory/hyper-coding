# Hyper CLI Help System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stellar, integrated help system where `hyper help`, `hyper help <topic>`, `hyper <topic> --help`, and `hyper <topic> help` all feel cohesive, navigable, and beautifully rendered — and scale to the much larger command surface coming.

**Architecture:** Distributed help ownership (each plugin owns its commands' help files) with CLI as the override layer for cross-plugin topics and root help. Markdown-based authoring rendered through `cli-html`. Topic metadata in `package.json` for oclif integration. `MarkdownHelp` class enhanced to render topics/commands lists as styled markdown tables.

**Tech Stack:** oclif (Help class), cli-html (rendering), @hypercli/ui/help (theme), Markdown (authoring format)

---

## Context

The `hyper` CLI has a markdown-based help system that's 80% built. The `MarkdownHelp` class in `packages/cli/src/help/custom-help.ts` already loads `.md` files from plugin `help/` directories, renders them via `cli-html`, and falls back to oclif defaults when no file exists. Three help files exist today (`root.md`, `config/show.md`, `gen.md`).

**What's missing:**
1. No help content for hq or kit commands (the `help/` directories don't even exist)
2. No topic descriptions anywhere — `hyper --help` shows topics with blank descriptions
3. The auto-appended topics/commands lists use oclif's plain-text formatting, visually clashing with the rendered markdown above
4. Cross-plugin topics (`recipe`, `cookbook`) have no unified help
5. `hyper <topic> help` pattern doesn't work (404s)

**What's already working:**
- `MarkdownHelp` correctly resolves help files per-plugin and falls back gracefully
- `renderHelp()` → `cli-html` pipeline with branded theme (blue/yellow/teal)
- `hyper gen --help`, `hyper config show --help`, `hyper --help` all render beautifully
- `hyper help <topic>` and `hyper <topic> --help` both route correctly to `showTopicHelp`

---

## File Structure

### Files to modify

| File | Change |
|------|--------|
| `packages/cli/src/help/custom-help.ts` | Override `formatTopics`/`formatCommands` for styled output |
| `packages/gen/src/hooks/command-not-found.ts` | Add `<topic>:help` → topic help rewrite before recipe logic |
| `packages/cli/package.json` | Add `oclif.topics` metadata |
| `packages/gen/package.json` | Add `oclif.topics` metadata |
| `packages/kit/package.json` | Add `oclif.topics` metadata |
| `packages/hq/package.json` | Add `oclif.topics` metadata |

### Files to create

**CLI (cross-plugin topics):**
- `packages/cli/help/recipe.md`
- `packages/cli/help/cookbook.md`

**HQ (1 topic + 8 commands):**
- `packages/hq/help/hq.md`
- `packages/hq/help/hq/start.md`
- `packages/hq/help/hq/stop.md`
- `packages/hq/help/hq/stop-all.md`
- `packages/hq/help/hq/attach.md`
- `packages/hq/help/hq/spawn.md`
- `packages/hq/help/hq/list.md`
- `packages/hq/help/hq/status.md`
- `packages/hq/help/hq/config.md`

**Kit (5 kit commands — recipe/cookbook commands are shadowed by gen, skip for now):**
- `packages/kit/help/kit.md`
- `packages/kit/help/kit/install.md`
- `packages/kit/help/kit/list.md`
- `packages/kit/help/kit/info.md`
- `packages/kit/help/kit/uninstall.md`
- `packages/kit/help/kit/update.md`

**Gen (4 remaining commands):**
- `packages/gen/help/recipe/run.md`
- `packages/gen/help/recipe/validate.md`
- `packages/gen/help/cookbook/info.md`
- `packages/gen/help/cookbook/list.md`

**Tests:**
- `packages/cli/tests/help/custom-help.test.ts`

---

## Task 1: Add topic metadata to package.json files

**Files:**
- Modify: `packages/cli/package.json` (oclif section)
- Modify: `packages/gen/package.json` (oclif section)
- Modify: `packages/kit/package.json` (oclif section)
- Modify: `packages/hq/package.json` (oclif section)

This is the foundation — oclif uses `topics` metadata to populate topic descriptions in help output. Without it, all topics show blank descriptions.

- [ ] **Step 1: Add topics to cli/package.json**

Add to the `oclif` object:
```json
"topics": {
  "config": { "description": "View and manage Hyper configuration" },
  "autocomplete": { "description": "Set up shell tab completion", "hidden": true }
}
```

- [ ] **Step 2: Add topics to gen/package.json**

Add to the `oclif` object:
```json
"topics": {
  "recipe": { "description": "Browse and run code generation recipes" },
  "cookbook": { "description": "Explore multi-step generation cookbooks" }
}
```

- [ ] **Step 3: Add topics to kit/package.json**

Add to the `oclif` object:
```json
"topics": {
  "kit": { "description": "Manage generator kits — install, update, and inspect" },
  "recipe": { "description": "Browse and run code generation recipes" },
  "cookbook": { "description": "Explore multi-step generation cookbooks" }
}
```

**Note:** Kit's `recipe` and `cookbook` topic descriptions will be silently ignored at runtime because gen loads first (plugin order in cli's package.json) and oclif uses first-loaded description. This is fine — gen's descriptions are identical. We declare them in kit too for correctness if kit is ever used standalone.

- [ ] **Step 4: Add topics to hq/package.json**

Add to the `oclif` object:
```json
"topics": {
  "hq": { "description": "Manage Claude Code sessions with the always-on HQ control center" }
}
```

- [ ] **Step 5: Rebuild manifests**

```bash
cd /work/hyper && bun run --filter '@hypercli/*' build
```

- [ ] **Step 6: Verify topics appear**

```bash
cd /work/hyper/packages/cli && ./bin/dev.js --help
```
Expected: topics now show descriptions instead of blank lines.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/package.json packages/gen/package.json packages/kit/package.json packages/hq/package.json
git add packages/*/oclif.manifest.json
git commit -m "feat(cli): add oclif topic descriptions to all plugin packages"
```

---

## Task 2: Style topics and commands lists in MarkdownHelp

**Files:**
- Modify: `packages/cli/src/help/custom-help.ts`
- Test: `packages/cli/tests/help/custom-help.test.ts`

Currently `showRootHelp` and `showTopicHelp` append oclif's plain-text `formatTopics`/`formatCommands` after rendered markdown. This creates a jarring visual break. Override both methods to produce markdown tables rendered through the same pipeline.

- [ ] **Step 1: Write failing tests**

Create `packages/cli/tests/help/custom-help.test.ts` with tests that verify:
- `formatTopics` returns a string containing a "Topics" header and topic names
- `formatCommands` returns a string containing a "Commands" header and command names
- Hidden topics/commands are excluded
- Empty input returns empty string

The tests should instantiate `MarkdownHelp` using oclif's test helpers or mock the config.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /work/hyper/packages/cli && bun test tests/help/custom-help.test.ts
```

- [ ] **Step 3: Override formatTopics**

In `custom-help.ts`, add:

```typescript
protected override formatTopics(topics: Interfaces.Topic[]): string {
  const visible = topics.filter((t) => !t.hidden);
  if (visible.length === 0) return "";
  const rows = visible
    .map((t) => {
      const name = t.name.replaceAll(":", " ");
      return `| \`${name}\` | ${t.description ?? ""} |`;
    })
    .join("\n");
  return renderHelp(
    `## Topics\n\n| Topic | Description |\n|-------|-------------|\n${rows}`
  );
}
```

- [ ] **Step 4: Override formatCommands**

```typescript
protected override formatCommands(commands: Command.Loadable[]): string {
  const visible = commands.filter((c) => !c.hidden);
  if (visible.length === 0) return "";
  const rows = visible
    .map((c) => {
      const name = c.id.replaceAll(":", " ");
      const desc = this.summary(c);
      return `| \`${name}\` | ${desc} |`;
    })
    .join("\n");
  return renderHelp(
    `## Commands\n\n| Command | Description |\n|---------|-------------|\n${rows}`
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /work/hyper/packages/cli && bun test tests/help/custom-help.test.ts
```

- [ ] **Step 6: Manual verification**

```bash
cd /work/hyper/packages/cli && ./bin/dev.js --help
```
Expected: topics and commands sections are now styled tables matching the markdown header above.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/help/custom-help.ts packages/cli/tests/help/custom-help.test.ts
git commit -m "feat(cli): style help topics and commands as markdown tables"
```

---

## Task 3: Support `hyper <topic> help` navigation pattern

**Files:**
- Modify: `packages/gen/src/hooks/command-not-found.ts`
- Test: `packages/gen/tests/hooks/command-not-found.test.ts` (add test case)

When a user types `hyper hq help`, oclif assembles `hq:help` as the command ID (because `topicSeparator: " "`). This doesn't match any command, so it fires the `command_not_found` hook — which is gen's recipe rewrite hook. The fix is to add an early check in that hook: if the command ID ends with `:help` and the prefix is a known topic, show topic help instead of trying to run it as a recipe.

**Why not a `showHelp` override?** `showHelp` is never called for `hyper hq help` — oclif's argv parser collapses `["hq", "help"]` into command ID `"hq:help"` before help is involved. The `command_not_found` hook is the correct interception point.

- [ ] **Step 1: Read gen's command-not-found hook**

Read `packages/gen/src/hooks/command-not-found.ts` to understand the current structure and find the right insertion point.

- [ ] **Step 2: Write failing test**

Add a test case in gen's hook tests that verifies: when the hook receives `id: "hq:help"` and `hq` is a known topic, it calls `showTopicHelp` instead of attempting recipe resolution.

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /work/hyper/packages/gen && bun test tests/hooks/command-not-found
```

- [ ] **Step 4: Add topic-help intercept to the hook**

Add this early in the hook, before the recipe rewrite logic:

```typescript
// Intercept "<topic>:help" pattern → show topic help
if (commandId.endsWith(":help")) {
  const topicName = commandId.slice(0, -5);
  const topic = opts.config.findTopic(topicName);
  if (topic) {
    const { loadHelpClass } = await import("@oclif/core");
    const Help = await loadHelpClass(opts.config);
    const help = new Help(opts.config, { all: false });
    await help.showTopicHelp(topic);
    return;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /work/hyper/packages/gen && bun test tests/hooks/command-not-found
```

- [ ] **Step 6: Manual verification**

```bash
cd /work/hyper/packages/cli && ./bin/dev.js hq help
cd /work/hyper/packages/cli && ./bin/dev.js kit help
cd /work/hyper/packages/cli && ./bin/dev.js recipe help
```
Expected: all show the same topic help as `hyper help <topic>`.

- [ ] **Step 7: Commit**

```bash
git add packages/gen/src/hooks/command-not-found.ts packages/gen/tests/hooks/
git commit -m "feat(gen): intercept '<topic> help' in command_not_found hook"
```

---

## Task 4: Create help content for HQ plugin

**Files:**
- Create: `packages/hq/help/hq.md` + 8 command files in `packages/hq/help/hq/`

**Reference:** Read each command's source in `packages/hq/src/commands/hq/` to extract descriptions, flags, args, and examples. Follow the patterns established in `packages/cli/help/config/show.md` and `packages/gen/help/gen.md`.

- [ ] **Step 1: Create `packages/hq/help/hq.md` (topic overview)**

```markdown
# hyper hq

Manage Claude Code sessions with the always-on HQ control center. Start persistent tmux-backed sessions, spawn project workers, and monitor everything from one place.

## Usage

`hyper hq <command>`

## Quick Start

```sh
# Start the HQ control session
hyper hq start

# Spawn a Claude session for your project
hyper hq spawn my-project

# See what's running
hyper hq status
```

Run `hyper hq <command> --help` for details on any command.
```

- [ ] **Step 2: Create command help files**

Create one `.md` file per command in `packages/hq/help/hq/`. Each must include: heading, description, usage, flags/args table, examples. Read the command source files to get accurate flag/arg details.

Files: `start.md`, `stop.md`, `stop-all.md`, `attach.md`, `spawn.md`, `list.md`, `status.md`, `config.md`

- [ ] **Step 3: Verify help renders**

```bash
cd /work/hyper/packages/cli && ./bin/dev.js help hq
cd /work/hyper/packages/cli && ./bin/dev.js hq start --help
```

- [ ] **Step 4: Commit**

```bash
git add packages/hq/help/
git commit -m "docs(hq): add markdown help for all hq commands"
```

---

## Task 5: Create help content for Kit plugin

**Files:**
- Create: `packages/kit/help/kit.md` + 5 command files in `packages/kit/help/kit/`

**Reference:** Read each command's source in `packages/kit/src/commands/kit/` for flags, args, examples.

**Note:** Skip `recipe/` and `cookbook/` help files in the kit package — those commands are shadowed by gen's versions due to plugin ordering. Cross-plugin topic help for `recipe` and `cookbook` is handled in Task 7.

- [ ] **Step 1: Create `packages/kit/help/kit.md` (topic overview)**

- [ ] **Step 2: Create command help files**

Files: `install.md`, `list.md`, `info.md`, `uninstall.md`, `update.md`

- [ ] **Step 3: Verify help renders**

```bash
cd /work/hyper/packages/cli && ./bin/dev.js help kit
cd /work/hyper/packages/cli && ./bin/dev.js kit install --help
```

- [ ] **Step 4: Commit**

```bash
git add packages/kit/help/
git commit -m "docs(kit): add markdown help for all kit commands"
```

---

## Task 6: Create help content for Gen's remaining commands

**Files:**
- Create: `packages/gen/help/recipe/run.md`
- Create: `packages/gen/help/recipe/validate.md`
- Create: `packages/gen/help/cookbook/info.md`
- Create: `packages/gen/help/cookbook/list.md`

**Reference:** Read command sources in `packages/gen/src/commands/recipe/` and `packages/gen/dist/commands/cookbook/` (cookbook commands only exist in dist — source may have been deleted, so check dist for flag/arg info).

**Note:** Gen wins the plugin ordering for `cookbook:info` and `cookbook:list`, so these help files are what users will actually see.

- [ ] **Step 1: Create recipe command help files**

`recipe/run.md` and `recipe/validate.md`

- [ ] **Step 2: Create cookbook command help files**

`cookbook/info.md` and `cookbook/list.md`

- [ ] **Step 3: Verify**

```bash
cd /work/hyper/packages/cli && ./bin/dev.js recipe run --help
cd /work/hyper/packages/cli && ./bin/dev.js recipe validate --help
cd /work/hyper/packages/cli && ./bin/dev.js cookbook info --help
cd /work/hyper/packages/cli && ./bin/dev.js cookbook list --help
```

- [ ] **Step 4: Commit**

```bash
git add packages/gen/help/
git commit -m "docs(gen): add markdown help for recipe and cookbook commands"
```

---

## Task 7: Create cross-plugin topic help files

**Files:**
- Create: `packages/cli/help/recipe.md`
- Create: `packages/cli/help/cookbook.md`

These live in the CLI package because `loadTopicMarkdown` checks CLI root first, making them the canonical topic overview regardless of which plugin's commands are loaded.

- [ ] **Step 1: Create `packages/cli/help/recipe.md`**

Should describe the unified recipe concept spanning discovery (list, info) and execution (run, validate). Mention the kit shorthand syntax (`hyper nextjs crud` → `hyper gen nextjs/crud`).

- [ ] **Step 2: Create `packages/cli/help/cookbook.md`**

Should describe cookbooks as multi-step generation workflows.

- [ ] **Step 3: Verify**

```bash
cd /work/hyper/packages/cli && ./bin/dev.js help recipe
cd /work/hyper/packages/cli && ./bin/dev.js recipe --help
```
Expected: renders the markdown topic overview + appends styled subcommands list.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/help/recipe.md packages/cli/help/cookbook.md
git commit -m "docs(cli): add cross-plugin topic help for recipe and cookbook"
```

---

## Task 8: Update root.md for the growing command surface

**Files:**
- Modify: `packages/cli/help/root.md`

The current `root.md` lists only 4 commands. Update it to reflect the actual current surface and hint at the progressive disclosure tiers.

- [ ] **Step 1: Rewrite root.md**

Structure as:
- One-liner description
- Usage
- Getting Started section (init, gen, kit install)
- Generation section (gen, recipe, cookbook)
- Session Management section (hq)
- Configuration section (config)
- "Run `hyper help <topic>` for more on any topic" footer

- [ ] **Step 2: Verify**

```bash
cd /work/hyper/packages/cli && ./bin/dev.js --help
```

- [ ] **Step 3: Commit**

```bash
git add packages/cli/help/root.md
git commit -m "docs(cli): update root help to reflect current command surface"
```

---

## Verification

After all tasks are complete:

```bash
# Full build
cd /work/hyper && bun run --filter '@hypercli/*' build

# Test suite
cd /work/hyper/packages/cli && bun test

# Manual navigation test — all these should render beautifully:
./bin/dev.js --help                    # root help with styled topics/commands
./bin/dev.js help                      # same
./bin/dev.js help hq                   # hq topic with subcommands
./bin/dev.js hq --help                 # same as above
./bin/dev.js hq help                   # same (new pattern)
./bin/dev.js hq start --help           # hq start command help
./bin/dev.js help kit                  # kit topic
./bin/dev.js kit install --help        # kit install command
./bin/dev.js help recipe               # cross-plugin recipe topic
./bin/dev.js recipe --help             # same
./bin/dev.js recipe run --help         # recipe run command
./bin/dev.js help gen                  # gen command help
./bin/dev.js gen --help                # same

# Verify no fallback to plain oclif for any documented command
# (all should show branded markdown rendering)
```

---

## Design Decisions

**Distributed ownership over centralization:** Each plugin owns its help files. CLI only overrides for cross-plugin topics and root. This means help ships with the plugin and scales as plugins are added.

**Topic metadata in package.json:** Uses oclif's built-in `topics` config rather than custom metadata files. Zero new infrastructure — just JSON.

**`<topic> help` via command_not_found hook:** `hyper hq help` gets parsed as command `hq:help` by oclif's space-separator logic, so `showHelp` is never called. The `command_not_found` hook in gen is the correct interception point. We add a small guard at the top of gen's existing hook to detect the `:help` suffix and redirect to topic help.

**Skip kit's shadowed recipe/cookbook commands:** Gen wins the collision. Writing help for kit's versions would be dead content. The command collision should be resolved separately (out of scope).

**Markdown tables for topics/commands lists:** Consistent visual language end-to-end. Leverages existing `renderHelp` → `cli-html` pipeline. No new dependencies.
