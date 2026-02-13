# Data Table Cookbook

Generate production-ready TanStack Table data tables with sorting, filtering, pagination, and CRUD operations.

## Quick Start

```bash
# Basic table
hypergen nextjs table basic --name UsersTable --columns "id:ID:string,name:Name:string,email:Email:string"

# With sorting
hypergen nextjs table sortable --name UsersTable --columns "id:ID:string:true,name:Name:string:true"

# With filtering
hypergen nextjs table filterable --name UsersTable --columns "name:Name:string:true,email:Email:string:true"

# Server-side table
hypergen nextjs table server --name UsersTable --columns "name:Name:string:true:true" --apiEndpoint "/api/users"

# With CRUD actions
hypergen nextjs table crud --name UsersTable --columns "id:ID:string,name:Name:string,email:Email:string"
```

## Recipes

### 1. add - Basic TanStack Table
**Time Saved:** 15-20 min → 30 sec (30-40x faster)

Generate a client-side table with pagination and type-safe columns.

**Features:**
- Client-side pagination
- Type-safe column definitions
- Custom cell renderers (dates, numbers, booleans)
- shadcn/ui styling

**See:** [add/README.md](./add/README.md)

---

### 2. sortable - With Sorting
**Time Saved:** 10-15 min → 30 sec (20-30x faster)

Add multi-column sorting with visual indicators.

**Features:**
- Click column headers to sort
- Multi-column sorting (Shift + click)
- Sort indicators (↑↓)
- Toggle asc/desc/none

**See:** [sortable/README.md](./sortable/README.md)

---

### 3. filterable - With Filtering
**Time Saved:** 15-20 min → 30 sec (30-40x faster)

Add global search and column-specific filters.

**Features:**
- Global search input
- Column-specific filters
- Clear all filters button
- Filtered row count

**See:** [filterable/README.md](./filterable/README.md)

---

### 4. server - Server-Side Table
**Time Saved:** 30-45 min → 2 min (15-22x faster)

Generate a table with server-side pagination, sorting, and filtering.

**Features:**
- Server-side pagination
- Server-side sorting/filtering
- React Query integration
- Loading skeleton states
- URL query params

**See:** [server/README.md](./server/README.md)

---

### 5. crud - With Inline CRUD
**Time Saved:** 45-60 min → 2 min (22-30x faster)

Add edit/delete buttons with confirmation dialogs and optimistic updates.

**Features:**
- Edit button per row
- Delete with confirmation
- Actions dropdown menu
- Optimistic updates
- Server Actions integration
- Toast notifications

**See:** [crud/README.md](./crud/README.md)

---

## Column Format

### Basic Table
```
"key:label:type"
# Example: "email:Email:string"
```

### Sortable Table
```
"key:label:type:sortable"
# Example: "email:Email:string:true"
```

### Filterable Table
```
"key:label:type:filterable"
# Example: "name:Name:string:true"
```

### Server-Side Table
```
"key:label:type:sortable:filterable"
# Example: "email:Email:string:true:true"
```

## Supported Data Types

| Type | TypeScript | Cell Renderer |
|------|-----------|---------------|
| `string` | `string` | Plain text |
| `number` | `number` | `toLocaleString()` (e.g., "1,234") |
| `boolean` | `boolean` | ✓ / ✗ checkmarks |
| `date` | `Date` | `Intl.DateTimeFormat` (e.g., "Jan 15, 2024") |

## Progressive Enhancement

Start simple and add features as needed:

1. **add** → Basic table with pagination
2. **sortable** → Add sorting capabilities
3. **filterable** → Add search and filters
4. **server** → Move to server-side for large datasets
5. **crud** → Add edit/delete actions

## Dependencies

All recipes automatically install required dependencies:

- `@tanstack/react-table` - Core table logic
- `lucide-react` - Icons (sortable, filterable, crud)
- `@tanstack/react-query` - Data fetching (server)
- `sonner` - Toasts (crud)

shadcn/ui components installed as needed:
- `table`, `button`, `input`, `skeleton`, `dropdown-menu`, `dialog`

## Example Usage

### Client-Side Table

```tsx
import { UsersTable } from '@/components/tables/UsersTable'
import { columns } from '@/components/tables/columns'

export default function UsersPage() {
  const users = [
    { id: '1', name: 'Alice', email: 'alice@example.com', createdAt: new Date() },
    { id: '2', name: 'Bob', email: 'bob@example.com', createdAt: new Date() },
  ]

  return <UsersTable columns={columns} data={users} />
}
```

### Server-Side Table

```tsx
import { UsersTable } from '@/components/tables/UsersTable'
import { columns } from '@/components/tables/columns'

export default function UsersPage() {
  // Data fetched via React Query hook
  return <UsersTable columns={columns} />
}
```

### With CRUD Actions

```tsx
import { UsersTable } from '@/components/tables/UsersTable'

export default async function UsersPage() {
  const users = await getUsers()
  return <UsersTable data={users} />
}
```

## Best Practices

✅ **Use TypeScript types** - Leverage generated types for safety
✅ **Server-side for large datasets** - Use server for 1000+ rows
✅ **Memoize data** - Use `useMemo` in client components
✅ **Handle empty states** - Provide helpful messages
✅ **Add loading states** - Use Suspense for async fetching
✅ **Keep columns focused** - Show only necessary columns
✅ **Use proper formatters** - Format dates/numbers properly

## Customization

Each recipe generates fully customizable code:

- Modify column definitions in `columns.tsx`
- Customize table component in `[Name].tsx`
- Add custom cell renderers
- Change pagination settings
- Adjust filter behavior
- Customize action buttons

## Time Savings

| Recipe | Manual | Generated | Speedup |
|--------|--------|-----------|---------|
| add | 15-20 min | 30 sec | 30-40x |
| sortable | 10-15 min | 30 sec | 20-30x |
| filterable | 15-20 min | 30 sec | 30-40x |
| server | 30-45 min | 2 min | 15-22x |
| crud | 45-60 min | 2 min | 22-30x |
| **Total** | **2-2.5 hours** | **5.5 min** | **22-27x** |

## Resources

- **TanStack Table**: https://tanstack.com/table/latest
- **shadcn/ui Table**: https://ui.shadcn.com/docs/components/table
- **React Query**: https://tanstack.com/query/latest
- **Sonner**: https://sonner.emilkowal.ski/

## Troubleshooting

### Columns not rendering
- Verify column keys match data object keys
- Check TypeScript types match actual data

### Pagination not working
- Ensure `withPagination` is `true`
- Check Button component is installed

### Server-side table not loading
- Verify API endpoint returns correct format
- Check React Query is configured in layout
- Ensure QueryClientProvider wraps app

### CRUD actions not working
- Implement Server Actions in generated file
- Add Toaster to root layout
- Check sonner is installed

## Support

For issues, examples, or questions:
- Check individual recipe READMEs
- Review TanStack Table documentation
- Examine generated code for patterns
- Modify templates as needed

---

**Total Recipes:** 5
**Total Templates:** 18
**Lines of Code:** 2,474
**Time Savings:** 2-2.5 hours → 5.5 minutes
