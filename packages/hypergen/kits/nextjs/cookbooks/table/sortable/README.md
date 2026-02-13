# Add Sortable Data Table Recipe

Generate a TanStack Table with multi-column sorting, sort indicators, and click-to-sort headers.

## Usage

```bash
hypergen nextjs table add-sortable \
  --name UsersTable \
  --columns "id:ID:string:true,name:Name:string:true,email:Email:string:true,createdAt:Created:date:true"
```

Enable single-column sorting only:

```bash
hypergen nextjs table add-sortable \
  --name ProductsTable \
  --columns "sku:SKU:string:true,name:Name:string:true,price:Price:number:true" \
  --multiSort=false
```

## Column Format

Columns use format: `key:label:type:sortable`

- **key**: Field name (e.g. `id`, `email`)
- **label**: Display name (e.g. `ID`, `Email`)
- **type**: Data type (`string`, `number`, `boolean`, `date`)
- **sortable**: `true` to enable sorting, `false` to disable

## Features

- Click column headers to sort ascending
- Click again to sort descending
- Click third time to clear sort
- Sort indicators (↑↓) in headers
- Multi-column sorting (hold Shift + click)
- Type-aware sorting (dates, numbers, strings)

## Generated Files

- `lib/types/users-table.ts` - TypeScript types
- `components/tables/columns.tsx` - Sortable column definitions
- `components/tables/UsersTable.tsx` - Table component with sorting

## Usage Example

```tsx
import { UsersTable } from '@/components/tables/UsersTable'
import { columns } from '@/components/tables/columns'

export default function UsersPage() {
  const users = [
    { id: '1', name: 'Alice', email: 'alice@example.com', createdAt: new Date('2024-01-15') },
    { id: '2', name: 'Bob', email: 'bob@example.com', createdAt: new Date('2024-02-20') },
  ]

  return <UsersTable columns={columns} data={users} />
}
```

## Customization

### Default Sort Order

```tsx
const [sorting, setSorting] = useState<SortingState>([
  { id: 'createdAt', desc: true } // Sort by date descending
])
```

### Custom Sort Function

```tsx
{
  accessorKey: 'status',
  header: 'Status',
  sortingFn: (rowA, rowB) => {
    const order = { active: 0, pending: 1, inactive: 2 }
    return order[rowA.original.status] - order[rowB.original.status]
  },
}
```

## Related Recipes

- `data-table/add` - Basic table without sorting
- `data-table/add-filterable` - Add column filtering
- `data-table/add-server` - Server-side sorting

## Resources

- **TanStack Table Sorting**: https://tanstack.com/table/latest/docs/guide/sorting
