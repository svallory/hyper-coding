# Import Alias Configuration

## Overview

This project uses **`#/` path aliases** to eliminate relative imports (`../`) and make the codebase more maintainable.

**Rule**: Imports must NEVER use `../` - going up directories. Use `#/` aliases instead.

## Configuration

### 1. package.json `imports` field

All packages define import aliases in their `package.json`:

```json
{
  "imports": {
    "#/*": "./src/*",
    "#/tests/*": "./tests/*",
    "#/fixtures/*": "./tests/fixtures/*",
    "#/helpers/*": "./tests/helpers/*"
  }
}
```

This allows:
- `import { foo } from '#/utils/bar'` → resolves to `./src/utils/bar`
- `import { fixture } from '#/fixtures/data'` → resolves to `./tests/fixtures/data`

### 2. tsconfig.json `paths`

TypeScript configuration includes the same path aliases for IDE intellisense:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "#": ["src"],
      "#/*": ["src/*"],
      "#/tests": ["tests"],
      "#/tests/*": ["tests/*"],
      "#/fixtures": ["tests/fixtures"],
      "#/fixtures/*": ["tests/fixtures/*"],
      "#/helpers": ["tests/helpers"],
      "#/helpers/*": ["tests/helpers/*"]
    }
  }
}
```

### 3. vitest.config.ts

Vitest configuration includes `vite-tsconfig-paths` plugin to resolve aliases during testing:

```typescript
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      '#': path.resolve(__dirname, './src'),
      '#/tests': path.resolve(__dirname, './tests'),
      // ... etc
    }
  },
  test: { /* ... */ }
})
```

## Linting: Enforcing the Rule

To enforce that `../` imports are never used, use **ESLint's `no-restricted-imports` rule**:

### .eslintrc.json (per-package or root)

```json
{
  "rules": {
    "no-restricted-imports": [
      "error",
      {
        "patterns": [
          {
            "group": ["../*", "../../*", "../../../*"],
            "message": "Relative imports using ../ are not allowed. Use #/ path aliases instead."
          }
        ]
      }
    ]
  }
}
```

### Running ESLint

```bash
# Check for violations
eslint src/ tests/

# Fix (will report violations but won't auto-fix these patterns)
eslint src/ tests/ --fix
```

## Usage Examples

### ✅ Correct Imports

```typescript
// From same directory
import { helper } from './helper'
import { config } from './config'

// From different directories using #/
import { parseTemplate } from '#/parsers/template'
import { RecipeEngine } from '#/recipe-engine'
import { Logger } from '#/logger'
import { testFixture } from '#/fixtures/data'
```

### ❌ Incorrect Imports (will be caught by linter)

```typescript
// Using ../ - NOT ALLOWED
import { parseTemplate } from '../../parsers/template'
import { RecipeEngine } from '../../../recipe-engine'
```

## Migration Path

If you have existing code with `../` imports:

1. **Identify violations**: Run ESLint to find all `../` imports
2. **Replace with `#/`**: Update imports to use path aliases
3. **Example conversion**:
   ```typescript
   // Before
   import { utils } from '../../../utils/helpers'

   // After
   import { utils } from '#/utils/helpers'
   ```

## Biome Configuration

**Note**: As of Biome 2.3.15, the `noRestrictedImports` rule is not yet available. When it becomes available, it can be used instead of ESLint:

```json
{
  "linter": {
    "rules": {
      "style": {
        "noRestrictedImports": {
          "level": "error",
          "options": {
            "paths": {
              "../*": "Use #/ path aliases instead",
              "../../*": "Use #/ path aliases instead"
            }
          }
        }
      }
    }
  }
}
```

For now, use ESLint (see above section).

## Benefits

1. **Shorter imports**: `#/utils/helpers` vs `../../../utils/helpers`
2. **Refactoring-friendly**: Moving files doesn't break imports
3. **IDE support**: Full intellisense and auto-import with tsconfig paths
4. **Enforceable**: Can be linted to prevent violations
5. **Package isolation**: Each package uses relative `#/` paths, not interdependent relative imports

## Related Files

- All `package.json` files (imports field)
- All `tsconfig.json` files (paths field)
- All `vitest.config.ts` files (vite-tsconfig-paths plugin)
- All `.eslintrc.json` files (no-restricted-imports rule)
- `biome.json` files (awaiting noRestrictedImports availability)
