# Script A — Vanilla Claude Code (No Hyper Skill)

## Setup

```bash
cd demo/blog-vanilla
claude
```

## The Prompt

Paste this into the Claude Code session:

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

### Exploration Phase (this is where tokens burn)

Claude will need to:

1. **Read the project structure** — `ls`, `find`, glob for files
2. **Read `prisma/schema.prisma`** — understand the models and relationships
3. **Read existing Zod schemas** — `lib/schemas/author-schema.ts`, `post-schema.ts`, `comment-schema.ts`
4. **Explore `app/` directory** — understand routing patterns
5. **Check for existing components** — see what shadcn/ui components are installed
6. **Read `package.json`** — check installed dependencies
7. **Look for existing patterns** — server actions, forms, tables

This typically takes **20-40 tool calls** just to understand the codebase before writing a single line of code.

### Generation Phase

Then Claude will manually:

8. Create each server action file (3 models × 5 operations = 15 functions)
9. Create each page file (3 models × 4 pages = 12 pages)
10. Create form components (3 models)
11. Create table components (3 models)
12. Create delete dialogs (3 models)
13. Wire up relationships (foreign keys, includes, navigation)

### Common Mistakes to Watch For

- Inconsistent import paths across files
- Missing or incorrect foreign key handling in server actions
- Forgetting to include related data in queries (e.g., Post.findMany without `include: { author: true }`)
- Inconsistent form validation vs schema definitions
- Missing navigation links between related records
- Different patterns across the three models (e.g., using `fetch` for one and server actions for another)

## Narration Notes

**Key talking point:** "Notice how Claude spent the first N minutes and N tool calls just reading files to understand the project structure, the ORM schema, and the component patterns. It hasn't written a single line of code yet — all those tokens went to context gathering."

**After completion:** "Count the total tool calls and estimate tokens. In a real project with more models and deeper nesting, this scales linearly — every new model means another round of exploration."
