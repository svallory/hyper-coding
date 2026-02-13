# Add Filterable Data Table Recipe

Generate a TanStack Table with global search and column-specific filtering.

## Usage

```bash
hypergen nextjs table add-filterable \
  --name UsersTable \
  --columns "id:ID:string:false,name:Name:string:true,email:Email:string:true,role:Role:string:true"
```

## Column Format

`key:label:type:filterable`

Example: `"email:Email:string:true"` - Enable filtering on email column

## Features

- Global search across all columns
- Column-specific filter inputs
- Clear all filters button
- Real-time filtering
- Shows filtered row count

## Generated Files

- `lib/types/users-table.ts`
- `components/tables/columns.tsx`
- `components/tables/UsersTable.tsx`

## Example

```tsx
import { UsersTable } from '@/components/tables/UsersTable'
import { columns } from '@/components/tables/columns'

export default function Page() {
  const data = [
    { id: '1', name: 'Alice', email: 'alice@example.com', role: 'admin' },
    { id: '2', name: 'Bob', email: 'bob@example.com', role: 'user' },
  ]

  return <UsersTable columns={columns} data={data} />
}
```

## Customization

### Debounced Search

```tsx
import { useDebouncedValue } from '@/hooks/use-debounced-value'

const [search, setSearch] = useState('')
const debouncedSearch = useDebouncedValue(search, 300)

<Input value={search} onChange={(e) => setSearch(e.target.value)} />
```

### Custom Filter Function

```tsx
{
  accessorKey: 'status',
  filterFn: (row, id, filterValue) => {
    return row.getValue(id) === filterValue
  },
}
```

## Resources

- **TanStack Table Filtering**: https://tanstack.com/table/latest/docs/guide/filters
