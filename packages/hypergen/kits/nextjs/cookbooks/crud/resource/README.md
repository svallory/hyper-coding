# CRUD Resource Recipe

> **The flagship recipe** - Generate complete full-stack CRUD workflows in 5 minutes instead of 60-120 minutes.

## Overview

This recipe generates a production-ready CRUD (Create, Read, Update, Delete) resource with all necessary files:

- **Pages**: List, Detail, Create, Edit
- **Components**: Data Table, Form, Delete Dialog
- **Server Actions**: Complete CRUD operations
- **Validation**: Type-safe Zod schemas
- **Features**: Sorting, filtering, pagination, optimistic updates

**Time saved**: 60-120 min → 5 min (**12-24x faster**)

## Generated Files

### Pages (4 files)
- `app/[resource]/page.tsx` - List page with data table
- `app/[resource]/[id]/page.tsx` - Detail view
- `app/[resource]/[id]/edit/page.tsx` - Edit page with form
- `app/[resource]/new/page.tsx` - Create page with form

### Components (3 files)
- `components/[Resource]Table.tsx` - Data table with sorting/filtering/pagination
- `components/[Resource]Form.tsx` - Reusable create/edit form
- `components/[Resource]DeleteDialog.tsx` - Delete confirmation dialog

### Server Layer (2 files)
- `app/actions/[resource].ts` - All CRUD Server Actions
- `lib/schemas/[resource]-schema.ts` - Zod validation schemas

## Usage

### Basic Usage

```bash
hypergen nextjs:crud/resource
# Prompts:
# - Resource name (singular): post
# - Fields: title:string,content:text,published:boolean
```

### With Auto-Detection

If you have Prisma or Drizzle configured, the recipe will auto-detect your schema:

```bash
hypergen nextjs:crud/resource --name=post
# Automatically detects fields from your Prisma/Drizzle schema
```

### All Options

```bash
hypergen nextjs:crud/resource \
  --name=post \
  --model=BlogPost \
  --fields="title:string,content:text,published:boolean" \
  --useServerActions=true \
  --includePagination=true \
  --includeSorting=true \
  --includeFiltering=true \
  --includeDelete=true
```

## Field Types

Supported field types:

| Type | Input Component | Validation |
|------|----------------|------------|
| `string` | Text input | `z.string()` |
| `text` | Textarea | `z.string()` |
| `number`, `int`, `float` | Number input | `z.number()` |
| `boolean` | Switch | `z.boolean()` |
| `date`, `datetime` | Date input | `z.date()` |
| `email` | Email input | `z.string().email()` |
| `url` | URL input | `z.string().url()` |
| `json` | Textarea | `z.any()` |

## Architecture

### Request Flow

```
List Page (Server Component)
  ↓
  Server Actions (app/actions/[resource].ts)
    ↓
    ORM (Prisma/Drizzle)
      ↓
      Database
```

### Component Hierarchy

```
List Page
  └── [Resource]Table (Client Component)
      └── Shadcn UI Table

Detail Page
  └── [Resource]DeleteDialog (Client Component)

Create/Edit Page
  └── [Resource]Form (Client Component)
      └── React Hook Form + Zod
```

### Data Flow

1. **Server Components** fetch data using Server Actions
2. **Client Components** handle user interactions
3. **Server Actions** validate with Zod and update database
4. **Revalidation** updates cache automatically

## Features

### Data Table
- ✅ Sorting by any column
- ✅ Search/filtering
- ✅ Pagination with page controls
- ✅ Responsive design
- ✅ Empty states

### Form
- ✅ React Hook Form integration
- ✅ Zod validation
- ✅ Field-level error messages
- ✅ Loading states
- ✅ Success/error toasts
- ✅ Auto-redirect after save

### Delete Dialog
- ✅ Confirmation modal
- ✅ Loading state
- ✅ Error handling
- ✅ Auto-redirect after delete

## Customization

### Adding Custom Fields

Edit the generated Zod schema (`lib/schemas/[resource]-schema.ts`):

```typescript
export const postSchema = z.object({
  title: z.string().min(3).max(100),
  content: z.string().min(10),
  published: z.boolean(),
  // Add custom field
  slug: z.string().regex(/^[a-z0-9-]+$/),
})
```

### Adding Relations

In Server Actions (`app/actions/[resource].ts`), include relations:

```typescript
const post = await prisma.post.findUnique({
  where: { id },
  include: {
    author: true,
    comments: true,
  },
})
```

### Custom Validation

Add custom validation to form fields:

```typescript
<FormField
  control={form.control}
  name="email"
  rules={{
    validate: async (value) => {
      const exists = await checkEmailExists(value)
      return !exists || 'Email already taken'
    }
  }}
  render={({ field }) => <Input {...field} />}
/>
```

## ORM Support

### Prisma

Auto-detects models from `prisma/schema.prisma`:

```prisma
model Post {
  id        String   @id @default(cuid())
  title     String
  content   String
  published Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Generates complete Prisma queries in Server Actions.

### Drizzle

Auto-detects schema from Drizzle config:

```typescript
export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  published: boolean('published').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})
```

Generates Drizzle queries (requires manual completion).

## Requirements

### Dependencies

The recipe auto-installs missing dependencies:

```json
{
  "dependencies": {
    "zod": "^3.22.4",
    "react-hook-form": "^7.49.3",
    "@hookform/resolvers": "^3.3.4"
  }
}
```

### shadcn/ui Components

Required shadcn/ui components (install separately):

```bash
npx shadcn-ui@latest add button
npx shadcn-ui@latest add input
npx shadcn-ui@latest add textarea
npx shadcn-ui@latest add switch
npx shadcn-ui@latest add form
npx shadcn-ui@latest add table
npx shadcn-ui@latest add alert-dialog
npx shadcn-ui@latest add toast
```

## Examples

### Blog Posts

```bash
hypergen nextjs:crud/resource --name=post \
  --fields="title:string,content:text,published:boolean,publishedAt:date"
```

### Products

```bash
hypergen nextjs:crud/resource --name=product \
  --fields="name:string,description:text,price:number,inStock:boolean"
```

### Users

```bash
hypergen nextjs:crud/resource --name=user \
  --fields="email:email,name:string,bio:text,active:boolean"
```

## Next Steps

After generating:

1. **Review generated files** - Customize as needed
2. **Update database schema** - Add migrations
3. **Add authentication** - Protect routes
4. **Customize UI** - Match your design
5. **Add tests** - Test CRUD operations

## Troubleshooting

### Missing Components

If shadcn/ui components are missing:

```bash
npx shadcn-ui@latest add button input textarea switch form table alert-dialog toast
```

### TypeScript Errors

If you see type errors, make sure your database types are generated:

```bash
# Prisma
npx prisma generate

# Drizzle
bun run db:generate
```

### Database Not Configured

If you see "Database not configured", initialize your ORM:

```bash
# Prisma
hypergen nextjs:database/prisma-init

# Drizzle
hypergen nextjs:database/drizzle-init
```

## Related Recipes

- `database/prisma-init` - Initialize Prisma ORM
- `database/drizzle-init` - Initialize Drizzle ORM
- `forms/add` - Add standalone forms
- `data-table/add` - Add standalone data tables
- `ui/shadcn-init` - Initialize shadcn/ui

## Contributing

Found a bug or have a suggestion? Please open an issue or PR.

## License

MIT
