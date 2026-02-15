# Plan: Helpers-based template DX + directory restructure

## Context

The E2E test currently passes `modelFields` and `modelRelations` as hardcoded JSON string variables. This is clunky — users shouldn't manually construct field metadata. Instead, helpers should parse the actual Go source files and extract struct fields + relations automatically. This embodies the design principle: "the template author does the heavy lifting to save AI tokens."

---

## Changes

### 1. Create Go parser: `sandbox/go/.hypergen/helpers/parse_model.go`

A standalone Go script (uses stdlib only: `go/parser`, `go/ast`, `encoding/json`) that:
- Takes a model name as arg (e.g. `Organization`)
- Resolves `internal/model/<snake_case>.go` relative to cwd
- Parses the struct using Go AST, extracting fields: `{name, type, dbTag, nullable}`
  - Nullable = pointer type (`*string`, `*time.Time`)
- Scans all `.go` files in `internal/model/` for structs with a `<ModelName>ID` field to discover relations: `{name, model, type, foreignKey}`
  - Relation type heuristic: singular model name → `hasOne`, otherwise → `hasMany`
- Outputs JSON: `{"fields": [...], "relations": [...]}`

### 2. Create JS helpers: `sandbox/go/.hypergen/helpers/index.js`

Two exported functions that shell out to `go run parse_model.go`:

```javascript
export function listModelFields(modelName)    // → JSON string of fields
export function listModelRelations(modelName)  // → JSON string of relations
```

These will be registered as **Jig globals** (like `snakeCase`, `camelCase`) so templates call `{{ listModelFields(model) }}` directly.

### 3. Move cookbook directory

```
sandbox/go/recipes/crud/ → sandbox/go/.hypergen/cookbooks/crud/
```

Delete `sandbox/go/recipes/` after moving.

### 4. Update `sandbox/go/hypergen.config.js`

Point `templates` and `discovery.directories` to `.hypergen/cookbooks`, add `helpers` path.

### 5. Update `recipe.yml`

Remove `modelFields` and `modelRelations` variables — only `model` remains.

### 6. Update templates

Replace `{{ modelFields }}` → `{{ listModelFields(model) }}` and `{{ modelRelations }}` → `{{ listModelRelations(model) }}` in `handler.go.jig` and `edit_page.templ.jig`.

### 7. Update E2E test

- Remove `modelFields` and `modelRelations` from `VARIABLES`
- In `beforeEach`, after `initializeJig()`, register `listModelFields` and `listModelRelations` as Jig globals via `getJig().global(...)`
- The test helpers will shell out to `go run` pointing at the real `sandbox/go/.hypergen/helpers/parse_model.go` with cwd set to `sandbox/go/`
- Copy the Go model files (`organization.go`, `member.go`, `invite.go`, `membership.go`) into `tempDir/internal/model/` so the parser can find them — OR point the helpers at the real `sandbox/go/` path
- Update template string constants to use `{{ listModelFields(model) }}` and `{{ listModelRelations(model) }}`
- Test assertions remain unchanged (same output, just different variable source)

**Decision on `projectRoot`**: Since `context.ts` does NOT expose `cwd` to the template, and we don't want to modify hypergen source for this sandbox change, the helpers will be registered as Jig globals that close over the project root (baked in at registration time). Templates call `{{ listModelFields(model) }}` with just the model name. In the test, we bake in the path to the sandbox `internal/model/` directory when registering the globals.

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `sandbox/go/.hypergen/helpers/parse_model.go` | **Create** — Go AST parser |
| `sandbox/go/.hypergen/helpers/index.js` | **Create** — JS wrapper |
| `sandbox/go/.hypergen/cookbooks/crud/cookbook.yml` | **Move** from `recipes/crud/` |
| `sandbox/go/.hypergen/cookbooks/crud/edit-page/recipe.yml` | **Move** + remove modelFields/modelRelations vars |
| `sandbox/go/.hypergen/cookbooks/crud/edit-page/templates/*.jig` | **Move** + update variable refs to helper calls |
| `sandbox/go/hypergen.config.js` | **Update** |
| `sandbox/go/recipes/` | **Delete** |
| `tests/suites/ai/e2e-edit-page-recipe.test.ts` | **Update** |

---

## Implementation Order

1. Create `sandbox/go/.hypergen/helpers/parse_model.go`
2. Test it: `cd sandbox/go && go run .hypergen/helpers/parse_model.go Organization`
3. Create `sandbox/go/.hypergen/helpers/index.js`
4. Move `sandbox/go/recipes/crud/` → `sandbox/go/.hypergen/cookbooks/crud/`
5. Delete `sandbox/go/recipes/`
6. Update `sandbox/go/hypergen.config.js`
7. Update `recipe.yml` — remove modelFields/modelRelations variables
8. Update templates — replace variable refs with helper calls
9. Update E2E test — register helpers as Jig globals, update template constants, update VARIABLES
10. Run tests, verify

---

## Verification

1. `cd sandbox/go && go run .hypergen/helpers/parse_model.go Organization` → valid JSON with 9 fields and 3 relations
2. `bun test tests/suites/ai/e2e-edit-page-recipe.test.ts` → all 15 tests pass
3. `bun test tests/suites/ai/` → no regressions (89 tests)
