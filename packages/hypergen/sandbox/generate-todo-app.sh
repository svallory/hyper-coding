#!/usr/bin/env bash
#
# Generate a Multi-tenant Todo App with Hypergen + Next.js Kit
#
# This script demonstrates the ideal hypergen workflow:
#   1. Initialize a project
#   2. Install the Next.js kit
#   3. Scaffold the project with Drizzle + shadcn
#   4. Generate domain layer — entities, enums, value objects, repositories, services
#   5. Generate CRUD UI — pages, forms, server actions, data tables
#   6-7. Generate standalone pages (auth, dashboard)
#
# The `--ask=ai` flag delegates missing variable values to AI.
# The `@ai` tags inside templates trigger the 2-pass system for
# generating code blocks (schemas, queries, form fields, etc.)
#
# Together these mean: you describe WHAT you want, AI decides HOW.
#
# Usage:
#   ./sandbox/generate-todo-app.sh [output-dir]
#
# If output-dir is not specified, defaults to ./sandbox/todo-app

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HYPERGEN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
KIT_PATH="$HYPERGEN_ROOT/kits/nextjs"
OUTPUT_DIR="${1:-$SCRIPT_DIR/todo-app}"

# ─── Setup ────────────────────────────────────────────────────────────

echo "=== Hypergen: Multi-tenant Todo App ==="
echo ""
echo "  Kit:    $KIT_PATH"
echo "  Output: $OUTPUT_DIR"
echo ""

# Clean previous output
if [ -d "$OUTPUT_DIR" ]; then
  echo "Removing previous output..."
  rm -rf "$OUTPUT_DIR"
fi

mkdir -p "$OUTPUT_DIR"
cd "$OUTPUT_DIR"

# ─── Step 1: Initialize project ──────────────────────────────────────

echo "[1/8] Initializing project..."
hypergen init --force

# ─── Step 2: Install Next.js kit ─────────────────────────────────────

echo "[2/8] Installing Next.js kit..."
hypergen kit install "$KIT_PATH"

# ─── Step 3: Scaffold project + configure tools ──────────────────────
#
# The --description is saved to AGENTS.md and becomes project context
# that every subsequent AI call can see. This is how the AI knows
# what "organization" and "member" mean in this app.

echo "[3/8] Scaffolding project structure..."
hypergen nextjs project create \
  --orm=drizzle \
  --ui=shadcn \
  --description="A multi-tenant ToDo app where users belong to multiple organizations. \
Each organization has members with roles (admin, member, viewer) and its own set of todos. \
Todos can be assigned to members and have due dates."

hypergen nextjs config drizzle --database=sqlite
hypergen nextjs config shadcn --primitives=baseUI --theme=lyra --iconLibrary=lucide

# ─── Step 4: Generate domain layer ───────────────────────────────────
#
# Domain-first: generate schemas, types, and repositories before UI.
# With --ask=ai, the AI reads the project description and infers:
#   - Appropriate fields, types, and validation rules
#   - Drizzle/Prisma schema definitions
#   - Repository interfaces and implementations
#   - Business logic for domain services

echo "[4/8] Generating domain layer..."

# Entities — generates Zod schemas, Drizzle tables, TypeScript types,
# and repositories (--withRepository includes interface + Drizzle impl)
hypergen nextjs domain entity organization --withRepository --ask=ai
hypergen nextjs domain entity member --withRepository --ask=ai
hypergen nextjs domain entity todo --withRepository --ask=ai

# Enums — const object pattern with Zod schemas and helpers
hypergen nextjs domain enum UserRole --values=admin,member,viewer
hypergen nextjs domain enum TodoStatus --values=pending,in_progress,done,cancelled

# Value objects — branded types with validation
hypergen nextjs domain value-object Email
hypergen nextjs domain value-object Slug

# Services — business logic coordinating multiple repositories
hypergen nextjs domain service MembershipManagement --entities=organization,member --ask=ai

# ─── Step 5: Generate CRUD UI ─────────────────────────────────────────
#
# Now that the domain layer (schemas, types, repositories) exists,
# generate the UI. The CRUD recipes produce pages, forms, server
# actions, and data tables. With --ask=ai, the AI reads existing
# schemas and infers form fields, query logic, etc.
#
# `crud` (no sub-recipe) = the `resource` meta-recipe = all 4 pages.
# `crud list-page` / `crud create-page` etc. = individual pages.

echo "[5/8] Generating CRUD pages..."

# Full CRUD for todos — all 4 pages + server actions + form + table
hypergen nextjs crud Todo --ask=ai

# Organization — all pages at default paths
hypergen nextjs crud Organization --ask=ai

# Member — only list + create (no detail/edit needed for this app)
hypergen nextjs crud list-page Member --ask=ai
hypergen nextjs crud create-page Member --ask=ai

# ─── Step 6: Generate auth pages ─────────────────────────────────────
#
# Positional arg = route path relative to app/.

echo "[6/8] Generating auth pages..."

hypergen nextjs page add login
hypergen nextjs page add signup

# ─── Step 7: Generate dashboard ──────────────────────────────────────

echo "[7/8] Generating dashboard..."

hypergen nextjs page add dashboard

# ─── Step 8: Summary ─────────────────────────────────────────────────

echo "[8/8] Verifying generated structure..."
echo ""
echo "Domain layer:"
echo "  Entities: organization, member, todo"
echo "  Enums: UserRole, TodoStatus"
echo "  Value Objects: Email, Slug"
echo "  Repositories: organization, member, todo"
echo "  Services: MembershipManagement"
echo ""
echo "CRUD UI:"
echo "  Todo: list, detail, create, edit"
echo "  Organization: list, detail, create, edit"
echo "  Member: list, create"

# ─── Done ─────────────────────────────────────────────────────────────

echo ""
echo "=== Done! ==="
echo ""
echo "Generated files:"
find . -type f -not -path './node_modules/*' -not -path './.git/*' | sort
echo ""
echo "Project at: $OUTPUT_DIR"
