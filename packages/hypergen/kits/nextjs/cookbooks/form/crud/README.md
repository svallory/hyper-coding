# Add CRUD Form Recipe

Generate type-safe create/edit forms automatically from your database models. Auto-detects Prisma or Drizzle schema and generates forms with validation, Server Actions, and full CRUD support.

## Usage

Basic usage (generates both create and edit modes):

```bash
hypergen nextjs form add-crud --model User
```

Only create mode:

```bash
hypergen nextjs form add-crud --model Post --mode create
```

Specific fields only:

```bash
hypergen nextjs form add-crud \
  --model Product \
  --fields "name,price,description,category" \
  --excludeFields "id,createdAt,updatedAt,deletedAt"
```

## What It Does

1. **Auto-Detects ORM**
   - Checks for Prisma (`prisma/schema.prisma`)
   - Checks for Drizzle (`db/schema/` or `db/schema.ts`)
   - Exits with helpful message if neither is found

2. **Introspects Database Schema**
   - Reads model/table definition
   - Extracts field types and constraints
   - Identifies relations and special fields (ID, timestamps)

3. **Generates Validation Schema** (`lib/schemas/[model]-schema.ts`)
   - Zod schema mapped from database types
   - Separate schemas for create (required) and update (partial)
   - Type inference for TypeScript

4. **Generates Form Component** (`components/forms/[Model]Form.tsx`)
   - React Hook Form with shadcn/ui
   - Supports both create and edit modes
   - Auto-generates appropriate input types
   - Field-level error display

5. **Generates Server Actions** (optional)
   - `create-[model].ts` - Create new records
   - `update-[model].ts` - Update existing records
   - Type-safe database operations
   - Automatic cache revalidation

## Generated Files

- `components/forms/UserForm.tsx` - Form component
- `lib/schemas/user-schema.ts` - Validation schemas
- `app/actions/create-user.ts` - Create Server Action (if `--mode create` or `both`)
- `app/actions/update-user.ts` - Update Server Action (if `--mode edit` or `both`)

## Options

- **`--model`** (required)
  - Database model name in PascalCase
  - Must exist in Prisma schema or Drizzle tables
  - Example: `User`, `Post`, `Product`, `Order`

- **`--dir`** (default: `components/forms`)
  - Output directory for form component

- **`--actionPath`** (default: `app/actions`)
  - Path to Server Actions directory

- **`--fields`** (optional)
  - Comma-separated list of specific fields to include
  - If not provided, includes all non-relation fields
  - Example: `"name,email,bio,role"`

- **`--excludeFields`** (default: `["id", "createdAt", "updatedAt"]`)
  - Fields to exclude from form
  - Common exclusions: ID, timestamps, soft delete flags
  - Example: `"id,createdAt,updatedAt,deletedAt"`

- **`--mode`** (default: `both`)
  - `create` - Only create mode
  - `edit` - Only edit mode
  - `both` - Both create and edit modes

- **`--withServerAction`** (default: `true`)
  - Generate Server Actions for database operations
  - Set to `false` if you want to handle submission manually

## Database Type Mapping

### Prisma to Zod

| Prisma Type | Zod Schema | Input Type |
|-------------|------------|------------|
| `String` | `z.string()` | `<Input type="text">` or `<Textarea>` |
| `Int` | `z.number()` | `<Input type="number">` |
| `Float` | `z.number()` | `<Input type="number">` |
| `Boolean` | `z.boolean()` | `<Checkbox>` |
| `DateTime` | `z.date()` | `<Input type="datetime-local">` |
| `Json` | `z.any()` | `<Textarea>` (JSON string) |

### Drizzle to Zod

| Drizzle Type | Zod Schema | Input Type |
|--------------|------------|------------|
| `text`, `varchar` | `z.string()` | `<Input type="text">` or `<Textarea>` |
| `integer`, `int` | `z.number()` | `<Input type="number">` |
| `boolean` | `z.boolean()` | `<Checkbox>` |
| `timestamp`, `date` | `z.date()` | `<Input type="datetime-local">` |
| `json`, `jsonb` | `z.any()` | `<Textarea>` (JSON string) |

## Usage Examples

### Create Form

```tsx
import { UserForm } from '@/components/forms/UserForm'

export default function CreateUserPage() {
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Create User</h1>
      <UserForm
        mode="create"
        onSuccess={(data) => {
          console.log('User created:', data)
          // Redirect or show success message
        }}
      />
    </div>
  )
}
```

### Edit Form

```tsx
import { UserForm } from '@/components/forms/UserForm'
import { getUser } from '@/lib/queries'

export default async function EditUserPage({ params }: { params: { id: string } }) {
  const user = await getUser(params.id)

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Edit User</h1>
      <UserForm
        mode="edit"
        initialData={user}
        onSuccess={(data) => {
          console.log('User updated:', data)
        }}
      />
    </div>
  )
}
```

### Form in Modal/Dialog

```tsx
'use client'

import { useState } from 'react'
import { UserForm } from '@/components/forms/UserForm'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export function CreateUserDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create User</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create New User</DialogTitle>
        </DialogHeader>
        <UserForm
          mode="create"
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
```

### Custom Submit Handler (without Server Action)

Generate form without Server Action:

```bash
hypergen nextjs form add-crud --model Post --withServerAction false
```

Then handle submission manually:

```tsx
'use client'

import { useState } from 'react'
import { PostForm } from '@/components/forms/PostForm'
import { createPost } from '@/lib/api'

export function CreatePostForm() {
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(data: any) {
    try {
      await createPost(data)
      // Show success, redirect, etc.
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      {error && <div className="text-red-500">{error}</div>}
      <PostForm mode="create" onSuccess={handleSubmit} />
    </>
  )
}
```

## Customization

### Add Custom Validation

Edit the generated schema:

```typescript
// lib/schemas/user-schema.ts
export const userSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[0-9]/, 'Must contain number'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  role: z.enum(['user', 'admin', 'moderator']),
})
```

### Customize Input Types

Edit the form component to change input types:

```tsx
// Change from Textarea to Input
<Input
  type="text"
  placeholder="Enter bio..."
  {...field}
/>
```

### Add Select/Dropdown Fields

```tsx
<FormField
  control={form.control}
  name="role"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Role</FormLabel>
      <Select onValueChange={field.onChange} defaultValue={field.value}>
        <FormControl>
          <SelectTrigger>
            <SelectValue placeholder="Select role" />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          <SelectItem value="user">User</SelectItem>
          <SelectItem value="admin">Admin</SelectItem>
          <SelectItem value="moderator">Moderator</SelectItem>
        </SelectContent>
      </Select>
      <FormMessage />
    </FormItem>
  )}
/>
```

### Add File Upload

```tsx
<FormField
  control={form.control}
  name="avatar"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Avatar</FormLabel>
      <FormControl>
        <Input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) {
              // Handle file upload
              field.onChange(file)
            }
          }}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  )}
/>
```

### Handle Relations

For related fields (e.g., selecting a category):

```tsx
<FormField
  control={form.control}
  name="categoryId"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Category</FormLabel>
      <Select onValueChange={field.onChange} defaultValue={field.value}>
        <FormControl>
          <SelectTrigger>
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          {categories.map((cat) => (
            <SelectItem key={cat.id} value={cat.id}>
              {cat.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FormMessage />
    </FormItem>
  )}
/>
```

### Customize Server Actions

Edit the generated action to add custom logic:

```typescript
// app/actions/create-user.ts
export async function createUser(prevState: any, formData: FormData) {
  const parsed = createUserSchema.safeParse(/* ... */)

  if (!parsed.success) {
    return { success: false, error: 'Validation failed', fieldErrors: /* ... */ }
  }

  try {
    // Custom logic before create
    const hashedPassword = await hash(parsed.data.password, 10)

    const user = await prisma.user.create({
      data: {
        ...parsed.data,
        password: hashedPassword,
      },
    })

    // Send welcome email
    await sendWelcomeEmail(user.email)

    // Create audit log
    await createAuditLog('user.created', user.id)

    revalidatePath('/users')
    return { success: true, data: user }
  } catch (error) {
    return { success: false, error: 'Failed to create user' }
  }
}
```

## Best Practices

✅ **Exclude sensitive fields** - Never include password hashes, tokens, or API keys in forms
✅ **Validate on server** - Always validate in Server Actions, not just client-side
✅ **Use optimistic UI** - Show loading states and optimistic updates
✅ **Handle errors gracefully** - Display field-level and general errors
✅ **Add confirmation dialogs** - Confirm destructive actions like delete
✅ **Implement authorization** - Check user permissions before allowing edits
✅ **Sanitize user input** - Prevent XSS and SQL injection
✅ **Use transactions** - Wrap related operations in database transactions

## Troubleshooting

### Model not found

```
Error: Model 'User' not found in schema
```

**Solution:**
1. Verify model name matches exactly (case-sensitive)
2. Check that Prisma schema is generated: `bunx prisma generate`
3. For Drizzle, ensure schema files are in correct location

### Type errors in generated code

**Solution:**
1. Run `bun run build` to check TypeScript errors
2. Ensure ORM types are generated:
   - Prisma: `bunx prisma generate`
   - Drizzle: `bun run db:generate`
3. Check that `@/lib/db` export matches your setup

### Server Action not working

**Solution:**
1. Verify `'use server'` directive at top of action file
2. Check that action is exported and imported correctly
3. Ensure database client (`prisma` or `db`) is properly initialized
4. Test action in isolation with console.log

### Form not submitting

**Solution:**
1. Check browser console for validation errors
2. Verify all required fields are filled
3. Ensure schema validation matches form fields
4. Test with `console.log` in submit handler

## Related Recipes

- `forms/add` - Basic form without React Hook Form
- `forms/add-rhf` - Form with React Hook Form (manual fields)
- `forms/add-server-action` - Server Action-focused form
- `crud/resource` - Full CRUD workflow (list + create + edit + delete)
- `config/prisma` - Initialize Prisma ORM
- `config/drizzle` - Initialize Drizzle ORM
- `config/all` - Interactive wizard to configure entire stack

## Resources

- **React Hook Form**: https://react-hook-form.com/
- **Zod**: https://zod.dev/
- **Prisma**: https://www.prisma.io/docs/
- **Drizzle**: https://orm.drizzle.team/
- **Next.js Server Actions**: https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations
