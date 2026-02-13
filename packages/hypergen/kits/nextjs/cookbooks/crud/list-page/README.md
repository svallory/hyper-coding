# CRUD List Page Recipe

Generate a production-ready list/index page with data table, pagination, search, and filtering for Next.js applications.

## Features

- **Server Component** for optimal performance and SEO
- **Data Table** with sorting, filtering, and pagination
- **Search Functionality** with URL-based state management
- **Link to Create Page** for easy resource creation
- **Auto-detect ORM** (Prisma/Drizzle) and parse schema
- **Responsive Design** with shadcn/ui components
- **Type-safe** with TypeScript

## Generated Files

1. **List Page**: `app/[resource]/page.tsx`
   - Server Component that fetches data
   - Handles search params (page, search, sortBy, sortOrder)
   - Renders data table with metadata

2. **Data Table Component**: `components/[Resource]Table.tsx`
   - Client Component with interactive features
   - Sortable columns
   - Search input with form submission
   - Pagination controls
   - Links to detail and edit pages

3. **Server Actions**: `app/actions/[resource].ts`
   - `get[Resources]()` function with filtering and pagination
   - Auto-configured for Prisma or Drizzle
   - Error handling and logging

## Usage

### Basic Usage

```bash
hypergen nextjs:crud/list-page
# Prompts:
# - Resource name (singular): post
# - Fields: title:string,content:text,published:boolean
```

### With Auto-Detection

If you have Prisma or Drizzle configured, the recipe will auto-detect your schema:

```bash
hypergen nextjs:crud/list-page --name=post
# Automatically detects fields from your Prisma/Drizzle schema
```

### All Options

```bash
hypergen nextjs:crud/list-page \
  --name=post \
  --model=BlogPost \
  --fields="title:string,content:text,published:boolean" \
  --includePagination=true \
  --includeSorting=true \
  --includeFiltering=true
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | *required* | Resource name (singular, e.g., 'post', 'user') |
| `model` | string | PascalCase(name) | Model name (PascalCase) |
| `fields` | string | auto-detect | Comma-separated fields with types |
| `includePagination` | boolean | true | Include pagination controls |
| `includeSorting` | boolean | true | Include column sorting |
| `includeFiltering` | boolean | true | Include search functionality |

## Field Types

The recipe supports automatic field type detection:

| Type | Display | Example |
|------|---------|---------|
| `string` | Plain text | "Hello World" |
| `text` | Plain text | "Long content..." |
| `number` | Number | 42 |
| `boolean` | Yes/No | "Yes" or "No" |
| `date` | Formatted date | "12/31/2023" |

## URL Search Params

The list page uses URL search params for state management:

- `?page=2` - Current page number
- `?search=query` - Search query string
- `?sortBy=title` - Sort by field name
- `?sortOrder=asc` - Sort order (asc/desc)

Example: `/posts?page=2&search=hello&sortBy=title&sortOrder=desc`

## Architecture

### Request Flow

```
User visits /[resource]
  ↓
Server Component fetches searchParams
  ↓
Server Action get[Resources]() called
  ↓
ORM query with filters/pagination
  ↓
Data returned to page
  ↓
[Resource]Table renders data (Client Component)
```

### Component Hierarchy

```
List Page (Server Component)
  └── [Resource]Table (Client Component)
      ├── Search Form
      ├── Data Table
      │   ├── Sortable Headers
      │   ├── Data Rows
      │   └── Action Links (View, Edit)
      └── Pagination Controls
```

## Customization

### Adding Searchable Fields

Edit the generated Server Action to add searchable fields:

```typescript
const where = search
  ? {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
      ],
    }
  : {}
```

### Custom Table Columns

Modify the generated table component to customize columns:

```tsx
// Add custom column
<TableHead>Status</TableHead>

// In table body
<TableCell>
  {post.published ? (
    <Badge variant="success">Published</Badge>
  ) : (
    <Badge variant="secondary">Draft</Badge>
  )}
</TableCell>
```

### Custom Sorting Logic

Modify the `handleSort` function for custom sorting:

```tsx
const handleSort = (column: string) => {
  // Custom sorting logic
  if (column === 'custom') {
    // Handle custom column
  }
  // ...existing logic
}
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

Generates Prisma queries with proper types.

### Drizzle

Auto-detects schema from Drizzle config:

```typescript
export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  published: boolean('published').default(false),
})
```

Generates Drizzle query boilerplate (requires manual completion).

## Requirements

### shadcn/ui Components

Required components (install separately):

```bash
npx shadcn-ui@latest add table button input
```

### Icons

Uses lucide-react icons:

```bash
bun add lucide-react
```

## Examples

### Blog Posts

```bash
hypergen nextjs:crud/list-page --name=post \
  --fields="title:string,content:text,published:boolean"
```

### Products

```bash
hypergen nextjs:crud/list-page --name=product \
  --fields="name:string,price:number,inStock:boolean"
```

### Users

```bash
hypergen nextjs:crud/list-page --name=user \
  --fields="email:string,name:string,active:boolean"
```

## Next Steps

After generating:

1. **Implement Database Query**: Complete the Server Action with proper ORM queries
2. **Add Searchable Fields**: Configure which fields are searchable
3. **Customize Columns**: Adjust table columns to match your needs
4. **Add Filters**: Implement additional filters beyond search
5. **Style Components**: Customize styling to match your design
6. **Add Authentication**: Protect routes with middleware

## Troubleshooting

### Empty Table

If the table shows "No results found":
1. Check that the Server Action is returning data
2. Verify database connection
3. Check Prisma schema or Drizzle config
4. Run `npx prisma generate` (Prisma) or `bun run db:generate` (Drizzle)

### TypeScript Errors

If you see type errors:
1. Generate database types: `npx prisma generate`
2. Check that `@/lib/prisma` or `@/lib/db` exists
3. Verify import paths are correct

### Missing Components

If shadcn/ui components are missing:

```bash
npx shadcn-ui@latest add table button input
```

## Related Recipes

- `crud/detail-page` - Generate detail/show page
- `crud/create-page` - Generate create page with form
- `crud/edit-page` - Generate edit page with form
- `crud/delete` - Generate delete functionality
- `crud/resource` - Generate complete CRUD (orchestrates all)

## Contributing

Found a bug or have a suggestion? Please open an issue or PR.

## License

MIT
