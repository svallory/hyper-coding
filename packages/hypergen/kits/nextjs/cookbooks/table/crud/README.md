# Add CRUD Data Table Recipe

Generate a TanStack Table with inline edit/delete actions, confirmation dialogs, and optimistic updates.

## Usage

```bash
hypergen nextjs table add-crud \
  --name UsersTable \
  --columns "id:ID:string,name:Name:string,email:Email:string,role:Role:string"
```

Without edit:

```bash
hypergen nextjs table add-crud \
  --name UsersTable \
  --columns "id:ID:string,name:Name:string" \
  --withEdit=false
```

## Features

- Edit button (navigates to edit page)
- Delete button with confirmation dialog
- Optimistic updates (instant UI feedback)
- Server Actions integration
- Actions dropdown menu per row
- Toast notifications (requires `sonner`)

## Generated Files

- `lib/types/users-table.ts` - TypeScript types
- `components/tables/columns.tsx` - Column definitions with actions
- `components/tables/UsersTable.tsx` - Table component
- `components/tables/delete-dialog.tsx` - Delete confirmation dialog
- `app/actions/users-table-actions.ts` - Server Actions (TODO: implement)

## Installation

This recipe uses `sonner` for toast notifications:

```bash
bun add sonner
npx shadcn@latest add sonner
```

Add to your root layout:

```tsx
import { Toaster } from '@/components/ui/sonner'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
```

## Usage Example

```tsx
import { UsersTable } from '@/components/tables/UsersTable'

export default async function UsersPage() {
  const users = await getUsers() // Your data fetching

  return (
    <div className="container mx-auto py-10">
      <UsersTable data={users} />
    </div>
  )
}
```

## Implement Server Actions

Edit `app/actions/users-table-actions.ts`:

```ts
'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

export async function deleteUser(id: string) {
  try {
    await prisma.user.delete({ where: { id } })
    revalidatePath('/users')
    return { success: true }
  } catch (error) {
    return { success: false, error: 'Failed to delete user' }
  }
}

export async function updateUser(id: string, data: any) {
  try {
    await prisma.user.update({ where: { id }, data })
    revalidatePath('/users')
    return { success: true }
  } catch (error) {
    return { success: false, error: 'Failed to update user' }
  }
}
```

## Customization

### Change Edit Behavior

Instead of navigating to edit page, open a dialog:

```tsx
const [editItem, setEditItem] = useState<UsersTableRow | null>(null)

const handleEdit = (row: UsersTableRow) => {
  setEditItem(row) // Open edit dialog
}
```

### Add More Actions

```tsx
<DropdownMenuItem onClick={() => handleDuplicate(row)}>
  <Copy className="mr-2 h-4 w-4" />
  Duplicate
</DropdownMenuItem>
```

### Custom Delete Confirmation

Edit `delete-dialog.tsx` to show item-specific info:

```tsx
<AlertDialogDescription>
  Delete user "{item.name}"? This cannot be undone.
</AlertDialogDescription>
```

## Related Recipes

- `data-table/add` - Basic table
- `data-table/add-server` - Server-side pagination/sorting
- `forms/add-rhf` - Form for editing rows

## Resources

- **TanStack Table**: https://tanstack.com/table/latest
- **Server Actions**: https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions
- **Sonner**: https://sonner.emilkowal.ski/
