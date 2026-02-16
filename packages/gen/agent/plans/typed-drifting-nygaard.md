# Plan: Custom Markdown-Based Help System

## Context

The CLI uses `@oclif/plugin-help` which generates plain-text help from command metadata (static properties like `description`, `examples`, `flags`). We want to replace this with a system that:

1. Renders help from **markdown files** using `cli-html`'s `renderMarkdown()` — giving us rich terminal output (bold, code blocks, colored headings, links)
2. Stores one `.md` file per command — easy to customize, version-controlled, and human-readable
3. Falls back to default oclif help when no `.md` file exists — incremental adoption

## Architecture

```
hyper --help          → packages/cli/help/root.md
hyper config show -h  → packages/cli/help/config/show.md
hyper gen -h          → packages/gen/help/gen.md
hyper recipe list -h  → packages/gen/help/recipe/list.md
hyper kit install -h  → packages/kit/help/kit/install.md
```

Resolution: `command.pluginName` → `config.plugins.get(pluginName)` → `plugin.root` → `help/<command-id-as-path>.md`

## Step 1: Create the Custom Help Class

**File:** `packages/cli/src/help/custom-help.ts`

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Help, type Interfaces } from "@oclif/core";
import { renderMarkdown } from "@hypercli/core";

export default class MarkdownHelp extends Help {

  async showCommandHelp(command: Command.Loadable): Promise<void> {
    const md = this.loadMarkdown(command);
    if (md) {
      this.log(renderMarkdown(md));
      // Still show sub-topics/sub-commands below the markdown
      await this.showCommandSubInfo(command);
    } else {
      return super.showCommandHelp(command);
    }
  }

  protected async showRootHelp(): Promise<void> {
    const rootMd = this.loadRootMarkdown();
    if (rootMd) {
      this.log(renderMarkdown(rootMd));
      // Show available topics/commands after the markdown
      this.log(this.formatTopics(this.sortedTopics.filter(t => !t.name.includes(':'))));
      this.log(this.formatCommands(this.sortedCommands.filter(c => !c.id.includes(':'))));
    } else {
      return super.showRootHelp();
    }
  }

  protected async showTopicHelp(topic: Interfaces.Topic): Promise<void> {
    const md = this.loadTopicMarkdown(topic);
    if (md) {
      this.log(renderMarkdown(md));
      // Show sub-topics/sub-commands
      const depth = topic.name.split(':').length;
      const subTopics = this.sortedTopics.filter(
        t => t.name.startsWith(topic.name + ':') && t.name.split(':').length === depth + 1
      );
      const subCommands = this.sortedCommands.filter(
        c => c.id.startsWith(topic.name + ':') && c.id.split(':').length === depth + 1
      );
      if (subTopics.length > 0) this.log(this.formatTopics(subTopics));
      if (subCommands.length > 0) this.log(this.formatCommands(subCommands));
    } else {
      return super.showTopicHelp(topic);
    }
  }

  // --- Resolution helpers ---

  private loadMarkdown(command: Command.Loadable): string | null {
    const plugin = this.config.plugins.get(command.pluginName ?? '');
    const root = plugin?.root ?? this.config.root;
    // command.id uses ':' internally; convert to path segments
    const mdPath = join(root, 'help', ...command.id.split(':')) + '.md';
    return this.readIfExists(mdPath);
  }

  private loadRootMarkdown(): string | null {
    return this.readIfExists(join(this.config.root, 'help', 'root.md'));
  }

  private loadTopicMarkdown(topic: Interfaces.Topic): string | null {
    // Topics can span plugins — check CLI root first
    const cliPath = join(this.config.root, 'help', ...topic.name.split(':')) + '.md';
    if (existsSync(cliPath)) return readFileSync(cliPath, 'utf-8');

    // Check all plugins
    for (const plugin of this.config.plugins.values()) {
      const pluginPath = join(plugin.root, 'help', ...topic.name.split(':')) + '.md';
      if (existsSync(pluginPath)) return readFileSync(pluginPath, 'utf-8');
    }
    return null;
  }

  private readIfExists(path: string): string | null {
    return existsSync(path) ? readFileSync(path, 'utf-8') : null;
  }

  private async showCommandSubInfo(command: Command.Loadable): Promise<void> {
    const name = command.id;
    const depth = name.split(':').length;
    const subTopics = this.sortedTopics.filter(
      t => t.name.startsWith(name + ':') && t.name.split(':').length === depth + 1
    );
    const subCommands = this.sortedCommands.filter(
      c => c.id.startsWith(name + ':') && c.id.split(':').length === depth + 1
    );
    if (subTopics.length > 0) this.log(this.formatTopics(subTopics));
    if (subCommands.length > 0) this.log(this.formatCommands(subCommands));
  }
}
```

**Note:** oclif uses `:` internally for command IDs even when `topicSeparator` is ` `. The resolution converts `:` to path separators.

## Step 2: Register in CLI package.json

**File:** `packages/cli/package.json`

Add `helpClass` to oclif config:

```json
{
  "oclif": {
    "helpClass": "./dist/help/custom-help",
    ...existing...
  }
}
```

## Step 3: Update tsup configs to include help entry + copy markdown files

### CLI tsup.config.ts

Add the help entry point and an `onSuccess` hook to copy `.md` files:

```ts
entry: {
  index: "src/index.ts",
  "commands/config/show": "src/commands/config/show.ts",
  "help/custom-help": "src/help/custom-help.ts",   // ADD
},
onSuccess: async () => {
  // Copy help markdown files to dist/help/
  const { cpSync, existsSync } = await import("fs");
  if (existsSync("help")) {
    cpSync("help", "dist/../help", { recursive: true });
  }
}
```

Wait — actually since the help class reads from `plugin.root + '/help/'` (not `plugin.root + '/dist/help/'`), the `.md` files should live at the package root under `help/` and don't need copying. They're just read at runtime. The only thing that needs to be in `dist/` is the compiled help class.

So: **No copy needed.** The `.md` files stay in `help/` at package root. The `files` array in package.json should include `"help"` for npm publishing.

### Gen and Kit tsup configs

No changes needed to tsup — just add `"help"` to the `files` array in their package.json for publishing.

## Step 4: Update package.json `files` arrays

For each package that will have help docs:

**`packages/cli/package.json`:**
```json
"files": ["dist", "bin", "help", "README.md", "LICENSE"]
```

**`packages/gen/package.json`:**
```json
"files": ["dist", "help", "oclif.manifest.json", "README.md", "LICENSE"]
```

**`packages/kit/package.json`:**
```json
"files": ["dist", "help", "README.md", "LICENSE"]
```

## Step 5: Create initial help markdown files

### `packages/cli/help/root.md`

```markdown
# hyper

Modern, scalable code generator with AI integration.

## Usage

`hyper <command> [options]`

## Common Commands

| Command | Description |
|---------|-------------|
| `hyper gen <recipe>` | Execute a recipe to generate code |
| `hyper recipe list` | List available recipes |
| `hyper kit install` | Install a generator kit |
| `hyper config show` | Show resolved configuration |

Run `hyper <command> --help` for details on any command.
```

### `packages/cli/help/config/show.md`

```markdown
# hyper config show

Display the resolved Hypergen configuration in an interactive JSON viewer.

## Usage

`hyper config show [--json] [--cwd <dir>]`

## Flags

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON instead of interactive viewer |
| `--cwd <dir>` | Set working directory |

## Examples

```sh
# Open config in interactive fx viewer
hyper config show

# Pipe config as JSON
hyper config show --json

# Show config for a specific project
hyper config show --cwd ./my-project
```
```

### `packages/gen/help/gen.md` (sample)

Create a starter help file for the gen command — content mirrors the existing static description but in markdown format.

## Step 6: Update tsup entry for the help class

**File:** `packages/cli/tsup.config.ts`

```ts
entry: {
  index: "src/index.ts",
  "commands/config/show": "src/commands/config/show.ts",
  "help/custom-help": "src/help/custom-help.ts",
},
```

## Verification

1. **Build all packages:** `cd packages/core && bun run build && cd ../cli && bun run build`
2. **Test fallback:** Run `./packages/cli/bin/dev.js recipe list --help` — should show default oclif help (no .md file yet for recipe list)
3. **Test markdown help:** Run `./packages/cli/bin/dev.js --help` — should show rendered root.md
4. **Test command help:** Run `./packages/cli/bin/dev.js config show --help` — should show rendered config/show.md
5. **Run existing tests:** `cd packages/cli && bun run test` — no regressions

## Files Summary

**Create:**
- `packages/cli/src/help/custom-help.ts` — Custom oclif Help subclass
- `packages/cli/help/root.md` — Root help content
- `packages/cli/help/config/show.md` — Config show help
- `packages/gen/help/gen.md` — Gen command help (starter)

**Modify:**
- `packages/cli/package.json` — add `oclif.helpClass`, add `"help"` to `files`
- `packages/cli/tsup.config.ts` — add help class entry point
- `packages/gen/package.json` — add `"help"` to `files`
- `packages/kit/package.json` — add `"help"` to `files`
