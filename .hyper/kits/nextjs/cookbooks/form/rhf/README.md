# Add React Hook Form Recipe

Generate a type-safe form with React Hook Form, Zod validation, and shadcn/ui components.

## Usage

```bash
hypergen nextjs form add-rhf --name UserForm --fields "name:text,email:email,bio:textarea"
```

With Server Action:

```bash
hypergen nextjs form add-rhf \
  --name UserForm \
  --fields "name:text,email:email,role:select" \
  --withServerAction
```

## What It Does

1. **Installs Dependencies** (if not present)
   - `react-hook-form` - Form state management
   - `zod` - Schema validation
   - `@hookform/resolvers` - React Hook Form + Zod integration
   - shadcn/ui `form` component (via `npx shadcn add form`)

2. **Generates Zod Schema** (`lib/schemas/[name]-schema.ts`)
   - Type-safe validation schema
   - Field-specific validators (email, password, URL, etc.)
   - TypeScript type inference

3. **Generates Form Component** (`components/forms/[Name].tsx`)
   - shadcn/ui Form components
   - React Hook Form integration
   - Proper error handling and display
   - Loading states during submission

4. **Generates Server Action** (optional, `app/actions/[name]-action.ts`)
   - Server-side validation with Zod
   - Type-safe form data extraction
   - Error handling and return types

## Generated Files

- `lib/schemas/user-form-schema.ts` - Zod validation schema
- `components/forms/UserForm.tsx` - Form component
- `app/actions/user-form-action.ts` - Server Action (if `--withServerAction`)

## Options

- **`--name`** (required)
  - Form component name in PascalCase
  - Example: `UserForm`, `ProfileForm`, `ContactForm`

- **`--fields`** (required)
  - Comma-separated list of fields in format `name:type`
  - Example: `"name:text,email:email,age:number"`

- **`--dir`** (default: `components/forms`)
  - Output directory for form component

- **`--withServerAction`** (default: `false`)
  - Generate a Server Action for form submission

- **`--actionPath`** (default: `app/actions`)
  - Path to Server Actions file (only used if `--withServerAction`)

## Supported Field Types

| Type | Input Component | Zod Validator |
|------|----------------|---------------|
| `text` | `<Input type="text">` | `z.string()` |
| `email` | `<Input type="email">` | `z.string().email()` |
| `password` | `<Input type="password">` | `z.string().min(8)` |
| `number` | `<Input type="number">` | `z.number()` |
| `tel` | `<Input type="tel">` | `z.string().regex()` |
| `url` | `<Input type="url">` | `z.string().url()` |
| `date` | `<Input type="date">` | `z.string()` |
| `time` | `<Input type="time">` | `z.string()` |
| `datetime` | `<Input type="datetime-local">` | `z.string()` |
| `textarea` | `<Textarea>` | `z.string()` |
| `select` | `<Select>` | `z.string()` |

## Usage Examples

### Basic Form (Client-Side Submission)

```tsx
'use client'

import { UserForm } from '@/components/forms/UserForm'

export default function Page() {
  async function handleSubmit(values: any) {
    const response = await fetch('/api/users', {
      method: 'POST',
      body: JSON.stringify(values),
    })
    // Handle response
  }

  return <UserForm onSubmit={handleSubmit} />
}
```

### Form with Server Action

```tsx
import { UserForm } from '@/components/forms/UserForm'

export default function Page() {
  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Create User</h1>
      <UserForm />
    </div>
  )
}
```

### Form with Default Values

```tsx
import { UserForm } from '@/components/forms/UserForm'

export default function EditPage() {
  const defaultValues = {
    name: 'John Doe',
    email: 'john@example.com',
  }

  return <UserForm defaultValues={defaultValues} submitLabel="Update" />
}
```

## Customization

### Add Custom Validation

Edit the generated schema file:

```typescript
// lib/schemas/user-form-schema.ts
export const userFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain number'),
})
```

### Add Custom Fields

Edit the generated form component:

```tsx
<FormField
  control={form.control}
  name="customField"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Custom Field</FormLabel>
      <FormControl>
        <Input {...field} />
      </FormControl>
      <FormDescription>Helper text here</FormDescription>
      <FormMessage />
    </FormItem>
  )}
/>
```

### Customize Select Options

```tsx
<SelectContent>
  <SelectItem value="admin">Admin</SelectItem>
  <SelectItem value="user">User</SelectItem>
  <SelectItem value="guest">Guest</SelectItem>
</SelectContent>
```

### Handle Server Action Response

```tsx
'use client'

import { useActionState } from 'react'
import { userFormAction } from '@/app/actions/user-form-action'

export function UserForm() {
  const [state, formAction, isPending] = useActionState(userFormAction, null)

  // Show success message
  if (state?.success) {
    return <div className="text-green-600">Success!</div>
  }

  return <form action={formAction}>...</form>
}
```

## Best Practices

✅ **Use Server Actions for sensitive operations** - Password changes, payments, etc.
✅ **Validate on both client and server** - Client for UX, server for security
✅ **Show field-level errors** - React Hook Form + shadcn/ui handle this automatically
✅ **Disable submit button while loading** - Prevent double submissions
✅ **Add helpful placeholder text** - Guide users on expected input
✅ **Use proper input types** - `type="email"`, `type="tel"`, etc. for better mobile UX
✅ **Add form descriptions** - Use `<FormDescription>` for helpful hints

## Troubleshooting

### Form not submitting

1. Check browser console for validation errors
2. Ensure all required fields are filled
3. Verify Server Action has `'use server'` directive

### Validation errors not showing

1. Ensure shadcn/ui Form component is installed
2. Check that `<FormMessage />` is included in each field
3. Verify Zod schema matches field names

### TypeScript errors

1. Run `bun run build` to regenerate types
2. Ensure `@hookform/resolvers` is installed
3. Check schema type inference: `type FormValues = z.infer<typeof schema>`

## Related Recipes

- `forms/add` - Basic form without React Hook Form
- `forms/add-server-action` - Form with Server Action focus
- `forms/add-crud` - Create/edit form with database integration
- `crud/resource` - Full CRUD workflow including forms

## Resources

- **React Hook Form**: https://react-hook-form.com/
- **Zod**: https://zod.dev/
- **shadcn/ui Form**: https://ui.shadcn.com/docs/components/form
