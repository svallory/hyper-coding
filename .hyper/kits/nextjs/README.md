# @hyper-kits/nextjs

> Comprehensive Next.js code generation kit for building full-stack applications with TypeScript, shadcn/ui, and your choice of ORM.

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/hyperdevhq/nextjs-kit)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)

## ⚡ Quick Start

```bash
# Install Hypergen
npm install -g hypergen

# Configure your stack (interactive wizard)
hypergen nextjs config/all

# Or configure individual tools
hypergen nextjs config/prisma

# Generate a complete CRUD resource
hypergen nextjs crud/resource --name=post

# Generate a form with validation
hypergen nextjs form/rhf --name=UserForm --fields="name:text,email:email"

# Generate a data table
hypergen nextjs table/crud --name=UsersTable
```

## 🎯 What You Get

### Features

#### 🎨 Forms Cookbook
- **4 recipes**: Basic, React Hook Form, Server Actions, CRUD forms
- **11 field types**: text, email, password, number, tel, url, date, time, datetime, textarea, select
- **Type-safe validation** with Zod
- **shadcn/ui components** integration
- **Progressive enhancement** support

#### 📊 Data Tables Cookbook
- **5 recipes**: Basic, sortable, filterable, server-side, CRUD
- **TanStack Table v8** with full TypeScript
- **Pagination, sorting, filtering** out of the box
- **Optimistic updates** for CRUD operations
- **Server-side rendering** support

#### ⚡ CRUD Resource
- **Generates 9 files** for complete CRUD workflow
- **Auto-detects ORM** (Prisma or Drizzle)
- **Parses schemas** to infer fields automatically
- **List, detail, create, edit, delete** pages
- **Type-safe Server Actions**
- **Validation schemas** with Zod

#### 🔄 Server Actions Cookbook
- **3 recipes**: Basic, validated, with revalidation
- **FormData handling** with type coercion
- **Zod validation** integration
- **Cache revalidation** patterns
- **Optimistic updates** examples

#### ⚙️ Config Cookbook
- **Interactive wizard**: Configure your entire stack in one command
- **Prisma**: PostgreSQL, MySQL, SQLite, MongoDB, CockroachDB
- **Drizzle**: PostgreSQL, MySQL, SQLite
- **shadcn/ui**: Base UI or Radix primitives
- **TanStack Query**: Server state management with SSR
- **Re-runnable**: Update configuration anytime

## 📚 Cookbooks

### Config (Stack Setup)
```bash
# Interactive wizard - configure everything at once
hypergen nextjs config/all

# Or configure individual tools
hypergen nextjs config/prisma --database=postgresql
hypergen nextjs config/drizzle --database=postgresql
hypergen nextjs config/shadcn --primitives=baseui --style=new-york
hypergen nextjs config/tanstack-query --withDevtools
```

### Forms
```bash
# Basic form
hypergen nextjs form/basic --name=ContactForm

# React Hook Form + Zod
hypergen nextjs form/rhf \
  --name=UserForm \
  --fields="name:text,email:email,age:number"

# Form with Server Action
hypergen nextjs form/server-action \
  --name=CreatePostForm \
  --fields="title:text,content:textarea"

# CRUD form (auto-detects ORM schema)
hypergen nextjs form/crud \
  --name=user \
  --mode=create
```

### Data Tables
```bash
# Basic table
hypergen nextjs table/basic --name=UsersTable

# With sorting
hypergen nextjs table/sortable --name=ProductsTable

# With filtering
hypergen nextjs table/filterable --name=OrdersTable

# Server-side table
hypergen nextjs table/server --name=UsersTable

# With CRUD actions
hypergen nextjs table/crud --name=PostsTable
```

### CRUD Resource
```bash
# Auto-detect from ORM schema
hypergen nextjs crud/resource --name=post

# Manual field definition
hypergen nextjs crud/resource \
  --name=product \
  --fields="name:string,description:text,price:number,inStock:boolean"
```

### Server Actions
```bash
# Basic Server Action
hypergen nextjs action/basic \
  --name=createUser \
  --fields="name:string,email:string"

# With Zod validation
hypergen nextjs action/validated \
  --name=updateProfile \
  --fields="name:string:min(2),email:string:email,bio:string:optional"

# With cache revalidation
hypergen nextjs action/revalidate \
  --name=createPost \
  --fields="title:string,content:string" \
  --revalidatePath="/posts"
```

### API Routes
```bash
# REST API route
hypergen nextjs api/route --name=users --methods=GET,POST,PUT,DELETE

# Webhook handler
hypergen nextjs api/webhook --name=stripe --provider=stripe

# GraphQL server
hypergen nextjs api/graphql
```

## 🏗️ Architecture

### Helpers (`/helpers/`)
TypeScript utilities for code introspection and generation:
- `detect-project.ts` - Auto-detect ORM, UI library, state management
- `parse-prisma-schema.ts` - Parse Prisma schema files
- `parse-drizzle-schema.ts` - Parse Drizzle schema files
- `parse-tsx.ts` - Parse React components
- `inflections.ts` - String manipulation utilities

### Shared Templates (`/shared/`)
Reusable Jig template partials:
- `partials/zod-schema.jig` - Zod schema generation
- `partials/form-field.jig` - shadcn/ui form fields
- `templates/base-component.jig` - Base React component
- `templates/base-server-action.jig` - Base Server Action

### Cookbooks
Self-contained recipe collections:
- `config/` - Configuration and setup
- `form/` - Form generation
- `table/` - Table generation
- `crud/` - Complete CRUD workflows
- `action/` - Server Actions
- `api/` - REST and GraphQL endpoints

## 🎨 Field Types

All form and Server Action recipes support these field types:

| Type | Input | Zod Validator | Example |
|------|-------|---------------|---------|
| `text` | `<Input type="text">` | `z.string()` | `name:text` |
| `email` | `<Input type="email">` | `z.string().email()` | `email:email` |
| `password` | `<Input type="password">` | `z.string().min(8)` | `password:password` |
| `number` | `<Input type="number">` | `z.number()` | `age:number` |
| `tel` | `<Input type="tel">` | `z.string().regex()` | `phone:tel` |
| `url` | `<Input type="url">` | `z.string().url()` | `website:url` |
| `date` | `<Input type="date">` | `z.string()` | `birthday:date` |
| `time` | `<Input type="time">` | `z.string()` | `startTime:time` |
| `datetime` | `<Input type="datetime-local">` | `z.string()` | `appointmentAt:datetime` |
| `textarea` | `<Textarea>` | `z.string()` | `bio:textarea` |
| `select` | `<Select>` | `z.string()` | `role:select` |
| `checkbox` | `<Checkbox>` | `z.boolean()` | `terms:checkbox` |

### Advanced Validation

```bash
# Minimum/maximum length
--fields="name:string:min(2),bio:string:max(500)"

# Minimum/maximum value
--fields="age:number:min(18),rating:number:max(5)"

# Optional fields
--fields="name:string,nickname:string:optional"

# Enum values
--fields="role:enum:admin,user,guest"

# Arrays
--fields="tags:array,skills:array"
```

## 🔧 Configuration

### ORM Support
- **Prisma**: PostgreSQL, MySQL, SQLite, MongoDB, CockroachDB
- **Drizzle**: PostgreSQL, MySQL, SQLite

Recipes auto-detect your ORM and generate appropriate code.

### UI Library Support
- **shadcn/ui** with Base UI primitives (default)
- **shadcn/ui** with Radix UI primitives
- Auto-detection of installed components

### State Management
- **TanStack Query** for server state

### Package Managers
Auto-detects and uses:
- Bun (preferred)
- pnpm
- Yarn
- npm

## 📖 Documentation

Each cookbook and recipe includes comprehensive documentation:

- **Quick Start** - Get up and running quickly
- **Usage Examples** - Multiple real-world scenarios
- **API Reference** - All variables and options
- **Best Practices** - Production-ready patterns
- **Troubleshooting** - Common issues and solutions
- **Integration** - How recipes work together

## 🤝 Integration Examples

### Complete CRUD Workflow

```bash
# 1. Configure your stack (interactive wizard)
hypergen nextjs config/all

# 2. Generate complete CRUD
hypergen nextjs crud/resource --name=post

# Done! You now have:
# - List page with data table
# - Detail page
# - Create page with form
# - Edit page with form
# - Delete functionality
# - All Server Actions
# - Type-safe schemas
```

### Custom Form + Table

```bash
# Generate form
hypergen nextjs form/rhf \
  --name=ProductForm \
  --fields="name:text,description:textarea,price:number,inStock:checkbox"

# Generate matching table
hypergen nextjs table/crud --name=ProductsTable

# Generate Server Actions
hypergen nextjs action/validated \
  --name=createProduct \
  --fields="name:string:min(1),price:number:min(0)"
```

## 📦 What's Included

### Core Infrastructure
- ✅ 7 helper utilities for code introspection
- ✅ 7 shared template partials
- ✅ Dual ORM support (Prisma + Drizzle)
- ✅ shadcn/ui with Base UI or Radix
- ✅ TanStack Query integration

### Recipes (34 total)
- ✅ 5 config recipes
- ✅ 4 form recipes
- ✅ 5 data table recipes
- ✅ 6 CRUD recipes
- ✅ 3 Server Action recipes
- ✅ 3 API recipes
- ✅ 8 foundational recipes (project, component, page, layout, route, middleware, error, loading)

### Generated Code
- 100% TypeScript with strict type safety
- Zod validation throughout
- shadcn/ui components
- Next.js 15 best practices
- Production-ready patterns

## 🎯 Use Cases

### Perfect for:
- ✅ Building SaaS applications
- ✅ Creating admin panels
- ✅ Developing CRUD-heavy apps
- ✅ Prototyping quickly
- ✅ Learning Next.js patterns
- ✅ Maintaining consistency across projects

### Great for teams that:
- ✅ Value type safety and validation
- ✅ Follow Next.js best practices
- ✅ Use shadcn/ui components
- ✅ Need forms and tables frequently
- ✅ Want to move fast without sacrificing quality

## 📝 License

MIT © [HyperDev Team](https://github.com/hyperdevhq)

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📧 Support

- 🐛 [Issue Tracker](https://github.com/hyperdevhq/nextjs-kit/issues)
- 📖 [Documentation](https://github.com/hyperdevhq/nextjs-kit#readme)

## 🙏 Credits

Built with:
- [Next.js](https://nextjs.org/) - React framework
- [shadcn/ui](https://ui.shadcn.com/) - Component library
- [TanStack Table](https://tanstack.com/table) - Headless table library
- [TanStack Query](https://tanstack.com/query) - Server state management
- [React Hook Form](https://react-hook-form.com/) - Form library
- [Zod](https://zod.dev/) - Schema validation
- [Prisma](https://prisma.io/) - ORM
- [Drizzle](https://orm.drizzle.team/) - ORM

---

**Made with ❤️ by the HyperDev team**
