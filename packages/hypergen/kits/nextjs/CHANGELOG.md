# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-02-11

### Added

**Initial Public Release** 🎉

**Cookbooks (14 total):**
- `config/` - Interactive setup wizard and configuration recipes (5 recipes)
  - Interactive wizard for one-command stack setup
  - Prisma and Drizzle ORM initialization
  - shadcn/ui setup with Base UI and Radix support
  - TanStack Query configuration
- `crud/` - Complete CRUD workflows (6 recipes)
  - Individual page recipes (list, detail, create, edit, delete)
  - Meta-recipe for full CRUD generation
- `form/` - Form generation with validation (4 recipes)
  - Basic forms
  - React Hook Form + Zod integration
  - Server Action forms
  - CRUD forms with ORM auto-detection
- `table/` - Data table generation (5 recipes)
  - TanStack Table v8 integration
  - Sorting, filtering, pagination
  - Server-side tables
  - CRUD tables with inline actions
- `action/` - Server Actions (3 recipes)
  - Basic Server Actions
  - Validated actions with Zod
  - Actions with cache revalidation
- `api/` - REST and GraphQL endpoints (3 recipes)
  - REST API routes with all HTTP methods
  - Webhook handlers with signature verification (6 providers)
  - GraphQL server with GraphQL Yoga
- **8 foundational recipes** - project, component, page, layout, route, middleware, error, loading

**Infrastructure:**
- 7 TypeScript helper utilities for code introspection
- Shared template system with 7 reusable components
- Recipe orchestration with meta-recipes
- Auto-detection for ORM, UI libraries, and package managers

**Documentation:**
- 50 comprehensive README files
- ARCHITECTURE.md technical design guide
- CONTRIBUTING.md community guidelines
- Complete API documentation

**Features:**
- ✅ Dual ORM support (Prisma and Drizzle) with auto-detection
- ✅ shadcn/ui with Base UI and Radix primitives
- ✅ TypeScript-first with strict type safety
- ✅ Next.js 15 App Router support
- ✅ React 19 compatibility
- ✅ Server Actions integration
- ✅ Production-ready security patterns
- ✅ Error handling and loading states
- ✅ Optimistic updates
- ✅ Cache revalidation

[0.1.0]: https://github.com/hyperdevhq/nextjs-kit/releases/tag/v0.1.0
