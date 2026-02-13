# Add Server Action Form Recipe

Generate a progressively enhanced form with Server Action. Works without JavaScript and includes server-side validation.

## Usage

```bash
hypergen nextjs form add-server-action \
  --name SignupForm \
  --fields "email:email,password:password,name:text"
```

With redirect and revalidation:

```bash
hypergen nextjs form add-server-action \
  --name LoginForm \
  --fields "email:email,password:password" \
  --redirectPath "/dashboard" \
  --revalidatePath "/"
```

## What It Does

1. **Installs Dependencies** (if not present)
   - `zod` - Schema validation
   - shadcn/ui components (input, button, label, textarea, select, checkbox as needed)

2. **Generates Validation Schema** (`lib/schemas/[name]-schema.ts`)
   - Zod schema for server-side validation
   - TypeScript type inference

3. **Generates Server Action** (`app/actions/[name]-action.ts`)
   - Type-safe Server Action with Zod validation
   - Error handling with field-level errors
   - Optional redirect and cache revalidation
   - Progressive enhancement (works without JS)

4. **Generates Form Component** (`components/forms/[Name].tsx`)
   - Uses `useActionState` for form state management
   - Displays field-level errors
   - Loading states with `isPending`
   - Success/error message display

## Generated Files

- `components/forms/SignupForm.tsx` - Form component
- `app/actions/signup-form-action.ts` - Server Action
- `lib/schemas/signup-form-schema.ts` - Validation schema

## Options

- **`--name`** (required)
  - Form component name in PascalCase
  - Example: `SignupForm`, `LoginForm`, `ContactForm`

- **`--fields`** (required)
  - Comma-separated list of fields in format `name:type`
  - Example: `"email:email,password:password,name:text"`

- **`--dir`** (default: `components/forms`)
  - Output directory for form component

- **`--actionPath`** (default: `app/actions`)
  - Path to Server Actions directory

- **`--redirectPath`** (default: `""`)
  - Path to redirect to on successful submission
  - Example: `"/dashboard"`, `"/thank-you"`

- **`--revalidatePath`** (default: `""`)
  - Path to revalidate cache on success
  - Example: `"/"`, `"/posts"`

## Supported Field Types

| Type | HTML Input | Validation |
|------|------------|------------|
| `text` | `<input type="text">` | `z.string().min(1)` |
| `email` | `<input type="email">` | `z.string().email()` |
| `password` | `<input type="password">` | `z.string().min(8)` |
| `number` | `<input type="number">` | `z.coerce.number().positive()` |
| `tel` | `<input type="tel">` | `z.string().regex()` |
| `url` | `<input type="url">` | `z.string().url()` |
| `date` | `<input type="date">` | `z.string().min(1)` |
| `time` | `<input type="time">` | `z.string().min(1)` |
| `datetime` | `<input type="datetime-local">` | `z.string().min(1)` |
| `textarea` | `<textarea>` | `z.string().min(1)` |
| `select` | `<Select>` | `z.string().min(1)` |
| `checkbox` | `<Checkbox>` | `z.boolean().optional()` |

## Usage Examples

### Basic Server Action Form

```tsx
import { SignupForm } from '@/components/forms/SignupForm'

export default function SignupPage() {
  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Create Account</h1>
      <SignupForm />
    </div>
  )
}
```

That's it! The form automatically uses the generated Server Action.

### Custom Server Action Implementation

Edit the generated action to implement your business logic:

```typescript
// app/actions/signup-form-action.ts
'use server'

import { redirect } from 'next/navigation'
import { hash } from 'bcrypt'
import { db } from '@/lib/db'
import { signupFormSchema } from '@/lib/schemas/signup-form-schema'

export async function signupFormAction(prevState: any, formData: FormData) {
  const parsed = signupFormSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    name: formData.get('name'),
  })

  if (!parsed.success) {
    return {
      success: false,
      error: 'Validation failed',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  try {
    // Check if user exists
    const existingUser = await db.user.findUnique({
      where: { email: parsed.data.email },
    })

    if (existingUser) {
      return {
        success: false,
        error: 'Email already registered',
      }
    }

    // Hash password
    const hashedPassword = await hash(parsed.data.password, 10)

    // Create user
    await db.user.create({
      data: {
        email: parsed.data.email,
        name: parsed.data.name,
        password: hashedPassword,
      },
    })

    // Redirect to login
    redirect('/login')
  } catch (error) {
    return {
      success: false,
      error: 'Failed to create account',
    }
  }
}
```

### Form with Success Message

The generated form already includes success message display:

```tsx
{state?.success && (
  <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">
    Form submitted successfully!
  </div>
)}
```

Customize the message by editing the form component.

### Login Form with Authentication

```typescript
// app/actions/login-form-action.ts
'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { compare } from 'bcrypt'
import { db } from '@/lib/db'
import { createSession } from '@/lib/auth'
import { loginFormSchema } from '@/lib/schemas/login-form-schema'

export async function loginFormAction(prevState: any, formData: FormData) {
  const parsed = loginFormSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return {
      success: false,
      error: 'Invalid credentials',
    }
  }

  try {
    const user = await db.user.findUnique({
      where: { email: parsed.data.email },
    })

    if (!user) {
      return { success: false, error: 'Invalid credentials' }
    }

    const valid = await compare(parsed.data.password, user.password)

    if (!valid) {
      return { success: false, error: 'Invalid credentials' }
    }

    // Create session
    const session = await createSession(user.id)
    cookies().set('session', session, { httpOnly: true, secure: true })

    redirect('/dashboard')
  } catch (error) {
    return { success: false, error: 'Login failed' }
  }
}
```

### Contact Form with Email

```typescript
// app/actions/contact-form-action.ts
'use server'

import { revalidatePath } from 'next/cache'
import { sendEmail } from '@/lib/email'
import { contactFormSchema } from '@/lib/schemas/contact-form-schema'

export async function contactFormAction(prevState: any, formData: FormData) {
  const parsed = contactFormSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    message: formData.get('message'),
  })

  if (!parsed.success) {
    return {
      success: false,
      error: 'Validation failed',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  try {
    await sendEmail({
      to: 'support@example.com',
      subject: `Contact form: ${parsed.data.name}`,
      html: `
        <p><strong>From:</strong> ${parsed.data.name} (${parsed.data.email})</p>
        <p><strong>Message:</strong></p>
        <p>${parsed.data.message}</p>
      `,
    })

    revalidatePath('/contact')

    return {
      success: true,
      data: parsed.data,
    }
  } catch (error) {
    return {
      success: false,
      error: 'Failed to send message',
    }
  }
}
```

## Customization

### Add Custom Validation

Edit the schema file:

```typescript
// lib/schemas/signup-form-schema.ts
export const signupFormSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain number')
    .regex(/[^A-Za-z0-9]/, 'Must contain special character'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
})
```

### Customize Success Redirect

In your Server Action:

```typescript
if (parsed.success) {
  redirect('/thank-you')
}
```

### Add Rate Limiting

```typescript
import { ratelimit } from '@/lib/redis'

export async function contactFormAction(prevState: any, formData: FormData) {
  const ip = headers().get('x-forwarded-for') ?? 'unknown'
  const { success } = await ratelimit.limit(ip)

  if (!success) {
    return {
      success: false,
      error: 'Too many requests. Please try again later.',
    }
  }

  // ... rest of action
}
```

### Add CAPTCHA

```typescript
import { verifyCaptcha } from '@/lib/captcha'

export async function signupFormAction(prevState: any, formData: FormData) {
  const token = formData.get('captcha-token')
  const valid = await verifyCaptcha(token)

  if (!valid) {
    return { success: false, error: 'CAPTCHA verification failed' }
  }

  // ... rest of action
}
```

## Progressive Enhancement

This recipe follows the progressive enhancement pattern:

1. **Works without JavaScript**: Form submission uses native HTML form behavior
2. **Enhanced with JavaScript**: `useActionState` provides optimistic UI updates
3. **Graceful degradation**: Falls back to full page reload if JS fails

Test without JavaScript:

```bash
# In browser DevTools
# Settings > Debugger > Disable JavaScript
```

## Best Practices

✅ **Validate on server** - Never trust client-side validation alone
✅ **Use proper HTTP status codes** - Return meaningful errors
✅ **Sanitize user input** - Prevent XSS and injection attacks
✅ **Rate limit submissions** - Prevent abuse and spam
✅ **Log errors properly** - Use structured logging for debugging
✅ **Use HTTPS** - Protect sensitive form data in transit
✅ **Add CSRF protection** - Next.js Server Actions include this by default

## When to Use This Recipe

**Use `forms/add-server-action` when:**
- You want progressive enhancement
- Server-side validation is the primary concern
- You need the form to work without JavaScript
- You're submitting to a database or external API

**Use `forms/add` instead when:**
- You want a simple client-side form
- You don't need Server Actions
- You prefer client-side validation

**Use `forms/add-rhf` instead when:**
- You need complex validation rules
- You want field-level error display with React Hook Form
- You need form state management (dirty, touched, etc.)

**Use `forms/add-crud` instead when:**
- You're building forms from database models
- You need create/edit modes automatically
- You want ORM integration (Prisma/Drizzle)

## Troubleshooting

### Form not submitting

1. Check that Server Action has `'use server'` directive
2. Verify action is exported and imported correctly
3. Ensure form `action` prop is set to the Server Action
4. Check browser console for errors

### Validation errors not showing

1. Verify `useActionState` is used correctly
2. Check that state errors are displayed in JSX
3. Ensure field names match schema exactly
4. Test validation logic in Server Action

### Redirect not working

1. Check `redirect()` is called after successful submission
2. Ensure redirect path is valid
3. Verify you're not catching the redirect error
4. Test redirect URL manually

### TypeScript errors

1. Run `bun run build` to check for type errors
2. Ensure Zod schema exports correct types
3. Verify FormData extraction matches schema
4. Check that Server Action types are correct

## Related Recipes

- `forms/add` - Basic form without Server Action
- `forms/add-rhf` - Form with React Hook Form
- `forms/add-crud` - Create/edit form with database integration
- `crud/resource` - Full CRUD workflow

## Resources

- **Server Actions**: https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations
- **useActionState**: https://react.dev/reference/react/useActionState
- **Zod**: https://zod.dev/
- **Progressive Enhancement**: https://developer.mozilla.org/en-US/docs/Glossary/Progressive_Enhancement
