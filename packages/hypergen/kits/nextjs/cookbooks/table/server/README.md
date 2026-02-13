# Add Server-Side Data Table Recipe

Generate a TanStack Table with server-side pagination, sorting, and filtering. Uses React Query for data fetching and loading states.

## Usage

```bash
hypergen nextjs table add-server \
  --name UsersTable \
  --columns "id:ID:string:true:false,name:Name:string:true:true,email:Email:string:true:true" \
  --apiEndpoint "/api/users"
```

## Column Format

`key:label:type:sortable:filterable`

## Expected API Response

Your API endpoint should return:

```json
{
  "data": [{ "id": "1", "name": "Alice", "email": "alice@example.com" }],
  "total": 100,
  "page": 1,
  "pageSize": 10
}
```

## Query Parameters

The table sends these params:
- `page` - Current page number
- `pageSize` - Rows per page
- `sortBy` - Column to sort by
- `sortOrder` - `asc` or `desc`
- `filter[column]` - Filter values

## Features

- Server-side pagination
- Server-side sorting
- Loading skeleton states
- React Query integration
- Optimistic updates

## Example API Route

```ts
// app/api/users/route.ts
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const pageSize = parseInt(searchParams.get('pageSize') || '10')
  const sortBy = searchParams.get('sortBy')
  const sortOrder = searchParams.get('sortOrder') || 'asc'

  const users = await db.user.findMany({
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: sortBy ? { [sortBy]: sortOrder } : undefined,
  })

  const total = await db.user.count()

  return Response.json({ data: users, total, page, pageSize })
}
```

## Resources

- **TanStack Table Server-Side**: https://tanstack.com/table/latest/docs/guide/pagination#manual-server-side-pagination
- **React Query**: https://tanstack.com/query/latest
