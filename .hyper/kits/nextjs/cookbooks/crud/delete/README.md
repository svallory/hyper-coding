# CRUD Delete Recipe

Generate delete functionality with confirmation dialog, Server Action, and optimistic updates.

## Features

- **Confirmation Dialog** prevents accidental deletions
- **Loading State** during deletion
- **Toast Notifications** for success/error feedback
- **Auto-redirect** to list page after deletion
- **Server Action** with database deletion

## Generated Files

1. **Delete Dialog**: `components/[Resource]DeleteDialog.tsx`
2. **Delete Server Action**: `app/actions/[resource].ts` (delete function)

## Usage

```bash
hypergen nextjs:crud/delete --name=post
```

## Integration

Use the dialog in your detail or list pages:

```tsx
import { PostDeleteDialog } from '@/components/PostDeleteDialog'

// In detail page
<PostDeleteDialog id={post.id} />

// In table row
data.map((post) => (
  <TableRow key={post.id}>
    {/* ... */}
    <TableCell>
      <PostDeleteDialog id={post.id} />
    </TableCell>
  </TableRow>
))
```

## Requirements

```bash
npx shadcn-ui@latest add alert-dialog button toast
```

## Related Recipes

- `crud/detail-page` - Includes delete dialog by default
- `crud/resource` - Complete CRUD with delete

## License

MIT
