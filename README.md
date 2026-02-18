# HyperDev

A modern, scalable code generator with AI integration, built with TypeScript.

HyperDev generates code from **recipes** — YAML workflows that compose templates, actions, shell commands, and AI prompts into repeatable generation pipelines. Install community **kits** for your framework or write your own.

## Packages

```
@hypercli/cli  ──→  @hypercli/gen  ──→  @hypercli/kit  ──→  @hypercli/core
```

| Package | Description |
|---------|-------------|
| [`@hypercli/cli`](packages/cli/) | Thin oclif shell — provides the `hyper` binary |
| [`@hypercli/gen`](packages/gen/) | Recipe engine, Jig templates, AI 2-pass, actions |
| [`@hypercli/kit`](packages/kit/) | Kit installation, updates, and discovery |
| [`@hypercli/core`](packages/core/) | Shared types, config, errors, parsers, utils |

## Quick Start

```bash
# Install
bun install -g @hypercli/cli

# Install a kit
hyper kit install nextjs

# Run a recipe
hyper run nextjs/crud --entity User

# Or use the shorthand
hyper nextjs crud --entity User
```

## How It Works

1. **Kits** package generators for a specific framework (e.g. Next.js, Express)
2. **Recipes** define multi-step generation workflows in YAML
3. **Templates** use [Jig](https://github.com/jig-lang/jig) (an Edge.js fork) — not EJS
4. **AI integration** resolves `@ai` blocks via API calls, CLI commands, or stdout

### Recipe Example

```yaml
name: Create CRUD
variables:
  - name: entityName
    type: string
    prompt: Entity name?

steps:
  - tool: template
    template: model.ts.jig
    to: src/models/{{ entityName }}.ts

  - tool: install
    packages: [zod]

  - tool: shell
    command: bun run format
```

### Template Example

```
---
to: src/components/{{ pascalCase :: name }}.tsx
---
export const {{ pascalCase :: name }} = () => {
  return <div>{{ name }}</div>
}
```

## AI Modes

HyperDev supports a 2-pass AI system for generating code with LLMs. Configure in `hyper.config.js`:

| Mode | Description |
|------|-------------|
| `api` | Direct API calls via Vercel AI SDK (Anthropic, OpenAI, etc.) |
| `command` | Pipe prompts to a CLI command (e.g. `claude -p {prompt}`) |
| `stdout` | Print prompt to stdout for external AI agents |
| `auto` | Auto-detect based on available config (default) |

## Development

```bash
# Install dependencies
bun install

# Build all packages
moon run :build

# Run all tests
moon run :test

# Type-check all packages
moon run :typecheck

# Run everything
moon check --all
```

### Per-package

```bash
moon run core:test
moon run gen:build
moon run cli:typecheck
```

## Project Structure

```
hyperdev/
├── apps/docs/            # Mintlify documentation site
├── packages/
│   ├── cli/              # @hypercli/cli
│   ├── core/             # @hypercli/core
│   ├── gen/              # @hypercli/gen
│   └── kit/              # @hypercli/kit
├── hyper-kits/
│   └── nextjs/           # Next.js kit (git submodule)
└── .moon/                # Moon build system config
```

## Tech Stack

- **Runtime**: Node 20+ / Bun
- **Language**: TypeScript (ESM)
- **CLI Framework**: [oclif](https://oclif.io) with plugin architecture
- **Template Engine**: [Jig](https://github.com/jig-lang/jig) (Edge.js fork)
- **Build**: tsc
- **Test**: Vitest
- **Monorepo**: Bun workspaces + [Moon](https://moonrepo.dev)
- **Formatting**: Biome
- **AI SDK**: Vercel AI SDK

## License

MIT
