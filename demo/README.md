# HyperDev Demo — Token Savings Showcase

This demo shows how HyperDev saves time and tokens by providing AI with pre-assembled context instead of forcing it to explore the project.

## What You'll See

Three approaches to the same task: **generate full CRUD for a blog with Author, Post, and Comment models**.

| Script | What | How to Run |
|--------|------|------------|
| **Script A** — Vanilla | Claude Code with no hyper skill | Paste prompts from `script-vanilla.md` |
| **Script B** — Hyper | Claude Code with hyper-generate skill | Paste prompts from `script-hyper.md` |
| **Script C** — stdout | Hyper's raw AI prompt pipeline | Run `./script-stdout.sh` |

## Prerequisites

- `bun` installed
- `hyper` CLI built and available (`bun run build` from repo root)
- `claude` CLI installed (for Scripts A and B)
- `glow` installed (for Script C pretty-printing)

## Quick Start

```bash
# 1. Run setup (creates both project copies)
cd demo
chmod +x setup.sh script-stdout.sh
./setup.sh

# 2. Open two terminals side-by-side

# Terminal 1 — Vanilla (no skill)
cd blog-vanilla
claude

# Terminal 2 — Hyper-enabled
cd blog-hyper
claude

# 3. Paste prompts from script-vanilla.md and script-hyper.md respectively

# 4. (Optional) Run the stdout pipeline demo
./script-stdout.sh
```

## Models

- **Author**: name, email, bio
- **Post**: title, content, slug, published → belongs to Author
- **Comment**: body, authorName, approved → belongs to Post

## What to Watch For

1. **Token burn**: The vanilla session will make 20-40+ tool calls just to understand the project before writing any code. The hyper session makes ~5.
2. **Context assembly**: Script C shows the structured prompt hyper builds — all the context the AI needs in one document.
3. **Consistency**: Hyper-generated code follows the same patterns across all three models. The vanilla session may use inconsistent approaches.
