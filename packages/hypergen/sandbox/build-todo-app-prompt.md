# Build a Multi-tenant Todo App

Build a Next.js application for a multi-tenant todo system using the App Router, TypeScript, Drizzle ORM with SQLite, Zod for validation, shadcn/ui for components, and React Hook Form for forms.

## Domain

Organizations are the top-level tenant. Each organization has members with different roles (admin, member, viewer) and its own collection of todos. Todos can be assigned to members and have optional due dates. A user can belong to multiple organizations.

## Data Models

- **Organization** — name, slug, created timestamp
- **Member** — email, role, organization reference, joined timestamp
- **Todo** — title, description, status, organization reference, assignee, due date

Individual field details (types, validators, form field components) are inferred by AI from the domain description when using `--ask=ai`. You only provide the resource name.

## Domain Layer

Generate the domain layer first, before any UI:

1. **Entities** (organization, member, todo) — Zod validation schema (base, create, update partial), Drizzle table definition, TypeScript types
2. **Enums** (UserRole, TodoStatus) — const object pattern with SCREAMING_SNAKE keys, Zod schema, type guard, label helper
3. **Value Objects** (Email, Slug) — branded types with Zod validation, factory functions returning Result, type guards
4. **Repositories** — interface per entity (findById, findAll, create, update, delete), Drizzle implementation class
5. **Services** (MembershipManagement) — business logic coordinating organization and member repositories

## What to Generate (CRUD / UI)

For each model, generate:

1. **Server actions** — CRUD operations with `'use server'`, Zod validation, Drizzle queries, `revalidatePath`. List operations should support search, pagination, and sorting.
2. **Form component** — client component using React Hook Form with zodResolver, shadcn/ui form fields mapped to appropriate input types, create/edit mode based on whether an ID is provided

## Pages

**Auth**: login, signup

**Dashboard**: overview page

**Admin — Organizations**: list, create, detail (`[id]`), edit (`[id]/edit`)

**Admin — Members** (nested under org): list (`[orgId]/members`), invite (`[orgId]/members/invite`)

Dynamic pages should accept and await Next.js params. All pages should export metadata.
