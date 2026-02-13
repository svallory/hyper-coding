# Forms Cookbook

Generate production-ready forms for Next.js with validation, Server Actions, and ORM integration.

## Quick Start

```bash
# Simple contact form
hypergen nextjs form basic --name ContactForm --fields "name:text,email:email,message:textarea"

# Form with React Hook Form
hypergen nextjs form rhf --name UserForm --fields "name:text,email:email"

# Form with Server Action
hypergen nextjs form server-action --name SignupForm --fields "email:email,password:password"

# Auto-generate from database model
hypergen nextjs form crud --model User
```

## Available Recipes

| Recipe | Purpose | Dependencies | Best For |
|--------|---------|--------------|----------|
| **add** | Basic form | shadcn/ui, Zod (optional) | Simple forms, minimal deps |
| **rhf** | React Hook Form | RHF, Zod, shadcn/ui | Complex validation, form state |
| **server-action** | Progressive enhancement | Zod, shadcn/ui | Server-first, works without JS |
| **crud** | ORM integration | ORM, RHF, Zod, shadcn/ui | Database-driven CRUD |

## Feature Comparison

|  | add | rhf | server-action | crud |
|---|-----|---------|-------------------|----------|
| **Form Library** | Native HTML | React Hook Form | Native HTML | React Hook Form |
| **Validation** | Optional Zod | Required Zod | Required Zod | Generated Zod |
| **Server Actions** | ❌ | ✅ Optional | ✅ Required | ✅ Required |
| **Works without JS** | ✅ | ❌ | ✅ | ❌ |
| **Field-level errors** | ⚠️ Manual | ✅ Automatic | ✅ Automatic | ✅ Automatic |
| **Form state** | ❌ | ✅ (dirty, touched) | ⚠️ Basic | ✅ (dirty, touched) |
| **ORM integration** | ❌ | ❌ | ❌ | ✅ Auto-detect |
| **Create/Edit modes** | ❌ | ❌ | ❌ | ✅ Automatic |
| **Type inference** | ⚠️ Manual | ✅ Automatic | ✅ Automatic | ✅ From schema |

## When to Use Each Recipe

### Use `form/basic` when:
- Building a simple contact form
- You prefer minimal dependencies
- Native HTML validation is sufficient
- You don't need complex form state

### Use `form/rhf` when:
- Building complex forms with many fields
- You need field-level validation
- You want form state management (dirty, touched, etc.)
- Building multi-step forms or wizards

### Use `form/server-action` when:
- Progressive enhancement is required
- Form must work without JavaScript
- Server-side validation is primary concern
- Using Next.js 15+ Server Actions

### Use `form/crud` when:
- You have a Prisma or Drizzle schema
- Building database-driven forms
- You need both create and edit modes
- Rapid prototyping of CRUD operations

## Examples

### Basic Contact Form

```bash
hypergen nextjs form basic \
  --name ContactForm \
  --fields "name:text,email:email,subject:text,message:textarea"
```

**Generated:** Form with native validation, optional Zod schema

### User Registration Form

```bash
hypergen nextjs form rhf \
  --name SignupForm \
  --fields "name:text,email:email,password:password,confirmPassword:password" \
  --withServerAction
```

**Generated:** RHF form with Zod validation and Server Action

### Login Form with Redirect

```bash
hypergen nextjs form server-action \
  --name LoginForm \
  --fields "email:email,password:password" \
  --redirectPath "/dashboard"
```

**Generated:** Progressive enhancement form with auto-redirect

### Product CRUD Form

```bash
hypergen nextjs form crud \
  --model Product \
  --fields "name,price,description,category" \
  --excludeFields "id,createdAt,updatedAt"
```

**Generated:** Auto-detected from Prisma/Drizzle schema, create/update actions

## Supported Field Types

All recipes support these input types:

- **text** - Single-line text input
- **email** - Email with validation
- **password** - Password input (min 8 chars)
- **number** - Numeric input
- **tel** - Phone number with regex
- **url** - URL with validation
- **date** - Date picker
- **time** - Time picker
- **datetime** - DateTime picker
- **textarea** - Multi-line text
- **select** - Dropdown selection
- **checkbox** - Boolean checkbox (CRUD only)

## Architecture

### File Structure

```
project/
├── components/forms/          # Generated form components
│   ├── ContactForm.tsx
│   ├── SignupForm.tsx
│   └── ProductForm.tsx
├── lib/schemas/               # Zod validation schemas
│   ├── contact-form-schema.ts
│   ├── signup-form-schema.ts
│   └── product-schema.ts
└── app/actions/               # Server Actions
    ├── signup-form-action.ts
    ├── create-product.ts
    └── update-product.ts
```

### Common Patterns

#### Form in Modal

```tsx
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ContactForm } from '@/components/forms/ContactForm'

export function ContactModal() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <ContactForm
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
```

#### CRUD Page

```tsx
import { ProductForm } from '@/components/forms/ProductForm'
import { getProduct } from '@/lib/queries'

export default async function EditProductPage({ params }) {
  const product = await getProduct(params.id)

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1>Edit Product</h1>
      <ProductForm mode="edit" initialData={product} />
    </div>
  )
}
```

## Customization

### Add Custom Validation

Edit the generated schema:

```typescript
// lib/schemas/signup-form-schema.ts
export const signupFormSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8)
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain number'),
})
```

### Customize Inputs

Replace generated inputs with custom components:

```tsx
<FormField
  control={form.control}
  name="role"
  render={({ field }) => (
    <Select onValueChange={field.onChange} defaultValue={field.value}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">Admin</SelectItem>
        <SelectItem value="user">User</SelectItem>
      </SelectContent>
    </Select>
  )}
/>
```

### Add File Upload

```tsx
<FormField
  control={form.control}
  name="avatar"
  render={({ field }) => (
    <Input
      type="file"
      accept="image/*"
      onChange={(e) => field.onChange(e.target.files?.[0])}
    />
  )}
/>
```

## Best Practices

✅ **Validate on server** - Always validate in Server Actions, not just client
✅ **Use proper types** - Leverage Zod type inference for type safety
✅ **Handle errors gracefully** - Display field-level and general errors
✅ **Add loading states** - Show feedback during async operations
✅ **Sanitize input** - Prevent XSS and injection attacks
✅ **Rate limit** - Prevent abuse on public forms
✅ **Use transactions** - Wrap related DB operations

## Integration

All recipes integrate with:

- **shadcn/ui** - Consistent component styling
- **TailwindCSS** - Utility-first styling
- **TypeScript** - Full type safety
- **Next.js 15** - App Router and Server Actions
- **Prisma/Drizzle** - ORM auto-detection (CRUD recipe)

## Related Cookbooks

- **crud/resource** - Full CRUD workflow (list + create + edit + delete)
- **config/prisma** - Initialize Prisma ORM
- **config/drizzle** - Initialize Drizzle ORM
- **config/shadcn** - Initialize shadcn/ui
- **config/all** - Interactive wizard to configure entire stack

## Resources

- **React Hook Form**: https://react-hook-form.com/
- **Zod**: https://zod.dev/
- **shadcn/ui**: https://ui.shadcn.com/
- **Next.js Server Actions**: https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations
