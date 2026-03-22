# HyperDev Demo — Token Savings Showcase

**Date:** 2026-02-19

## Goal

Demonstrate how HyperDev saves time and tokens by providing the AI with pre-assembled context, eliminating the need for exploratory file reads and pattern discovery.

## Demo Structure

Three scripts showing the same task approached three different ways:

| Script | Approach | Purpose |
|--------|----------|---------|
| A — Vanilla Claude Code | No hyper skill, raw AI | Baseline: shows token burn on exploration |
| B — Claude Code + Hyper | Has `hyper-generate` skill | Shows structured generation with minimal exploration |
| C — Hyper Direct (stdout) | `--ask=stdout` pipeline | Shows exactly what the AI receives from hyper |

## Domain: Blog Platform

### Models

- **Author**: name (string), email (email), bio (text)
- **Post**: title (string), content (text), slug (string), published (boolean) → belongsTo Author
- **Comment**: body (text), authorName (string), approved (boolean) → belongsTo Post

Three levels of nesting force the AI to understand cross-file dependencies (foreign keys, imports, navigation links between pages).

## Setup

A `setup.sh` script that:
1. Creates a fresh Next.js app via `hyper gen nextjs project create`
2. Configures Prisma as ORM
3. Generates the 3 domain entities with relationships
4. Duplicates into `blog-vanilla/` and `blog-hyper/`
5. Installs the hyper-gen skill only in `blog-hyper/`

## Script A — Vanilla Claude Code (`script-vanilla.md`)

Prompts to paste into a Claude Code session with NO hyper skill:
- "Create full CRUD pages for Author, Post, and Comment with proper relationships, forms, and data tables"
- Expected behavior: Claude explores project structure, reads schema files, discovers ORM, figures out component patterns, creates each file manually
- Many tool calls, lots of token burn on context gathering

## Script B — Claude Code + Hyper (`script-hyper.md`)

Prompts to paste into a Claude Code session WITH hyper-generate skill:
- Same request
- Expected behavior: Claude triggers skill, runs `hyper recipe list`, `hyper recipe info`, then `hyper gen nextjs crud resource` for each model
- Fewer tool calls, structured prompt assembly, consistent output

## Script C — Hyper Direct (`script-stdout.sh`)

Shell script showing the raw pipeline:
1. `hyper gen nextjs crud resource post --ask=stdout | glow` — display the structured prompt
2. Shows the follow-up `--answers` commands
3. Demonstrates what hyper assembles for the AI: context, field descriptions, examples, output format

## File Structure

```
demo/
├── README.md              # Overview and instructions
├── setup.sh               # Creates and prepares both project copies
├── script-vanilla.md      # Prompts + narration for vanilla session
├── script-hyper.md        # Prompts + narration for hyper session
└── script-stdout.sh       # Direct stdout pipeline demo
```
