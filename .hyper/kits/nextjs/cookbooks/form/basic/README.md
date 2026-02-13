# Add Basic Form Recipe

Generate a simple, lightweight form with native HTML5 validation and shadcn/ui components. No external form libraries required.

## Usage

```bash
hypergen nextjs form add --name ContactForm --fields "name:text,email:email,message:textarea"
```

Without validation schema:

```bash
hypergen nextjs form add \
  --name NewsletterForm \
  --fields "email:email,subscribe:checkbox" \
  --withValidation false
```

## What It Does

1. **Installs shadcn/ui Components** (if not present)
   - `input` - Text input component
   - `button` - Submit button
   - `label` - Form labels
   - Additional components based on field types (textarea, select, checkbox)

2. **Optionally Installs Zod** (if `--withValidation` is true)
   - Provides runtime type-safe validation

3. **Generates Form Component** (`components/forms/[Name].tsx`)
   - Native HTML form with `onSubmit` handler
   - Loading states during submission
   - Error handling and display
   - Full keyboard accessibility

4. **Generates Validation Schema** (optional, `lib/schemas/[name]-schema.ts`)
   - Zod schema for runtime validation
   - Type inference for TypeScript
   - Helper function for FormData validation

## Generated Files

- `components/forms/ContactForm.tsx` - Form component
- `lib/schemas/contact-form-schema.ts` - Validation schema (if `--withValidation`)

## Options

- **`--name`** (required)
  - Form component name in PascalCase
  - Example: `ContactForm`, `NewsletterForm`, `FeedbackForm`

- **`--fields`** (required)
  - Comma-separated list of fields in format `name:type`
  - Example: `"name:text,email:email,age:number"`

- **`--dir`** (default: `components/forms`)
  - Output directory for form component

- **`--withValidation`** (default: `true`)
  - Generate Zod schema for validation

## Supported Field Types

| Type | HTML Input | Native Validation |
|------|------------|-------------------|
| `text` | `<input type="text">` | `required` attribute |
| `email` | `<input type="email">` | Email format validation |
| `password` | `<input type="password">` | `required` attribute |
| `number` | `<input type="number">` | Numeric validation |
| `tel` | `<input type="tel">` | Phone format hint |
| `url` | `<input type="url">` | URL format validation |
| `date` | `<input type="date">` | Date picker |
| `time` | `<input type="time">` | Time picker |
| `datetime` | `<input type="datetime-local">` | DateTime picker |
| `textarea` | `<textarea>` | Multi-line text |
| `select` | `<Select>` | Dropdown selection |
| `checkbox` | `<Checkbox>` | Boolean checkbox |

## Usage Examples

### Basic Form (Client-Side Submission)

```tsx
'use client'

import { ContactForm } from '@/components/forms/ContactForm'

export default function ContactPage() {
  async function handleSubmit(formData: FormData) {
    const name = formData.get('name')
    const email = formData.get('email')
    const message = formData.get('message')

    const response = await fetch('/api/contact', {
      method: 'POST',
      body: JSON.stringify({ name, email, message }),
    })

    if (!response.ok) {
      throw new Error('Failed to send message')
    }

    alert('Message sent!')
  }

  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Contact Us</h1>
      <ContactForm onSubmit={handleSubmit} />
    </div>
  )
}
```

### Form with Server Action

```tsx
import { ContactForm } from '@/components/forms/ContactForm'
import { submitContactForm } from '@/app/actions'

export default function ContactPage() {
  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Contact Us</h1>
      <ContactForm onSubmit={submitContactForm} />
    </div>
  )
}
```

Server Action:

```typescript
'use server'

import { validateContactForm } from '@/lib/schemas/contact-form-schema'

export async function submitContactForm(formData: FormData) {
  const result = validateContactForm(formData)

  if (!result.success) {
    throw new Error('Validation failed')
  }

  // Send email, save to database, etc.
  console.log('Contact form data:', result.data)
}
```

### Form with Custom Styling

```tsx
<ContactForm
  onSubmit={handleSubmit}
  submitLabel="Send Message"
  className="max-w-lg mx-auto"
/>
```

### Newsletter Signup

```tsx
'use client'

import { NewsletterForm } from '@/components/forms/NewsletterForm'

export default function Footer() {
  async function handleSubmit(formData: FormData) {
    const email = formData.get('email')
    const subscribe = formData.get('subscribe') === 'on'

    await fetch('/api/newsletter', {
      method: 'POST',
      body: JSON.stringify({ email, subscribe }),
    })
  }

  return (
    <footer>
      <h3>Subscribe to our newsletter</h3>
      <NewsletterForm onSubmit={handleSubmit} submitLabel="Subscribe" />
    </footer>
  )
}
```

## Customization

### Add Custom Validation

Edit the generated schema file:

```typescript
// lib/schemas/contact-form-schema.ts
export const contactFormSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  message: z.string().min(10, 'Message must be at least 10 characters'),
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits').optional(),
})
```

### Customize Select Options

Edit the generated form component:

```tsx
<SelectContent>
  <SelectItem value="general">General Inquiry</SelectItem>
  <SelectItem value="support">Support</SelectItem>
  <SelectItem value="sales">Sales</SelectItem>
</SelectContent>
```

### Add Success State

```tsx
'use client'

import { useState } from 'react'
import { ContactForm } from '@/components/forms/ContactForm'

export default function ContactPage() {
  const [success, setSuccess] = useState(false)

  async function handleSubmit(formData: FormData) {
    await fetch('/api/contact', {
      method: 'POST',
      body: formData,
    })
    setSuccess(true)
  }

  if (success) {
    return <div className="text-green-600">Thank you for your message!</div>
  }

  return <ContactForm onSubmit={handleSubmit} />
}
```

### Add File Upload

Manually add to the form component:

```tsx
<div className="space-y-2">
  <Label htmlFor="attachment">Attachment</Label>
  <Input
    id="attachment"
    name="attachment"
    type="file"
    accept="image/*,.pdf"
    disabled={isLoading}
  />
</div>
```

## Best Practices

✅ **Use native HTML validation** - Works without JavaScript, better UX
✅ **Provide clear error messages** - Help users fix validation errors
✅ **Disable form during submission** - Prevent double submissions
✅ **Use proper input types** - Mobile keyboards adapt to input type
✅ **Add loading states** - Show feedback during async operations
✅ **Use semantic HTML** - Better accessibility and SEO
✅ **Test without JavaScript** - Ensure progressive enhancement

## When to Use This Recipe

**Use `forms/add` when:**
- You want a simple, lightweight form
- You don't need complex field-level validation
- You prefer native HTML validation
- You want minimal dependencies

**Use `forms/add-rhf` instead when:**
- You need complex validation rules
- You want field-level error display
- You need form state management (dirty, touched, etc.)
- You're building a multi-step form

**Use `forms/add-server-action` instead when:**
- You want progressive enhancement
- You need the form to work without JavaScript
- Server-side validation is primary concern

**Use `forms/add-crud` instead when:**
- You're building forms from database models
- You need create/edit modes automatically
- You want ORM integration (Prisma/Drizzle)

## Troubleshooting

### Form not submitting

1. Check browser console for JavaScript errors
2. Verify `onSubmit` prop is provided
3. Ensure all required fields are filled
4. Check that button `type="submit"` is set

### Validation not working

1. Ensure `withValidation` is set to `true`
2. Check that Zod is installed: `bun pm ls zod`
3. Verify schema matches field names exactly
4. Look for validation errors in browser console

### Select field not working

1. Ensure initial state is set correctly
2. Check that `onValueChange` handler is connected
3. Verify FormData includes select value
4. Test select interaction in browser DevTools

### TypeScript errors

1. Run `bun run build` to check for type errors
2. Ensure Zod schema exports correct types
3. Check that FormData types are compatible
4. Verify all imports resolve correctly

## Related Recipes

- `forms/add-rhf` - Form with React Hook Form integration
- `forms/add-server-action` - Server Action-focused form
- `forms/add-crud` - Create/edit form with database integration
- `crud/resource` - Full CRUD workflow including forms

## Resources

- **HTML Forms**: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form
- **Form Validation**: https://developer.mozilla.org/en-US/docs/Learn/Forms/Form_validation
- **Zod**: https://zod.dev/
- **shadcn/ui**: https://ui.shadcn.com/
