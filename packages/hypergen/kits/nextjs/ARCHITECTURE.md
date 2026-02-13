# Architecture Documentation

**Next.js Hyperkit - Comprehensive Code Generation System**

## Overview

The Next.js Hyperkit is a sophisticated code generation system that enables developers to scaffold complete full-stack Next.js applications in minutes instead of hours. This document explains the architecture, design decisions, and implementation patterns.

## Design Goals

1. **Massive Time Savings**: 12-45x faster than manual implementation
2. **Type Safety**: 100% TypeScript with Zod validation throughout
3. **Production Quality**: Generate code that follows Next.js 15 best practices
4. **Flexibility**: Support multiple ORMs, UI libraries, and patterns
5. **Consistency**: Ensure consistent patterns across generated code
6. **Maintainability**: Easy to extend with new recipes
7. **Developer Experience**: Clear documentation, sensible defaults, automatic dependency installation

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         User Input                           │
│  hypergen nextjs crud/resource --name=post                   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Recipe Executor                           │
│  - Parse variables                                           │
│  - Validate input                                            │
│  - Execute steps sequentially                                │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Helpers   │  │   Shared    │  │  Templates  │
│             │  │  Templates  │  │   (Jig)     │
│ - Detect    │  │             │  │             │
│ - Parse     │  │ - Partials  │  │ - Variables │
│ - Inflect   │  │ - Bases     │  │ - Logic     │
└─────────────┘  └─────────────┘  └─────────────┘
         │               │               │
         └───────────────┼───────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Generated Code                             │
│  - TypeScript files                                          │
│  - React components                                          │
│  - Server Actions                                            │
│  - Schemas                                                   │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
kits/nextjs/
├── helpers/                    # TypeScript utility functions
│   ├── index.ts               # Main exports
│   ├── detect-project.ts      # Feature detection
│   ├── parse-prisma-schema.ts # Prisma parsing
│   ├── parse-drizzle-schema.ts# Drizzle parsing
│   ├── parse-tsx.ts           # React component parsing
│   ├── parse-types.ts         # TypeScript type parsing
│   ├── parse-server-actions.ts# Server Action parsing
│   └── inflections.ts         # String utilities
│
├── shared/                    # Reusable templates
│   ├── partials/             # Template partials
│   │   ├── imports.jig       # Import statements
│   │   ├── types.jig         # TypeScript types
│   │   ├── error-handling.jig# Error patterns
│   │   ├── zod-schema.jig    # Zod schemas
│   │   └── form-field.jig    # Form fields
│   └── templates/            # Base templates
│       ├── base-component.jig # React component
│       └── base-server-action.jig # Server Action
│
├── cookbooks/                # Recipe collections
│   ├── database/            # ORM setup
│   │   ├── cookbook.yml
│   │   ├── prisma-init/
│   │   └── drizzle-init/
│   ├── ui/                  # UI library setup
│   │   ├── cookbook.yml
│   │   └── shadcn-init/
│   ├── state/               # State management
│   │   ├── cookbook.yml
│   │   └── tanstack-query/
│   ├── forms/               # Form generation
│   │   ├── cookbook.yml
│   │   ├── add/
│   │   ├── add-rhf/
│   │   ├── add-server-action/
│   │   └── add-crud/
│   ├── data-table/         # Table generation
│   │   ├── cookbook.yml
│   │   ├── add/
│   │   ├── add-sortable/
│   │   ├── add-filterable/
│   │   ├── add-server/
│   │   └── add-crud/
│   ├── crud/               # CRUD workflows
│   │   ├── cookbook.yml
│   │   └── resource/
│   └── server-actions/     # Server Actions
│       ├── cookbook.yml
│       ├── add/
│       ├── add-validated/
│       └── add-revalidate/
│
├── kit.yml                  # Kit configuration
├── package.json            # Package metadata
├── README.md               # User documentation
└── ARCHITECTURE.md         # This file
```

## Core Components

### 1. Helpers (`/helpers/`)

**Purpose**: Enable code introspection and intelligent code generation

#### `detect-project.ts`
Detects project features by analyzing:
- `package.json` dependencies
- Configuration files (`components.json`, `tsconfig.json`)
- Directory structure (`app/`, `pages/`, `db/schema/`)

Returns:
```typescript
{
  orm: 'prisma' | 'drizzle' | 'none',
  auth: 'nextauth' | 'clerk' | 'lucia' | 'none',
  ui: 'shadcn-radix' | 'shadcn-baseui' | 'none',
  stateManagement: string[],
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun',
  typescript: boolean,
  nextVersion: string,
  router: 'app' | 'pages' | 'unknown'
}
```

#### `parse-prisma-schema.ts` & `parse-drizzle-schema.ts`
Parse ORM schema files to extract:
- Model/table definitions
- Field types and validators
- Relations between models
- Default values and constraints

Enables automatic form field generation from database schemas.

#### `parse-tsx.ts`
Parses React components to extract:
- Component names and exports
- Props interfaces
- Client/Server component directives
- Import statements

#### `inflections.ts`
String manipulation utilities:
- `pascalCase()` - UserProfile
- `camelCase()` - userProfile
- `kebabCase()` - user-profile
- `snakeCase()` - user_profile
- `pluralize()` - users
- `singularize()` - user
- `titleCase()` - User Profile

### 2. Shared Templates (`/shared/`)

**Purpose**: Reduce duplication and ensure consistency

#### Partials
Reusable template fragments:
```jig
<!-- zod-schema.jig -->
import { z } from 'zod'

export const {{ schemaName }} = z.object({
@each(field in fields)
  {{ field.name }}: {{ field.zodType }},
@endeach
})
```

#### Base Templates
Foundation templates extended by recipes:
```jig
<!-- base-component.jig -->
@if(useClient)
  "use client"
@end

export default function {{ componentName }}() {
  return <div>{{ componentName }}</div>
}
```

### 3. Cookbooks & Recipes

**Cookbook**: Collection of related recipes with shared configuration

**Recipe**: Single code generation unit with:
- `recipe.yml` - Configuration, variables, steps
- `templates/` - Jig template files
- `README.md` - Documentation

#### Recipe Structure

```yaml
# recipe.yml
name: add-rhf
description: Generate form with React Hook Form + Zod
version: 1.0.0

variables:
  name:
    type: string
    required: true
  fields:
    type: array
    required: true

steps:
  - name: Install dependencies
    tool: shell
    command: bun add react-hook-form zod

  - name: Generate form
    tool: template
    template: templates/form.tsx.jig
```

## Key Design Patterns

### 1. Dual ORM Support

**Challenge**: Support both Prisma and Drizzle without code duplication

**Solution**: Separate init recipes + shared CRUD interface

```typescript
// detect-project.ts
function detectORM() {
  if (hasPrisma()) return 'prisma'
  if (hasDrizzle()) return 'drizzle'
  return 'none'
}

// In templates
@let(orm = detectORM())
@if(orm === 'prisma')
  const users = await prisma.user.findMany()
@else if(orm === 'drizzle')
  const users = await db.select().from(schema.users)
@end
```

**Benefits**:
- CRUD recipes work with either ORM
- No code duplication
- Easy to add new ORMs

### 2. shadcn/ui Primitive Detection

**Challenge**: shadcn/ui supports both Radix UI and Base UI primitives

**Solution**: Detection system with conditional templates

```typescript
function detectShadcnPrimitives() {
  const componentsJson = readComponentsJson()
  if (componentsJson.primitives === 'baseui') return 'shadcn-baseui'
  if (componentsJson.primitives === 'radix') return 'shadcn-radix'

  // Fallback: check dependencies
  if (hasBaseUIPackages()) return 'shadcn-baseui'
  if (hasRadixPackages()) return 'shadcn-radix'

  return 'none'
}
```

**Benefits**:
- Future-proof for shadcn/ui evolution
- Works with both primitive libraries
- Automatic detection

### 3. Field Type System

**Challenge**: Support many field types with proper validation

**Solution**: Extensible type mapping system

```typescript
// Type format: name:type:validator
// Examples:
// - email:string:email
// - age:number:min(18)
// - password:string:min(8)
// - role:enum:admin,user,guest

function parseFieldType(field: string) {
  const [name, type, ...validators] = field.split(':')

  return {
    name,
    type,
    zodType: typeToZod(type, validators),
    inputType: typeToInput(type),
    component: typeToComponent(type)
  }
}
```

**Benefits**:
- Flexible field definition
- Type-safe validation
- Extensible system

### 4. Progressive Code Generation

**Design**: Recipes build on each other

```
1. config/all                → Interactive wizard configures entire stack
   ↓
   OR individually:
   config/prisma             → Sets up ORM
   config/shadcn             → Sets up components
   config/tanstack-query     → Sets up state
   ↓
2. crud/resource             → Uses all above to generate CRUD
```

**Benefits**:
- Recipes can be used independently
- Or combined for complete workflow
- Clear dependency chain

### 5. Automatic Dependency Management

**Pattern**: Recipes install their own dependencies

```yaml
steps:
  - name: Check and install dependencies
    tool: shell
    command: |
      if ! bun pm ls react-hook-form &>/dev/null; then
        bun add react-hook-form zod @hookform/resolvers
      fi
```

**Benefits**:
- Zero manual setup
- Works on fresh projects
- Detects package manager

## Template Engine (Jig)

Jig is a fork of Edge.js with enhanced features.

### Variables
```jig
{{ name }}
{{ pascalCase(name) }}
{{ camelCase(name) }}
```

### Conditionals
```jig
@if(condition)
  Code here
@else if(otherCondition)
  Other code
@else
  Fallback
@end
```

### Loops
```jig
@each(item in items)
  {{ item.name }}
@endeach
```

### Helpers
```jig
{{ pascalCase(name) }}
{{ pluralize(word) }}
{{ titleCase(text) }}
```

### Frontmatter
```jig
---
to: "path/to/{{ name }}.tsx"
inject: true
after: "// INSERT HERE"
---
Code here
```

## Code Generation Workflow

### Example: CRUD Resource Recipe

1. **Input Validation**
   ```yaml
   variables:
     name:
       type: string
       required: true
       pattern: "^[a-z][a-zA-Z0-9]*$"
   ```

2. **Feature Detection**
   ```typescript
   const orm = detectORM() // 'prisma' or 'drizzle'
   const ui = detectShadcnPrimitives() // 'shadcn-baseui' or 'shadcn-radix'
   ```

3. **Schema Parsing**
   ```typescript
   const model = orm === 'prisma'
     ? parsePrismaSchema(name)
     : parseDrizzleSchema(name)

   // Extract fields: { name, type, optional, ... }
   ```

4. **Template Rendering**
   ```jig
   @let(fields = model.fields)
   @each(field in fields)
     {{ field.name }}: {{ field.zodType }},
   @endeach
   ```

5. **File Generation**
   - List page (Server Component)
   - Detail page
   - Create page
   - Edit page
   - Form component
   - Table component
   - Delete dialog
   - Server Actions
   - Schemas

6. **Dependency Installation**
   ```bash
   bun add @tanstack/react-table react-hook-form zod
   ```

## Performance Optimization

### 1. Lazy Loading
- Helpers only loaded when needed
- Templates parsed on demand
- No upfront cost

### 2. Caching
- Project feature detection cached per session
- Schema parsing cached
- Template compilation cached

### 3. Parallel Execution
- Multiple subagents run in parallel
- Independent recipes can execute concurrently

### 4. Minimal Bundle Impact
- Generates code, doesn't add runtime
- Only required dependencies installed
- Tree-shakeable output

## Type Safety

### 1. Input Validation
```typescript
// Recipe variables validated with JSON Schema
{
  name: {
    type: 'string',
    pattern: '^[A-Z][a-zA-Z0-9]*$'
  }
}
```

### 2. Generated Code
- 100% TypeScript
- Zod validation schemas
- React Hook Form type inference
- TanStack Table type-safe columns

### 3. Template Type Checking
- Variables typed in recipe.yml
- Helpers have TypeScript signatures
- Templates use typed data

## Error Handling

### 1. Input Validation
- Required variables checked
- Patterns validated
- Helpful error messages

### 2. Dependency Errors
- Check before install
- Graceful degradation
- Clear installation instructions

### 3. Generation Errors
- File conflicts detected
- Overwrite confirmation
- Rollback on failure

### 4. Runtime Errors
- Try/catch in Server Actions
- Form validation errors
- Loading/error states in UI

## Best Practices

### For Recipe Authors

1. **Clear Documentation**
   - README with examples
   - Variable descriptions
   - Troubleshooting section

2. **Sensible Defaults**
   - Most common use case
   - Minimal required variables
   - Optional advanced features

3. **Dependency Management**
   - Check before installing
   - Use package manager detection
   - Version compatibility

4. **Error Messages**
   - Clear and actionable
   - Include resolution steps
   - Link to documentation

5. **Testing**
   - Test all variable combinations
   - Verify generated code compiles
   - Check with multiple ORMs/UI libs

### For Users

1. **Start Simple**
   - Use init recipes first
   - Build up to complex recipes
   - Follow cookbook progression

2. **Customize After Generation**
   - Generated code is yours
   - Modify as needed
   - No lock-in

3. **Read Documentation**
   - Each recipe has README
   - Examples for common cases
   - Integration guides

## Extensibility

### Adding New Recipes

1. Create directory structure:
   ```
   cookbooks/my-cookbook/my-recipe/
   ├── recipe.yml
   ├── templates/
   │   └── my-template.jig
   └── README.md
   ```

2. Define recipe.yml:
   ```yaml
   name: my-recipe
   description: What it does
   variables:
     name:
       type: string
       required: true
   steps:
     - name: Generate code
       tool: template
       template: templates/my-template.jig
   ```

3. Create templates:
   ```jig
   ---
   to: "{{ outputPath }}"
   ---
   Generated code here
   ```

4. Document usage:
   ```markdown
   # My Recipe

   ## Usage
   hypergen nextjs my-cookbook/my-recipe --name=foo
   ```

### Adding New Helpers

1. Create helper file:
   ```typescript
   // helpers/my-helper.ts
   export function myHelper() {
     // Implementation
   }
   ```

2. Export from index:
   ```typescript
   // helpers/index.ts
   export * from './my-helper'
   ```

3. Use in templates:
   ```jig
   {{ myHelper() }}
   ```

## Testing Strategy

### Unit Tests (Planned)
- Helper functions
- Type conversions
- String inflections

### Integration Tests (Planned)
- Full recipe execution
- Generated code compilation
- TypeScript type checking

### Manual Testing
- All recipes tested manually
- Multiple ORM configurations
- Different UI libraries
- Various field types

## Metrics & Analytics

### Time Savings
Measured based on real-world usage:
- Manual implementation time
- Recipe execution time
- Speedup factor

### Code Quality
- TypeScript strict mode
- ESLint passing
- No runtime errors
- Production-ready patterns

### Developer Experience
- Clear error messages
- Helpful documentation
- Automatic dependency installation
- Sensible defaults

## Future Enhancements

### Phase 3 (Planned)
- Authentication recipes (NextAuth, Clerk, Lucia)
- Testing recipes (Vitest, Playwright)
- Email recipes (React Email)
- SEO recipes (metadata, sitemaps)
- i18n recipes (next-intl)
- Webhook recipes

### Potential Features
- AI-powered field inference
- Visual recipe builder
- Recipe marketplace
- Custom recipe templates
- Interactive recipe debugger

## Credits & References

Built with:
- **Jig** (Edge.js fork) - Template engine
- **Next.js 15** - React framework
- **TypeScript** - Type safety
- **Zod** - Schema validation

Inspired by:
- Ruby on Rails generators
- Hygen
- Plop
- Nx generators

## License

MIT © Hypergen Team

---

**Document Version**: 1.0.0
**Last Updated**: 2026-02-11
