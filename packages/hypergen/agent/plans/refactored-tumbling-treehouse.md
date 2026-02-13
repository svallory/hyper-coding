# Plan: Domain Cookbook for Next.js Kit

## Context

The Next.js kit needs a `domain` cookbook for DDD-style domain layer generation, independent from the `crud` cookbook (which handles UI). This enables workflows like:

```bash
hypergen nextjs domain entity Organization --ask=ai
hypergen nextjs domain enum UserRole --ask=ai
hypergen nextjs domain value-object Email
hypergen nextjs domain repository user --ask=ai
hypergen nextjs domain service UserManagement --ask=ai
```

And the sandbox flow becomes: **domain** (schemas/types/repositories) → **crud** (UI pages/actions).

A `create` orchestrator recipe was considered but dropped — the recipe engine lacks iteration primitives (`forEach`), making it impossible to fan out a single AI-designed domain into N sub-recipe calls without hacky shell loops or engine scope creep. Individual recipes work well with `--ask=ai` independently.

## Existing Patterns (discovered via exploration)

- **cookbook.yml**: `name`, `description`, `version`, `defaults.recipe`, `recipes: ["./*/recipe.yml"]`
- **recipe.yml**: `name`, `description`, `version`, `variables`, `steps`
- **Templates**: `.jig` files with YAML frontmatter (`to:`, `inject:`, `when:`)
- **ORM detection**: `detectProjectFeatures()` → `{ orm: 'prisma' | 'drizzle' | 'none' }` (from `kits/nextjs/helpers/detect-project.ts`)
- **@ai tags**: `@ai({ key })` → `@context()` → `@prompt()` → `@output()` → `@example()` → `@end`
- **Drizzle schemas**: `db/schema/<name>.ts`, index at `db/schema/index.ts`
- **Prisma schemas**: `prisma/schema.prisma` (inject mode)
- **Zod schemas**: `lib/schemas/<name>-schema.ts`
- **Shared partials**: `kits/nextjs/shared/partials/{zod-schema,types}.jig`
- **Helpers**: `parseFieldsString()`, `buildFieldDescriptions()`, `pluralize()`, `pascalCase()`, etc. from `kits/nextjs/helpers/`

## Directory Structure

```
kits/nextjs/cookbooks/domain/
├── cookbook.yml
├── entity/
│   ├── recipe.yml
│   └── templates/
│       ├── drizzle-schema.ts.jig      → db/schema/<name>.ts
│       ├── prisma-schema.prisma.jig   → prisma/schema.prisma (inject)
│       ├── zod-schema.ts.jig          → lib/schemas/<name>-schema.ts
│       └── schema-index.ts.jig        → db/schema/index.ts (inject)
├── value-object/
│   ├── recipe.yml
│   └── templates/
│       └── value-object.ts.jig        → lib/domain/value-objects/<Name>.ts
├── enum/
│   ├── recipe.yml
│   └── templates/
│       └── enum.ts.jig                → lib/domain/enums/<Name>.ts
├── repository/
│   ├── recipe.yml
│   └── templates/
│       ├── repository-interface.ts.jig → lib/domain/repositories/<name>-repository.ts
│       ├── drizzle-repository.ts.jig   → lib/infrastructure/repositories/<name>-repository.impl.ts
│       └── prisma-repository.ts.jig    → lib/infrastructure/repositories/<name>-repository.impl.ts
└── service/
    ├── recipe.yml
    └── templates/
        └── service.ts.jig             → lib/domain/services/<Name>Service.ts
```

---

## 1. cookbook.yml

```yaml
name: domain
description: |
  Generate DDD-style domain layer components for Next.js applications.
  Supports Drizzle and Prisma ORMs. Generates entities, value objects,
  enums, repositories, and domain services.
version: 1.0.0
defaults:
  recipe: entity
recipes:
  - './*/recipe.yml'
```

---

## 2. Entity Recipe

**`domain/entity/recipe.yml`**

Variables:
- `name` — string, required, position: 0, camelCase entity name
- `fields` — string, optional (AI infers when missing)
- `relations` — string, optional

Steps:
1. `shell` — `mkdir -p db/schema lib/schemas`
2. `template` — `zod-schema.ts.jig` (always)
3. `template` — `drizzle-schema.ts.jig` (when orm === 'drizzle')
4. `template` — `prisma-schema.prisma.jig` (when orm === 'prisma')
5. `template` — `schema-index.ts.jig` (when orm === 'drizzle', inject export)
6. `shell` — success message

**Templates:**

`zod-schema.ts.jig` → `lib/schemas/{{ name }}-schema.ts`
- Uses `@ai({ key: 'zodSchema' })` to generate z.object() definition
- Exports: `<name>Schema`, `create<Name>Schema` (.omit id/timestamps), `update<Name>Schema` (.partial), plus `z.infer` types

`drizzle-schema.ts.jig` → `db/schema/{{ name }}.ts`
- Uses `@ai({ key: 'drizzleColumns' })` for column definitions
- Uses `@ai({ key: 'drizzleRelations' })` for relations (when provided)
- Exports table variable + `$inferSelect` / `$inferInsert` types

`prisma-schema.prisma.jig` → `prisma/schema.prisma` (inject after `// Models`)
- Uses `@ai({ key: 'prismaModel' })` for full model block

`schema-index.ts.jig` → `db/schema/index.ts` (inject, skip_if already exported)
- Single line: `export * from './<name>'`

---

## 3. Value Object Recipe

**`domain/value-object/recipe.yml`**

Variables:
- `name` — string, required, position: 0, PascalCase
- `baseType` — enum ['string', 'number', 'bigint'], default: 'string'
- `validation` — string, optional (AI infers from name)

Steps:
1. `shell` — `mkdir -p lib/domain/value-objects`
2. `template` — `value-object.ts.jig`
3. `shell` — success message

**Template:** `value-object.ts.jig` → `lib/domain/value-objects/{{ name }}.ts`
- Uses `@ai({ key: 'valueObjectImpl' })` for full implementation
- Generates: branded type, Zod schema, `create<Name>()` with Result type, `is<Name>()` guard, `from<Name>Unsafe()`

---

## 4. Enum Recipe

**`domain/enum/recipe.yml`**

Variables:
- `name` — string, required, position: 0, PascalCase
- `values` — string, optional (AI infers from name)

Steps:
1. `shell` — `mkdir -p lib/domain/enums`
2. `template` — `enum.ts.jig`
3. `shell` — success message

**Template:** `enum.ts.jig` → `lib/domain/enums/{{ name }}.ts`
- Uses `@ai({ key: 'enumImpl' })` for full implementation
- Generates: const object (SCREAMING_SNAKE keys), TypeScript type, Zod schema, `is<Name>()`, `get<Name>Label()`, `getAll<Name>s()`, `from<Name>String()`

---

## 5. Repository Recipe

**`domain/repository/recipe.yml`**

Variables:
- `name` — string, required, position: 0, camelCase
- `entity` — string, optional (defaults to name)
- `methods` — string, optional (extra methods beyond CRUD)

Steps:
1. `shell` — `mkdir -p lib/domain/repositories lib/infrastructure/repositories`
2. `template` — `repository-interface.ts.jig` (always)
3. `template` — `drizzle-repository.ts.jig` (when orm === 'drizzle')
4. `template` — `prisma-repository.ts.jig` (when orm === 'prisma')
5. `shell` — success message

**Templates:**

`repository-interface.ts.jig` → `lib/domain/repositories/{{ name }}-repository.ts`
- Uses `@ai({ key: 'repositoryInterface' })` for interface
- Standard CRUD: `findById`, `findAll`, `create`, `update`, `delete`
- AI adds custom methods from `methods` variable

`drizzle-repository.ts.jig` → `lib/infrastructure/repositories/{{ name }}-repository.impl.ts`
- Uses `@ai({ key: 'drizzleRepoImpl' })` for class implementation
- Imports from `@/db/schema/<name>`, uses `db` client

`prisma-repository.ts.jig` → `lib/infrastructure/repositories/{{ name }}-repository.impl.ts`
- Uses `@ai({ key: 'prismaRepoImpl' })` for class implementation
- Uses `prisma` client

---

## 6. Service Recipe

**`domain/service/recipe.yml`**

Variables:
- `name` — string, required, position: 0, PascalCase
- `entities` — string, optional (which entities it operates on)
- `operations` — string, optional (business operations)

Steps:
1. `shell` — `mkdir -p lib/domain/services`
2. `template` — `service.ts.jig`
3. `shell` — success message

**Template:** `service.ts.jig` → `lib/domain/services/{{ name }}Service.ts`
- Uses `@ai({ key: 'serviceImpl' })` for full class
- Constructor takes repository dependencies
- AI generates business logic methods from entities/operations context

---

## 7. Sandbox Updates

**`sandbox/generate-todo-app.sh`** — Add Step 3.5 after project scaffolding:

```bash
# ─── Step 4: Generate domain layer ───────────────────────────────────
echo "[4/8] Generating domain layer..."

hypergen nextjs domain entity organization --ask=ai
hypergen nextjs domain entity member --ask=ai
hypergen nextjs domain entity todo --ask=ai

hypergen nextjs domain enum UserRole --values=admin,member,viewer
hypergen nextjs domain enum TodoStatus --values=pending,in_progress,done,cancelled

hypergen nextjs domain value-object Email
hypergen nextjs domain value-object Slug

hypergen nextjs domain repository organization --ask=ai
hypergen nextjs domain repository member --ask=ai
hypergen nextjs domain repository todo --ask=ai

hypergen nextjs domain service MembershipManagement --entities=organization,member --ask=ai
```

Renumber subsequent steps (CRUD becomes Step 5, auth pages Step 6, etc.).

**`sandbox/build-todo-app-prompt.md`** — Add domain layer section.

---

## 8. ORM Detection in `when:` Conditions

Templates use `when:` conditions for ORM branching. The condition needs access to `detectProjectFeatures()`. Based on existing CRUD patterns, this is available in the template render context via helpers. For recipe-level `when:` conditions, we need to verify it works — if not, use a shell step to detect ORM and export it as a variable.

Fallback pattern:
```yaml
steps:
  - name: Detect ORM
    tool: shell
    command: |
      if grep -q '"drizzle-orm"' package.json 2>/dev/null; then
        echo "drizzle"
      elif grep -q '"@prisma/client"' package.json 2>/dev/null; then
        echo "prisma"
      else
        echo "none"
      fi
    exports:
      detectedOrm: "{{ result.stdout.trim() }}"

  - name: Generate Drizzle schema
    tool: template
    template: templates/drizzle-schema.ts.jig
    when: "detectedOrm === 'drizzle'"
```

---

## Files to Create

| File | Description |
|------|-------------|
| `cookbooks/domain/cookbook.yml` | Cookbook metadata |
| `cookbooks/domain/entity/recipe.yml` | Entity recipe |
| `cookbooks/domain/entity/templates/zod-schema.ts.jig` | Zod validation + types |
| `cookbooks/domain/entity/templates/drizzle-schema.ts.jig` | Drizzle table definition |
| `cookbooks/domain/entity/templates/prisma-schema.prisma.jig` | Prisma model (inject) |
| `cookbooks/domain/entity/templates/schema-index.ts.jig` | Schema index export (inject) |
| `cookbooks/domain/value-object/recipe.yml` | Value object recipe |
| `cookbooks/domain/value-object/templates/value-object.ts.jig` | Branded type + validation |
| `cookbooks/domain/enum/recipe.yml` | Enum recipe |
| `cookbooks/domain/enum/templates/enum.ts.jig` | Const object + Zod + helpers |
| `cookbooks/domain/repository/recipe.yml` | Repository recipe |
| `cookbooks/domain/repository/templates/repository-interface.ts.jig` | Interface |
| `cookbooks/domain/repository/templates/drizzle-repository.ts.jig` | Drizzle impl |
| `cookbooks/domain/repository/templates/prisma-repository.ts.jig` | Prisma impl |
| `cookbooks/domain/service/recipe.yml` | Service recipe |
| `cookbooks/domain/service/templates/service.ts.jig` | Service class |

## Files to Modify

| File | Change |
|------|--------|
| `sandbox/generate-todo-app.sh` | Add domain layer generation step, renumber |
| `sandbox/build-todo-app-prompt.md` | Add domain layer section |

---

## Verification

1. `bun test` — all existing tests pass (no engine changes)
2. Manual: verify `hypergen nextjs domain entity user --fields=name:string,email:string` resolves correctly via path-resolver
3. Verify each recipe YAML parses without errors (existing recipe parser tests cover structure)
4. Verify ORM detection works in `when:` conditions (test with a mock project)
5. Verify template `@ai` blocks collect correctly in Pass 1 (existing AI collection tests)
