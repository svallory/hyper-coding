# Script B — Claude Code + Hyper Skill

## Setup

```bash
cd demo/blog-hyper
claude
```

## The Prompt

Paste the exact same prompt as Script A:

---

> Create full CRUD pages for all three models in this blog app: Author, Post, and Comment.
>
> For each model I need:
> - A list page with a data table (sortable, filterable, with pagination)
> - A detail page showing all fields and related records (e.g., Author detail shows their posts, Post detail shows its comments)
> - A create page with a validated form
> - An edit page that reuses the form
> - Server actions for all operations (list, get, create, update, delete)
> - Proper navigation between related records (link from post to its author, from comment to its post)
>
> Use the existing Prisma schema, Zod schemas, shadcn/ui components, and React Hook Form patterns already in the project. Make sure all the relationships work correctly — foreign keys, includes/joins in queries, and navigation links.

---

## What to Watch

### Skill Activation (immediate)

Claude recognizes this as a scaffolding task and triggers the `hyper-generate` skill. Instead of exploring, it:

1. **Runs `hyper recipe list`** — discovers available recipes (1 tool call)
2. **Runs `hyper recipe info nextjs crud resource`** — checks required variables (1 tool call)
3. **Generates Author CRUD:**
   ```bash
   hyper gen nextjs crud resource \
     --name=author \
     --fields="name:string,email:email,bio:text" \
     --pages=list,detail,create,edit \
     --includeDelete=true
   ```
4. **Generates Post CRUD:**
   ```bash
   hyper gen nextjs crud resource \
     --name=post \
     --fields="title:string,content:text,slug:string,published:boolean" \
     --pages=list,detail,create,edit \
     --includeDelete=true
   ```
5. **Generates Comment CRUD:**
   ```bash
   hyper gen nextjs crud resource \
     --name=comment \
     --fields="body:text,authorName:string,approved:boolean" \
     --pages=list,detail,create,edit \
     --includeDelete=true
   ```

### What Hyper Does Behind the Scenes

For each `crud resource` call, hyper:
- Reads the Prisma schema automatically (via kit helpers)
- Assembles context about the model, fields, relationships, and ORM
- Runs templates through Pass 1 to collect `@ai` blocks
- Builds a structured prompt document with:
  - Model context (fields, types, relationships)
  - Component patterns (shadcn/ui, React Hook Form)
  - Output format expectations (JSX fragments, Zod schemas)
  - Examples of correct output
- Sends the assembled prompt to the AI
- Takes the AI's answers and renders Pass 2 to produce final files

### The Difference

| Metric | Vanilla (Script A) | Hyper (Script B) |
|--------|-------------------|------------------|
| Tool calls to understand project | ~20-40 | ~2-3 |
| Context gathering tokens | Thousands | Near zero |
| Files manually created | ~30+ | 0 (all generated) |
| Pattern consistency | Variable | Guaranteed |
| Relationship handling | Manual + error-prone | Template-driven |

## Narration Notes

**Key talking point:** "Same prompt, same project. But this time Claude didn't need to spend tokens exploring the codebase. Hyper already knows the project structure, the ORM schema, and the component patterns. It assembled all that context into a focused prompt for the AI — no wasted exploration."

**Show the contrast:** "The vanilla session made N tool calls before writing any code. The hyper session made 5 total tool calls and generated everything."

**On quality:** "Every model gets the same patterns — same form structure, same table setup, same server action organization. In the vanilla session, Claude might use slightly different approaches for each model depending on what it remembered from its exploration."
