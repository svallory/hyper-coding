# TanStack Query Recipe

Setup TanStack Query (React Query) for powerful server state management in your Next.js App Router project.

## Usage

```bash
hypergen nextjs state tanstack-query
```

Or with options:

```bash
hypergen nextjs state tanstack-query --withDevtools --withPersister
```

## What It Does

1. **Installs Dependencies**
   - `@tanstack/react-query` - Core library
   - `@tanstack/react-query-devtools` (optional) - Developer tools
   - `@tanstack/react-query-persist-client` (optional) - Offline persistence

2. **Creates Provider Setup**
   - `components/providers/query-provider.tsx` - Client-side provider
   - `lib/query-client.ts` - Singleton query client with optimized defaults

3. **Generates Example Hooks**
   - `hooks/use-example-query.ts` - Query examples (fetch, paginated, by ID)
   - `hooks/use-example-mutation.ts` - Mutation examples (create, update, delete, optimistic)

## Generated Files

- `components/providers/query-provider.tsx` - Provider component
- `lib/query-client.ts` - Query client configuration
- `hooks/use-example-query.ts` - Example query hooks
- `hooks/use-example-mutation.ts` - Example mutation hooks

## Options

- **`--withDevtools`** (default: `true`)
  - Install React Query Devtools for debugging
  - Shows queries, mutations, and cache in dev mode

- **`--withPersister`** (default: `false`)
  - Setup query persistence for offline support
  - Saves query cache to localStorage/IndexedDB

## Next Steps

After running this recipe:

1. **Add Provider to Layout**

```tsx
// app/layout.tsx
import { QueryProvider } from '@/components/providers/query-provider'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
```

2. **Create Custom Query Hooks**

```tsx
// hooks/use-users.ts
import { useQuery } from '@tanstack/react-query'

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/users')
      return res.json()
    },
  })
}
```

3. **Use in Components**

```tsx
'use client'

import { useUsers } from '@/hooks/use-users'

export function UsersList() {
  const { data, isLoading, error } = useUsers()

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>

  return (
    <ul>
      {data.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  )
}
```

## Query Patterns

### Basic Query

```tsx
export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  })
}
```

### Dependent Query

```tsx
export function useUserPosts(userId: string) {
  return useQuery({
    queryKey: ['users', userId, 'posts'],
    queryFn: () => fetchUserPosts(userId),
    enabled: !!userId, // Only run if userId exists
  })
}
```

### Paginated Query

```tsx
export function useUsersPaginated(page: number) {
  return useQuery({
    queryKey: ['users', 'paginated', page],
    queryFn: () => fetchUsers(page),
    placeholderData: (prev) => prev, // Keep old data while loading
  })
}
```

### Infinite Query

```tsx
import { useInfiniteQuery } from '@tanstack/react-query'

export function useInfiniteUsers() {
  return useInfiniteQuery({
    queryKey: ['users', 'infinite'],
    queryFn: ({ pageParam = 1 }) => fetchUsers(pageParam),
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 1,
  })
}
```

## Mutation Patterns

### Basic Mutation

```tsx
export function useCreateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

// Usage
const createUserMutation = useCreateUser()
createUserMutation.mutate({ name: 'John', email: 'john@example.com' })
```

### Optimistic Updates

```tsx
export function useUpdateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateUser,
    onMutate: async (newUser) => {
      await queryClient.cancelQueries({ queryKey: ['users', newUser.id] })
      const previous = queryClient.getQueryData(['users', newUser.id])
      queryClient.setQueryData(['users', newUser.id], newUser)
      return { previous }
    },
    onError: (err, newUser, context) => {
      queryClient.setQueryData(['users', newUser.id], context?.previous)
    },
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users', variables.id] })
    },
  })
}
```

### Server Actions Integration

```tsx
'use server'

import { revalidatePath } from 'next/cache'

export async function createUserAction(formData: FormData) {
  // Server logic
  const user = await db.user.create({ ... })

  revalidatePath('/users')
  return user
}

// Client component
'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createUserAction } from './actions'

export function useCreateUserAction() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createUserAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}
```

## Devtools

When `--withDevtools` is enabled, the React Query Devtools appear in the bottom-left corner in development mode.

**Features**:
- View all queries and their state
- Inspect query data
- Manually trigger refetches
- See query timelines
- Debug cache behavior

## Configuration

Default query client settings (in `lib/query-client.ts`):

```ts
{
  queries: {
    staleTime: 60 * 1000,        // 1 minute
    gcTime: 5 * 60 * 1000,       // 5 minutes
    retry: 1,                     // Retry failed queries once
    refetchOnWindowFocus: false,  // Don't refetch on window focus
  },
  mutations: {
    retry: 0,  // Don't retry failed mutations
  },
}
```

Customize as needed for your use case.

## Best Practices

✅ **Use query keys consistently** - `['resource', 'action', ...params]`
✅ **Invalidate queries after mutations** - Keep cache fresh
✅ **Use optimistic updates** - Better UX for mutations
✅ **Enable queries conditionally** - `enabled: !!id`
✅ **Handle loading and error states** - Always check `isLoading` and `error`
✅ **Use placeholderData for pagination** - Smoother transitions
✅ **Leverage staleTime and gcTime** - Optimize refetching
✅ **Use Devtools in development** - Debug query behavior

## Integration with Next.js

### Server Components + Client Components

```tsx
// app/users/page.tsx (Server Component)
import { db } from '@/lib/db'
import { UsersList } from './users-list'

export default async function UsersPage() {
  const users = await db.user.findMany()

  return <UsersList initialData={users} />
}

// app/users/users-list.tsx (Client Component)
'use client'

import { useQuery } from '@tanstack/react-query'

export function UsersList({ initialData }) {
  const { data } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
    initialData, // Hydrate from server
  })

  return <ul>{/* render users */}</ul>
}
```

## Related Recipes

- `state/zustand-store` - Add Zustand for client state
- `state/context` - Create React Context providers
- `hooks/add-query` - Generate custom query hooks
- `hooks/add-mutation` - Generate custom mutation hooks

## Resources

- **TanStack Query Docs**: https://tanstack.com/query/latest
- **React Query Patterns**: https://tkdodo.eu/blog/practical-react-query
- **Next.js Integration**: https://tanstack.com/query/latest/docs/framework/react/guides/ssr
