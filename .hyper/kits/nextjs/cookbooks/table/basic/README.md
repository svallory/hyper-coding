# Add Data Table Recipe

Generate a basic TanStack Table with client-side pagination, type-safe columns, and shadcn/ui styling.

## Usage

```bash
hypergen nextjs table add --name UsersTable --columns "id:ID:string,name:Name:string,email:Email:string,createdAt:Created:date"
```

Without pagination:

```bash
hypergen nextjs table add \
  --name ProductsTable \
  --columns "sku:SKU:string,name:Name:string,price:Price:number,inStock:In Stock:boolean" \
  --withPagination=false
```

## What It Does

1. **Installs Dependencies** (if not present)
   - `@tanstack/react-table` - Headless table logic
   - shadcn/ui `table` component (via `npx shadcn add table`)
   - shadcn/ui `button` component (if pagination enabled)

2. **Generates TypeScript Types** (`lib/types/[name].ts`)
   - Type-safe row interface
   - Inferred from column definitions
   - Proper type annotations (string, number, boolean, Date)

3. **Generates Column Definitions** (`components/tables/columns.tsx`)
   - Typed column definitions with `ColumnDef<T>`
   - Custom cell renderers for dates, booleans, numbers
   - Proper formatting (date localization, number formatting)

4. **Generates Table Component** (`components/tables/[Name].tsx`)
   - Reusable table component with generic types
   - shadcn/ui Table components for styling
   - Optional pagination controls
   - Empty state handling

## Generated Files

- `lib/types/users-table.ts` - TypeScript type definitions
- `components/tables/columns.tsx` - Column definitions
- `components/tables/UsersTable.tsx` - Table component

## Options

- **`--name`** (required)
  - Table component name in PascalCase
  - Example: `UsersTable`, `ProductsTable`, `OrdersTable`

- **`--columns`** (required)
  - Comma-separated list of columns in format `key:label:type`
  - Example: `"id:ID:string,email:Email:string,age:Age:number"`

- **`--dir`** (default: `components/tables`)
  - Output directory for table component

- **`--withPagination`** (default: `true`)
  - Include pagination controls

- **`--pageSize`** (default: `10`)
  - Default number of rows per page

## Supported Column Types

| Type | TypeScript Type | Cell Renderer |
|------|----------------|---------------|
| `string` | `string` | Plain text |
| `number` | `number` | `toLocaleString()` formatting |
| `boolean` | `boolean` | ✓ / ✗ checkmarks |
| `date` | `Date` | `Intl.DateTimeFormat` (e.g. "Jan 15, 2024") |

## Usage Examples

### Basic Usage

```tsx
import { UsersTable } from '@/components/tables/UsersTable'
import { columns } from '@/components/tables/columns'

export default function UsersPage() {
  const users = [
    {
      id: '1',
      name: 'John Doe',
      email: 'john@example.com',
      createdAt: new Date('2024-01-15')
    },
    // More users...
  ]

  return (
    <div className="container mx-auto py-10">
      <UsersTable columns={columns} data={users} />
    </div>
  )
}
```

### With Server Component Data Fetching

```tsx
import { UsersTable } from '@/components/tables/UsersTable'
import { columns } from '@/components/tables/columns'

async function getUsers() {
  const res = await fetch('https://api.example.com/users')
  return res.json()
}

export default async function UsersPage() {
  const users = await getUsers()

  return (
    <div className="container mx-auto py-10">
      <h1 className="text-3xl font-bold mb-6">Users</h1>
      <UsersTable columns={columns} data={users} />
    </div>
  )
}
```

### With Loading State

```tsx
import { Suspense } from 'react'
import { UsersTable } from '@/components/tables/UsersTable'
import { columns } from '@/components/tables/columns'

async function UsersTableWithData() {
  const users = await getUsers()
  return <UsersTable columns={columns} data={users} />
}

export default function UsersPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <UsersTableWithData />
    </Suspense>
  )
}
```

## Customization

### Add Custom Column Renderer

Edit `components/tables/columns.tsx`:

```tsx
{
  accessorKey: 'status',
  header: 'Status',
  cell: ({ row }) => {
    const status = row.getValue('status') as string
    return (
      <span
        className={cn(
          'px-2 py-1 rounded-full text-xs font-medium',
          status === 'active' && 'bg-green-100 text-green-800',
          status === 'inactive' && 'bg-gray-100 text-gray-800'
        )}
      >
        {status}
      </span>
    )
  },
}
```

### Customize Pagination

Edit the table component to change pagination behavior:

```tsx
initialState: {
  pagination: {
    pageSize: 20, // Show 20 rows per page
  },
}
```

### Add Page Size Selector

```tsx
<select
  value={table.getState().pagination.pageSize}
  onChange={(e) => table.setPageSize(Number(e.target.value))}
>
  <option value={10}>10</option>
  <option value={20}>20</option>
  <option value={50}>50</option>
</select>
```

### Style Table Rows

```tsx
<TableRow
  key={row.id}
  className="hover:bg-muted/50 cursor-pointer"
  onClick={() => router.push(`/users/${row.original.id}`)}
>
```

## Next Steps

Once you have a basic table, enhance it with:

- **Sorting**: `hypergen nextjs table add-sortable`
- **Filtering**: `hypergen nextjs table add-filterable`
- **Server-side features**: `hypergen nextjs table add-server`
- **CRUD actions**: `hypergen nextjs table add-crud`

## Best Practices

✅ **Use TypeScript types** - Leverage the generated types for type safety
✅ **Memoize data** - Use `useMemo` if computing data in client components
✅ **Server-side render when possible** - Fetch data in Server Components
✅ **Handle empty states** - Provide helpful messages when no data
✅ **Add loading states** - Use Suspense for async data fetching
✅ **Keep columns focused** - Don't show too many columns at once
✅ **Use proper formatters** - Date/number formatting for better UX

## Troubleshooting

### Columns not rendering

1. Verify column data matches the type definition
2. Check that `accessorKey` matches your data object keys
3. Ensure data is an array

### Pagination not working

1. Check that `withPagination` was set to `true`
2. Verify `getPaginationRowModel` is included in table options
3. Ensure Button component is installed

### TypeScript errors

1. Run `bun run build` to regenerate types
2. Ensure data matches the generated row interface
3. Check that column types match actual data types

## Related Recipes

- `data-table/add-sortable` - Add multi-column sorting
- `data-table/add-filterable` - Add column filtering
- `data-table/add-server` - Server-side pagination/sorting/filtering
- `data-table/add-crud` - Inline edit/delete actions

## Resources

- **TanStack Table**: https://tanstack.com/table/latest
- **shadcn/ui Table**: https://ui.shadcn.com/docs/components/table
- **TanStack Table Examples**: https://tanstack.com/table/latest/docs/examples/react/basic
