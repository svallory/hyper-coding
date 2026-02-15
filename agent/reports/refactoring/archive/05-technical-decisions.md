# Technical Decisions and Trade-offs

## Major Design Decisions

### 1. Four Packages Instead of Two or Six

**Decision:** Split into exactly 4 packages: core, kits, gen, cli

**Alternatives Considered:**

**Option A: Two packages (core + cli)**
- ❌ Rejected: Kits and gen have different evolution rates
- ❌ Rejected: Different dependency sets (degit vs Jig)
- ❌ Rejected: Different consumer audiences
- ❌ Rejected: No plugin architecture benefits

**Option B: Six+ packages (core, config, errors, kits, gen, cli)**
- ❌ Rejected: Config too intertwined with core types
- ❌ Rejected: Errors used everywhere, no benefit to separate
- ❌ Rejected: Excessive coordination overhead
- ❌ Rejected: Too many dependencies to manage

**Option C: Four packages (chosen)**
- ✅ Clear separation of concerns
- ✅ Independent evolution possible
- ✅ oclif plugin architecture enabled
- ✅ Minimal coordination overhead
- ✅ Each package has clear purpose

**Rationale:**
Four is the sweet spot. Any fewer and you lose plugin benefits. Any more and coordination overhead dominates.

---

### 2. Helper Registration Callback Pattern

**Problem:** Config loader and parsers need to load helpers, but can't depend on Jig engine (would create circular dependency: core → gen → core).

**Alternatives Considered:**

**Option A: Core depends on Jig**
- ❌ Rejected: Circular dependency
- ❌ Rejected: Core becomes heavyweight
- ❌ Rejected: Can't use core without gen

**Option B: Event emitter pattern**
```typescript
const emitter = new EventEmitter()
emitter.on('helpersLoaded', (helpers) => registerHelpers(helpers))
configLoader.setEmitter(emitter)
```
- ❌ Rejected: Too complex
- ❌ Rejected: Hidden control flow
- ❌ Rejected: Harder to test

**Option C: Callback pattern (chosen)**
```typescript
interface ConfigLoaderOptions {
  onHelpersLoaded?: (helpers: Record<string, Function>, source: string) => void
}

// Core returns helpers
const config = await loadConfig(path, root, env, {
  onHelpersLoaded: (helpers, source) => {
    // Gen registers with Jig
    registerHelpers(helpers, source)
  }
})
```
- ✅ Explicit control flow
- ✅ Easy to test
- ✅ No circular dependency
- ✅ Simple to understand

**Rationale:**
Callback is explicit, testable, and keeps dependency direction clean. Consumer (gen) has full control over registration.

---

### 3. Type Extraction vs Runtime Extraction

**Decision:** Extract ALL type definitions to core, leave runtime implementations in original packages

**Pattern:**
```typescript
// @hypercli/core/src/types/recipe.ts
export interface RecipeConfig { /* ... */ }
export interface RecipeStep { /* ... */ }
export type RecipeStepUnion = TemplateStep | ActionStep | /* ... */

// @hypercli/gen/src/recipe-engine/recipe-engine.ts
import type { RecipeConfig } from '@hypercli/core'

export class RecipeEngine {
  async executeRecipe(config: RecipeConfig) { /* ... */ }
}
```

**Benefits:**
- ✅ Core has single source of truth for types
- ✅ No duplicate type definitions
- ✅ Gen can evolve runtime without changing types
- ✅ Other packages can import types without importing gen

**Challenges:**
- ⚠️ Large type files (recipe.ts is 28KB)
- ⚠️ Requires careful import management
- ⚠️ Types and implementations can drift if not careful

**Mitigation:**
- Integration tests ensure types match runtime
- TypeScript compiler catches mismatches
- Documentation links types to implementations

---

### 4. oclif Plugin Architecture

**Decision:** Gen and kits are oclif plugins loaded by CLI

**Alternatives Considered:**

**Option A: Monolithic CLI with all commands**
- ❌ Rejected: No independent evolution
- ❌ Rejected: All changes require full release
- ❌ Rejected: Can't add new commands without modifying CLI

**Option B: Dynamic imports of command modules**
```typescript
const command = await import(`./commands/${name}`)
command.run()
```
- ❌ Rejected: No standardization
- ❌ Rejected: No plugin discovery
- ❌ Rejected: No help system integration

**Option C: oclif plugins (chosen)**
```json
{
  "plugins": ["@hypercli/gen", "@hypercli/kit"]
}
```
- ✅ Standard plugin architecture
- ✅ Independent versioning
- ✅ Help system integration
- ✅ Command discovery
- ✅ Future extensibility

**Rationale:**
oclif is battle-tested (used by Heroku CLI, Salesforce CLI). Provides all needed infrastructure out of the box.

---

### 5. Binary Name Change (hypergen → hyper)

**Decision:** Change command name from `hypergen` to `hyper`

**Alternatives Considered:**

**Option A: Keep hypergen**
- ❌ Rejected: Ties to old monolithic package
- ❌ Rejected: Longer to type
- ❌ Rejected: Doesn't signal architecture change

**Option B: Use hypercli**
- ❌ Rejected: Doesn't match package scope (@hypercli)
- ❌ Rejected: "cli" suffix redundant (it's obviously a CLI)
- ❌ Rejected: Longer than necessary

**Option C: Use hyper (chosen)**
- ✅ Short, easy to type
- ✅ Matches package scope
- ✅ Signals fresh start
- ✅ Modern, clean naming

**Rationale:**
Short command names reduce friction. `hyper` is 7 characters shorter than `hypergen` per invocation. For a frequently-used command, this matters.

---

### 6. No Facade/Re-export in Hypergen Deprecation

**Decision:** Clean break - hypergen@9.0.0 is deprecation-only, no re-exports

**Alternatives Considered:**

**Option A: Hypergen as facade**
```typescript
// hypergen/src/index.ts
export * from '@hypercli/core'
export * from '@hypercli/gen'
export * from '@hypercli/kit'
```
- ❌ Rejected: Maintains old package
- ❌ Rejected: Users don't migrate
- ❌ Rejected: Technical debt forever

**Option B: Gradual deprecation with warnings**
```typescript
console.warn('hypergen is deprecated, migrate to @hypercli/*')
export * from '@hypercli/core'
```
- ❌ Rejected: Console spam annoys users
- ❌ Rejected: Still maintains old package
- ❌ Rejected: Unclear migration timeline

**Option C: Clean break (chosen)**
- ✅ Forces migration
- ✅ No technical debt
- ✅ Clear message
- ✅ Postinstall notice is enough

**Rationale:**
Clean breaks are painful short-term but better long-term. Users get clear signal to migrate, no lingering old package.

---

### 7. Strict TypeScript Disabled Initially

**Decision:** Start with strict: false, re-enable per-package later

**Alternatives Considered:**

**Option A: Fix all strict errors before launch**
- ❌ Rejected: Weeks of work
- ❌ Rejected: Blocks launch
- ❌ Rejected: Not user-visible

**Option B: Ship with strict errors**
- ❌ Rejected: Doesn't compile
- ❌ Rejected: No fallback

**Option C: Disable strict initially (chosen)**
- ✅ Code compiles
- ✅ Can launch immediately
- ✅ Can fix incrementally
- ✅ Not user-visible

**Rationale:**
Pragmatic choice. Strict mode is internal quality, not user-facing. Better to launch with working code than delay for internal cleanup.

---

### 8. DTS Generation Disabled for Core

**Decision:** Disable .d.ts generation for @hypercli/core due to inflection types issue

**Alternatives Considered:**

**Option A: Fix inflection types compatibility**
- ⏳ Time-consuming research
- ⏳ May not have solution
- ⏳ Blocks launch

**Option B: Replace inflection library**
- ❌ Rejected: Breaking change
- ❌ Rejected: Need to update helpers
- ❌ Rejected: Risk of bugs

**Option C: Write custom .d.ts for inflection**
```typescript
declare module 'inflection' {
  export function pluralize(str: string): string
  // ...
}
```
- ⏳ Time-consuming
- ⏳ Easy to get wrong
- ⏳ Maintenance burden

**Option D: Disable DTS for now (chosen)**
- ✅ Code compiles and runs
- ✅ Can use .ts files directly
- ✅ Can fix later
- ✅ Doesn't block launch

**Rationale:**
.d.ts files are optimization, not requirement. TypeScript projects can import .ts files directly. Fix later when time permits.

---

### 9. Monorepo Without Submodules

**Decision:** Use single git repo with bun workspaces, no git submodules

**Alternatives Considered:**

**Option A: Git submodules (one repo per package)**
```
hyperdev/
  core/         (git submodule)
  kits/         (git submodule)
  gen/          (git submodule)
  cli/          (git submodule)
```
- ❌ Rejected: Complex workflow
- ❌ Rejected: Easy to get wrong
- ❌ Rejected: CI/CD complications
- ❌ Rejected: Submodule hell

**Option B: Separate repos**
```
@hypercli/core        (separate repo)
@hypercli/kit        (separate repo)
@hypercli/gen         (separate repo)
@hypercli/cli         (separate repo)
```
- ❌ Rejected: Hard to coordinate changes
- ❌ Rejected: Need to publish core before testing gen
- ❌ Rejected: Cross-package refactoring is painful

**Option C: Monorepo with workspaces (chosen)**
```
hyperdev/
  packages/
    core/
    kit/
    gen/
    cli/
```
- ✅ Single git clone
- ✅ Atomic cross-package changes
- ✅ Easy local development
- ✅ Simple CI/CD
- ✅ workspace:* dependencies just work

**Rationale:**
Monorepos are standard for multi-package projects (Babel, Jest, React all use them). Workspaces make development smooth.

---

### 10. Moon Build System Kept

**Decision:** Continue using moon for task orchestration

**Alternatives Considered:**

**Option A: Nx**
- ❌ Rejected: Heavy dependency
- ❌ Rejected: Opinionated structure
- ❌ Rejected: Already using moon

**Option B: Turborepo**
- ❌ Rejected: Vercel ecosystem lock-in
- ❌ Rejected: Less flexible than moon
- ❌ Rejected: Already using moon

**Option C: Plain npm scripts**
- ❌ Rejected: No caching
- ❌ Rejected: No dependency graph
- ❌ Rejected: Loses moon benefits

**Option D: Keep moon (chosen)**
- ✅ Already integrated
- ✅ Works well
- ✅ Task caching
- ✅ Dependency tracking
- ✅ No migration needed

**Rationale:**
"If it ain't broke, don't fix it." Moon works, team knows it, no reason to change.

---

## Trade-offs Accepted

### 1. Initial Build Complexity
**Trade-off:** 4 packages to build vs 1

**Accepted because:**
- Moon caching mitigates repeated builds
- Independent releases worth the cost
- Most changes touch only one package

### 2. More Dependencies to Manage
**Trade-off:** 4 package.json files vs 1

**Accepted because:**
- Workspace:* references keep versions in sync
- Changesets automate version bumps
- Bun workspaces handle installation

### 3. Import Path Changes
**Trade-off:** Old imports break

**Accepted because:**
- Clean architecture worth migration pain
- Deprecation notice guides users
- Can add re-export shims if needed

### 4. Learning Curve for Contributors
**Trade-off:** More complex repo structure

**Accepted because:**
- Each package is simpler than monolith
- CLAUDE.md files guide contributors
- Clear boundaries reduce confusion

### 5. TypeScript Strict Mode Disabled
**Trade-off:** Less type safety initially

**Accepted because:**
- Code still compiles and works
- Can fix incrementally
- Not user-visible
- Doesn't block launch

---

## Decisions Deferred

### 1. Test Strategy Details
**Deferred:** Exact test migration plan

**Reason:** Need to see test failures first to understand dependencies

**Will decide:** After attempting migration

### 2. CI/CD Implementation
**Deferred:** Exact workflow configuration

**Reason:** Need to test builds locally first

**Will decide:** After all packages build successfully

### 3. Documentation Structure
**Deferred:** Exact page organization

**Reason:** Need to write content first to see natural structure

**Will decide:** During documentation writing

### 4. .d.ts Generation Solution
**Deferred:** How to fix inflection types

**Reason:** Not blocking, can investigate later

**Will decide:** After launch, during cleanup phase

### 5. Strict Mode Re-enablement
**Deferred:** When and how to re-enable strict TypeScript

**Reason:** Not blocking, internal quality

**Will decide:** Per package, as time permits

---

## Key Principles Applied

### 1. Dependency Direction Matters
**Principle:** Dependencies flow one direction only

**Applied:**
- Core has zero @hypercli dependencies
- Kits depends only on core
- Gen depends on core + kits
- CLI depends on all three
- No circular dependencies allowed

### 2. Types Are Cheap, Runtime Is Expensive
**Principle:** Sharing types costs nothing, sharing runtime costs coupling

**Applied:**
- All types extracted to core
- Runtime stays in original packages
- Import type { } used everywhere
- No runtime coupling through types

### 3. Explicit Is Better Than Implicit
**Principle:** Prefer explicit control flow over magic

**Applied:**
- Callback pattern (explicit) vs event emitters (implicit)
- No global singletons except Jig (necessary for templates)
- Clear import paths, no re-export magic
- Obvious command routing through oclif

### 4. Ship First, Perfect Later
**Principle:** Working code beats perfect code that doesn't ship

**Applied:**
- Strict mode disabled to ship faster
- DTS disabled to avoid inflection rabbit hole
- Tests migrated after core extraction works
- Documentation written incrementally

### 5. Scale Through Composition
**Principle:** Build extensibility through composition, not inheritance

**Applied:**
- oclif plugins compose to form full CLI
- Tools compose to form recipe engine
- Actions compose into pipelines
- Each package is self-contained unit

---

## Lessons for Future Refactorings

### What Went Well

1. **Parallel agent execution**
   - 9 agents working simultaneously
   - Massive time savings
   - Each agent completed its area fully

2. **Type extraction first**
   - Created foundation for everything else
   - Other packages could import types immediately
   - No circular dependency issues

3. **Clear phase separation**
   - Phase 0: Setup
   - Phase 1-4: Extraction
   - Phase 5-6: Deprecation and docs
   - Easy to track progress

4. **Detailed planning document (ITD)**
   - Single source of truth
   - Referenced throughout implementation
   - Captured all key decisions

### What Could Be Better

1. **Test migration planned earlier**
   - Tests left until end
   - Should have planned test distribution upfront
   - Would have caught integration issues sooner

2. **Build verification per phase**
   - Waited until end to check builds
   - Should have verified each package builds as extracted
   - Would have caught inflection issue earlier

3. **TypeScript strictness decision**
   - Flip-flopped between strict and non-strict
   - Should have decided upfront
   - Caused some rework in agents

4. **More specific agent prompts**
   - Some agents hit rate limits
   - Could have been more specific about scope
   - Would have reduced token usage

### Recommendations for Next Time

1. Plan test migration as part of extraction
2. Verify builds after each major phase
3. Decide TypeScript strictness upfront
4. Keep agent scopes tighter
5. Document trade-offs in real-time
6. Create verification checklist per phase
7. Budget time for integration issues
8. Prepare rollback plan before starting
