#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Script C — Hyper Direct: The stdout Pipeline
#
# Shows exactly what hyper sends to the AI when generating CRUD.
# This is the structured prompt document that replaces all the
# exploration and context gathering the AI would otherwise do.
# ============================================================================

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$DEMO_DIR/blog-base"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

divider() {
  echo ""
  echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

pause() {
  echo ""
  echo -e "${YELLOW}${BOLD}  Press Enter to continue...${NC}"
  read -r
}

# ---------------------------------------------------------------------------
# Check prerequisites
# ---------------------------------------------------------------------------
if [ ! -d "$PROJECT_DIR" ]; then
  echo -e "${RED}Error: blog-base/ not found. Run ./setup.sh first.${NC}"
  exit 1
fi

if ! command -v glow &>/dev/null; then
  echo -e "${YELLOW}Warning: glow not found. Will display raw markdown instead.${NC}"
  echo -e "${YELLOW}Install with: brew install glow${NC}"
  DISPLAY_CMD="cat"
else
  DISPLAY_CMD="glow -w 100"
fi

cd "$PROJECT_DIR"

# ============================================================================
# Introduction
# ============================================================================
clear
echo -e "${BOLD}${BLUE}"
cat << 'BANNER'

  ╦ ╦╦ ╦╔═╗╔═╗╦═╗  ╔═╗╔═╗╔╗╔
  ╠═╣╚╦╝╠═╝║╣ ╠╦╝  ║ ╦║╣ ║║║
  ╩ ╩ ╩ ╩  ╚═╝╩╚═  ╚═╝╚═╝╝╚╝

  The AI Prompt Pipeline
BANNER
echo -e "${NC}"
echo -e "  This demo shows ${BOLD}exactly what hyper sends to the AI${NC} when"
echo -e "  generating CRUD pages for a model."
echo ""
echo -e "  Instead of the AI spending tokens exploring your project,"
echo -e "  hyper ${BOLD}assembles all the context${NC} into a structured document:"
echo ""
echo -e "    ${CYAN}• Model fields and types${NC}"
echo -e "    ${CYAN}• ORM schema and relationships${NC}"
echo -e "    ${CYAN}• Component patterns and examples${NC}"
echo -e "    ${CYAN}• Expected output format${NC}"
echo ""
echo -e "  The AI gets ${BOLD}one focused prompt${NC} instead of making 20+ tool calls."

pause

# ============================================================================
# Demo 1: Show the prompt for Post CRUD
# ============================================================================
clear
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${GREEN}  Step 1: Generate the AI prompt for Post CRUD${NC}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Running:"
echo -e "  ${CYAN}hyper gen nextjs crud resource \\${NC}"
echo -e "  ${CYAN}  --name=post \\${NC}"
echo -e "  ${CYAN}  --fields=\"title:string,content:text,slug:string,published:boolean\" \\${NC}"
echo -e "  ${CYAN}  --ask=stdout${NC}"
echo ""
echo -e "  ${DIM}This runs Pass 1 of the template engine, collects all @ai blocks,${NC}"
echo -e "  ${DIM}and assembles them into a single structured prompt document.${NC}"

pause

divider

echo -e "${BOLD}  The AI receives this prompt:${NC}"
echo ""

# Capture the stdout prompt and display it
hyper gen nextjs crud resource \
  --name=post \
  --fields="title:string,content:text,slug:string,published:boolean" \
  --ask=stdout 2>/dev/null | $DISPLAY_CMD || true

pause

# ============================================================================
# Demo 2: Show what the AI would answer
# ============================================================================
clear
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${GREEN}  Step 2: What the AI answers${NC}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  The AI responds with a JSON object matching the requested keys."
echo -e "  For example:"
echo ""

cat << 'JSON_EXAMPLE' | $DISPLAY_CMD
```json
{
  "zodSchema": "z.object({\n  title: z.string().min(1, 'Title is required'),\n  content: z.string().min(1, 'Content is required'),\n  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase with hyphens'),\n  published: z.boolean().default(false)\n})",
  "formFields": "<FormField control={form.control} name=\"title\" render={({ field }) => (\n  <FormItem>\n    <FormLabel>Title</FormLabel>\n    <FormControl><Input placeholder=\"Enter title\" {...field} /></FormControl>\n    <FormMessage />\n  </FormItem>\n)} />\n..."
}
```

The AI only needed to generate the **code fragments** — hyper handles:
- File structure and routing
- Imports and exports
- Server action boilerplate
- Form wiring and validation setup
- Table column definitions
- Page layout and navigation
JSON_EXAMPLE

pause

# ============================================================================
# Demo 3: The follow-up commands
# ============================================================================
clear
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${GREEN}  Step 3: Complete the pipeline${NC}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  In a real pipeline, you'd chain three commands:"
echo ""
echo -e "  ${CYAN}# 1. Get the prompt from hyper${NC}"
echo -e "  ${BOLD}hyper gen nextjs crud resource --name=post --ask=stdout > prompt.md${NC}"
echo ""
echo -e "  ${CYAN}# 2. Feed it to any AI (Claude, GPT, local model)${NC}"
echo -e "  ${BOLD}claude -p < prompt.md > ai-answers.json${NC}"
echo ""
echo -e "  ${CYAN}# 3. Apply the answers to generate final code${NC}"
echo -e "  ${BOLD}hyper gen nextjs crud resource --name=post --answers=./ai-answers.json${NC}"
echo ""
divider
echo ""
echo -e "  ${BOLD}Or configure hyper to do it all in one step:${NC}"
echo ""
echo -e "  ${CYAN}# In kit.yml or hypergen.config.js:${NC}"
echo -e "  ${DIM}ai:${NC}"
echo -e "  ${DIM}  mode: command${NC}"
echo -e "  ${DIM}  command: \"claude -p {prompt}\"${NC}"
echo -e "  ${DIM}  commandMode: batched${NC}"
echo ""
echo -e "  ${CYAN}# Then just run:${NC}"
echo -e "  ${BOLD}hyper gen nextjs crud resource --name=post --ask=ai${NC}"
echo ""
echo -e "  ${DIM}Hyper handles the prompt assembly, AI call, and answer application.${NC}"

pause

# ============================================================================
# Demo 4: All three models
# ============================================================================
clear
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${GREEN}  Full pipeline: All three blog models${NC}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  To generate the full blog, three commands:"
echo ""
echo -e "  ${BOLD}hyper gen nextjs crud resource \\${NC}"
echo -e "  ${BOLD}  --name=author \\${NC}"
echo -e "  ${BOLD}  --fields=\"name:string,email:email,bio:text\" \\${NC}"
echo -e "  ${BOLD}  --ask=ai${NC}"
echo ""
echo -e "  ${BOLD}hyper gen nextjs crud resource \\${NC}"
echo -e "  ${BOLD}  --name=post \\${NC}"
echo -e "  ${BOLD}  --fields=\"title:string,content:text,slug:string,published:boolean\" \\${NC}"
echo -e "  ${BOLD}  --ask=ai${NC}"
echo ""
echo -e "  ${BOLD}hyper gen nextjs crud resource \\${NC}"
echo -e "  ${BOLD}  --name=comment \\${NC}"
echo -e "  ${BOLD}  --fields=\"body:text,authorName:string,approved:boolean\" \\${NC}"
echo -e "  ${BOLD}  --ask=ai${NC}"
echo ""
divider
echo ""
echo -e "  ${BOLD}What hyper provides to the AI for each model:${NC}"
echo ""
echo -e "    ${CYAN}• Model fields with types and validation rules${NC}"
echo -e "    ${CYAN}• ORM context (Prisma schema, relationships, foreign keys)${NC}"
echo -e "    ${CYAN}• Component library (shadcn/ui) with correct usage patterns${NC}"
echo -e "    ${CYAN}• Examples of expected output format${NC}"
echo -e "    ${CYAN}• Type hints (jsx-fragment, json, typescript)${NC}"
echo ""
echo -e "  ${BOLD}What the AI does NOT need to do:${NC}"
echo ""
echo -e "    ${RED}✗ Explore the file tree${NC}"
echo -e "    ${RED}✗ Read package.json for dependencies${NC}"
echo -e "    ${RED}✗ Parse the Prisma schema${NC}"
echo -e "    ${RED}✗ Figure out routing conventions${NC}"
echo -e "    ${RED}✗ Discover component patterns${NC}"
echo -e "    ${RED}✗ Determine import paths${NC}"
echo ""
echo -e "  ${GREEN}${BOLD}= Fewer tokens, faster generation, consistent output${NC}"
echo ""
