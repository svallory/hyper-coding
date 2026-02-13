# CRUD Cookbook

Generate complete CRUD (Create, Read, Update, Delete) operations for your Next.js application with type-safe forms, Server Actions, and database integration.

## Quick Start

Generate a complete CRUD resource:

```bash
hypergen nextjs crud resource --name=post
```

Or generate individual CRUD pages:

```bash
hypergen nextjs crud create-page --name=post
hypergen nextjs crud list-page --name=post
hypergen nextjs crud edit-page --name=post
```

## Recipes

### [resource](./resource/) - Complete CRUD Resource
Meta-recipe that generates all CRUD pages for a resource in one command. Creates list, detail, create, and edit pages with forms, Server Actions, and routing.

**Generates:**
- List page with data table
- Detail page with view/edit/delete actions
- Create page with form and validation
- Edit page with pre-filled form
- Server Actions for all operations
- Type-safe schemas and components

### [create-page](./create-page/) - Create Page
Generate a create page with form, validation, and Server Action. Includes React Hook Form, Zod schema, and auto-redirect after creation.

**Features:**
- Type-safe form with shadcn/ui components
- Zod validation schema
- Server Action for data creation
- Auto-redirect on success
- Auto-detect ORM schema fields

### [list-page](./list-page/) - List/Index Page
Generate a list page with data table, filtering, sorting, and pagination. Uses TanStack Table with shadcn/ui components.

**Features:**
- Server-side or client-side data fetching
- Column sorting and filtering
- Pagination controls
- Search functionality
- Action buttons (view, edit, delete)

### [detail-page](./detail-page/) - Detail/Show Page
Generate a detail page that displays a single record with actions (edit, delete, back to list).

**Features:**
- Type-safe data fetching
- Action buttons with confirmation
- Breadcrumb navigation
- Loading and error states

### [edit-page](./edit-page/) - Edit/Update Page
Generate an edit page with pre-filled form and update Server Action. Reuses form component from create page.

**Features:**
- Pre-filled form with existing data
- Type-safe updates with Zod validation
- Server Action for updates
- Cancel and save actions
- Auto-redirect on success

### [delete](./delete/) - Delete Action
Generate a delete Server Action with confirmation and cascade handling.

**Features:**
- Soft delete or hard delete
- Confirmation dialog component
- Cascade delete handling
- Type-safe action

## Common Use Cases

### Blog Application
```bash
# Complete blog post CRUD
hypergen nextjs crud resource --name=post

# Just create and list (no editing)
hypergen nextjs crud create-page --name=post
hypergen nextjs crud list-page --name=post
```

### E-commerce Products
```bash
# Products with full CRUD
hypergen nextjs crud resource --name=product \
  --fields="name:string,description:text,price:number,inStock:boolean"

# Categories (simple list and create)
hypergen nextjs crud list-page --name=category
hypergen nextjs crud create-page --name=category
```

### User Management
```bash
# Users with custom fields
hypergen nextjs crud resource --name=user \
  --fields="email:email,name:string,role:select"
```

### Content Management
```bash
# Pages with rich content
hypergen nextjs crud resource --name=page \
  --fields="title:string,slug:string,content:textarea,published:boolean"
```

## Generated File Structure

For a `post` resource, the `resource` recipe generates:

```
app/
├── posts/
│   ├── page.tsx                    # List page
│   ├── [id]/
│   │   ├── page.tsx                # Detail page
│   │   └── edit/
│   │       └── page.tsx            # Edit page
│   └── new/
│       └── page.tsx                # Create page
├── actions/
│   └── post.ts                     # Server Actions (create, update, delete)
components/
└── forms/
    └── PostForm.tsx                # Reusable form component
lib/
└── schemas/
    └── post-schema.ts              # Zod validation schema
```

## Requirements

Before using CRUD recipes, ensure you have:

1. **Database ORM** configured (Prisma or Drizzle)
   ```bash
   hypergen nextjs config prisma
   # or
   hypergen nextjs config drizzle
   ```

2. **shadcn/ui** installed for form components
   ```bash
   hypergen nextjs config shadcn
   ```

3. **TanStack Query** (optional, for client-side data fetching)
   ```bash
   hypergen nextjs config tanstack-query
   ```

## Field Types

CRUD recipes support these field types:

| Type | Component | Validation |
|------|-----------|------------|
| `string` | Input | `z.string()` |
| `text` | Textarea | `z.string()` |
| `number` | Number input | `z.number()` |
| `boolean` | Switch | `z.boolean()` |
| `email` | Email input | `z.string().email()` |
| `url` | URL input | `z.string().url()` |
| `date` | Date picker | `z.date()` |
| `select` | Select dropdown | `z.enum()` |

## Auto-Detection

CRUD recipes can auto-detect database schema:

```bash
# Automatically reads fields from your Prisma schema
hypergen nextjs crud resource --name=post

# Or specify fields manually
hypergen nextjs crud resource --name=post \
  --fields="title:string,content:text,published:boolean"
```

## Best Practices

✅ **Use the `resource` recipe** for complete CRUD workflows
✅ **Configure database first** before generating CRUD pages
✅ **Customize generated code** to fit your specific needs
✅ **Add authorization** to Server Actions for security
✅ **Use soft deletes** for important data
✅ **Add confirmation dialogs** for destructive actions
✅ **Include loading states** for better UX
✅ **Validate on both client and server**

## Integration with Database

### Prisma Example
```typescript
// Server Action generated by CRUD recipe
'use server'

import { prisma } from '@/lib/prisma'
import { postSchema } from '@/lib/schemas/post-schema'

export async function createPost(data: unknown) {
  const validated = postSchema.parse(data)
  return await prisma.post.create({ data: validated })
}
```

### Drizzle Example
```typescript
// Server Action generated by CRUD recipe
'use server'

import { db } from '@/db'
import { posts } from '@/db/schema'
import { postSchema } from '@/lib/schemas/post-schema'

export async function createPost(data: unknown) {
  const validated = postSchema.parse(data)
  return await db.insert(posts).values(validated)
}
```

## Related Cookbooks

- [config](../config/) - Configure database ORM before using CRUD recipes
- [form](../form/) - Generate standalone forms
- [table](../table/) - Generate data tables for list pages
- [action](../action/) - Generate Server Actions
- [api](../api/) - Create REST API routes
