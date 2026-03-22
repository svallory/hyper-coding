#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# HyperDev Demo Setup
# Creates two identical Next.js blog projects:
#   blog-vanilla/  — no hyper skill (baseline)
#   blog-hyper/    — has hyper-generate skill installed
# ============================================================================

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
HYPER_ROOT="$(cd "$DEMO_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

step() { echo -e "\n${BLUE}${BOLD}▶ $1${NC}"; }
success() { echo -e "${GREEN}✓ $1${NC}"; }
info() { echo -e "${CYAN}  $1${NC}"; }

# ---------------------------------------------------------------------------
# Cleanup previous runs
# ---------------------------------------------------------------------------
step "Cleaning up previous demo projects..."
rm -rf "$DEMO_DIR/blog-base" "$DEMO_DIR/blog-vanilla" "$DEMO_DIR/blog-hyper"
success "Clean slate"

# ---------------------------------------------------------------------------
# Step 1: Create base Next.js project
# ---------------------------------------------------------------------------
step "Creating base Next.js project..."
cd "$DEMO_DIR"

# Use hyper to scaffold the project
hyper gen nextjs project create \
  --name=blog-base \
  --description="A blog platform with authors, posts, and comments" \
  --useSrcDir=false \
  --linter=biome

success "Base project created at blog-base/"

# ---------------------------------------------------------------------------
# Step 2: Configure Prisma
# ---------------------------------------------------------------------------
step "Setting up Prisma..."
cd "$DEMO_DIR/blog-base"

hyper gen nextjs config prisma \
  --database=postgresql \
  --databaseUrl="postgresql://user:password@localhost:5432/blog"

success "Prisma configured"

# ---------------------------------------------------------------------------
# Step 3: Generate domain entities with relationships
# ---------------------------------------------------------------------------
step "Generating Author entity..."
hyper gen nextjs domain entity \
  --name=author \
  --fields="name:string,email:email,bio:text" \
  --relations="hasMany:posts"

step "Generating Post entity..."
hyper gen nextjs domain entity \
  --name=post \
  --fields="title:string,content:text,slug:string,published:boolean" \
  --relations="belongsTo:author,hasMany:comments"

step "Generating Comment entity..."
hyper gen nextjs domain entity \
  --name=comment \
  --fields="body:text,authorName:string,approved:boolean" \
  --relations="belongsTo:post"

success "All 3 entities generated with relationships"

# ---------------------------------------------------------------------------
# Step 4: Install dependencies
# ---------------------------------------------------------------------------
step "Installing dependencies..."
bun install
success "Dependencies installed"

# ---------------------------------------------------------------------------
# Step 5: Duplicate into vanilla and hyper copies
# ---------------------------------------------------------------------------
step "Creating vanilla copy (no hyper skill)..."
cd "$DEMO_DIR"
cp -r blog-base blog-vanilla
success "blog-vanilla/ ready"

step "Creating hyper copy (with skill)..."
cp -r blog-base blog-hyper
success "blog-hyper/ ready"

# ---------------------------------------------------------------------------
# Step 6: Install hyper-generate skill in the hyper copy only
# ---------------------------------------------------------------------------
step "Installing hyper-generate skill in blog-hyper/..."
cd "$DEMO_DIR/blog-hyper"

# Create the .claude/skills directory and install the skill
mkdir -p .claude/skills
hyper gen skills hyper-gen install 2>/dev/null || {
  # Fallback: manually create the skill file if the recipe isn't available
  mkdir -p .claude/skills/hyper-gen
  cat > .claude/skills/hyper-gen/SKILL.md << 'SKILL_EOF'
---
name: hyper-generate
description: Use when asked to create, scaffold, or add files for which a Hypergen recipe may exist - components, pages, API routes, CRUD, forms, tables, domain entities, project setup, npm packages, middleware, layouts, error boundaries, loading UI, server actions, or config setup
---

# Hyper Generate

## When to Use
Trigger on requests to create/add/scaffold:
- React components, Next.js pages, layouts, loading/error UI
- API routes, webhooks, GraphQL endpoints
- Server actions, forms, data tables
- CRUD workflows (list, detail, create, edit, delete)
- Domain entities, value objects, repositories, services
- Project configuration (ORM, UI library, auth)

## Core Pattern

1. Discover available recipes: `hyper recipe list`
2. Identify which recipe matches the request
3. Check variables: `hyper recipe info [kit] [cookbook] <recipe>`
4. Run the recipe with appropriate variables
5. Review and customize the generated output if needed

## Common Commands

```bash
# List all available recipes
hyper recipe list

# Get recipe details and required variables
hyper recipe info nextjs crud resource

# Generate CRUD for a model
hyper gen nextjs crud resource --name=post --fields="title:string,content:text,published:boolean"

# Generate with AI assistance (structured prompt to stdout)
hyper gen nextjs crud resource --name=post --ask=stdout

# Generate with AI answers file
hyper gen nextjs crud resource --name=post --answers=./ai-answers.json
```

## Key Recipes

| Recipe | What it generates |
|--------|-------------------|
| `nextjs crud resource` | Full CRUD: list, detail, create, edit pages + server actions |
| `nextjs domain entity` | Zod schema + ORM schema (Prisma/Drizzle) |
| `nextjs form rhf` | React Hook Form + Zod validation |
| `nextjs table crud` | TanStack Table with CRUD actions |
| `nextjs component add` | React component scaffold |
| `nextjs page add` | App Router page |
| `nextjs action validated` | Server Action with Zod validation |

## Important Notes

- `crud resource` is a **meta-recipe** that calls list-page, detail-page, create-page, edit-page
- Always check `hyper recipe info` for required variables before running
- The `--fields` format is: `fieldName:type` comma-separated (e.g., `title:string,published:boolean`)
- The `--relations` format is: `relationType:modelName` comma-separated (e.g., `belongsTo:author,hasMany:comments`)
- Use `--ask=stdout` to see what context hyper assembles for the AI
SKILL_EOF
  success "Skill file created manually"
}

success "hyper-generate skill installed in blog-hyper/"

# ---------------------------------------------------------------------------
# Step 7: Create CLAUDE.md in both projects
# ---------------------------------------------------------------------------
step "Creating CLAUDE.md files..."

# Vanilla gets a minimal CLAUDE.md (realistic — most projects have one)
cat > "$DEMO_DIR/blog-vanilla/CLAUDE.md" << 'EOF'
# Blog Platform

A Next.js blog with authors, posts, and comments.

## Tech Stack
- Next.js 15 (App Router)
- Prisma ORM
- PostgreSQL
- TypeScript
- shadcn/ui + Tailwind CSS
- React Hook Form + Zod

## Commands
- `bun install` — install dependencies
- `bun run dev` — start dev server
- `bun run build` — production build
EOF

# Hyper copy gets the same CLAUDE.md plus hyper info
cat > "$DEMO_DIR/blog-hyper/CLAUDE.md" << 'EOF'
# Blog Platform

A Next.js blog with authors, posts, and comments.

## Tech Stack
- Next.js 15 (App Router)
- Prisma ORM
- PostgreSQL
- TypeScript
- shadcn/ui + Tailwind CSS
- React Hook Form + Zod

## Commands
- `bun install` — install dependencies
- `bun run dev` — start dev server
- `bun run build` — production build

## Code Generation
This project uses HyperDev for code generation. Use the `hyper-generate` skill when scaffolding new code.
EOF

success "CLAUDE.md files created"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD}  Demo setup complete!${NC}"
echo -e "${GREEN}${BOLD}============================================${NC}"
echo ""
echo -e "  ${BOLD}blog-vanilla/${NC} — No hyper skill (baseline)"
echo -e "  ${BOLD}blog-hyper/${NC}   — Has hyper-generate skill"
echo ""
echo -e "  Next steps:"
echo -e "  1. Open two terminals side-by-side"
echo -e "  2. Terminal 1: ${CYAN}cd $DEMO_DIR/blog-vanilla && claude${NC}"
echo -e "  3. Terminal 2: ${CYAN}cd $DEMO_DIR/blog-hyper && claude${NC}"
echo -e "  4. Follow the scripts in ${CYAN}script-vanilla.md${NC} and ${CYAN}script-hyper.md${NC}"
echo ""
echo -e "  Or run the stdout pipeline demo:"
echo -e "  ${CYAN}./script-stdout.sh${NC}"
echo ""
