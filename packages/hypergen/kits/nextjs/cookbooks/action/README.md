# Server Actions Cookbook

Generate production-ready Next.js Server Actions with validation and cache revalidation.

## Overview

This cookbook provides three recipes for generating Server Actions with different capabilities:

1. **`add`** - Basic Server Action with FormData handling
2. **`validated`** - Server Action with Zod validation
3. **`revalidate`** - Server Action with cache revalidation patterns

All recipes generate type-safe actions that work seamlessly with Next.js 15's `useActionState` hook and progressive enhancement.

## Quick Start

```bash
# Basic action
hypergen action:basic

# With validation
hypergen action:validated

# With revalidation
hypergen action:revalidate
```

## Recipes

### 1. Basic Server Action (`add`)

Generate a simple Server Action with FormData handling and basic error management.

**Use when:**
- Building quick prototypes
- Simple form submissions
- No complex validation needed

**Example:**
```bash
hypergen action:basic \
  --name createUser \
  --fields email:string name:string age:number
```

**Generated:**
```typescript
export async function createUser(prevState, formData) {
  const data = {
    email: formData.get('email'),
    name: formData.get('name'),
    age: Number(formData.get('age')),
  }

  // Basic validation
  if (!data.email) return { error: 'Email is required' }

  // TODO: Implement business logic

  return { success: true, data }
}
```

[Full documentation →](./add/README.md)

### 2. Validated Server Action (`validated`)

Generate a Server Action with Zod validation for type-safe form handling.

**Use when:**
- Need type-safe validation
- Want field-level error messages
- Require complex validation rules (email, URL, min/max, etc.)
- Building production applications

**Example:**
```bash
hypergen action:validated \
  --name createUser \
  --fields email:string:email name:string:min(2) password:string:min(8) age:number:min(18)
```

**Generated:**
```typescript
// lib/schemas/create-user.ts
export const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(2, 'Minimum 2 characters required'),
  password: z.string().min(8, 'Minimum 8 characters required'),
  age: z.number().min(18, 'Minimum value is 18'),
})

// app/actions/createUser.ts
export async function createUser(prevState, formData) {
  const parsed = createUserSchema.safeParse(rawData)

  if (!parsed.success) {
    return {
      error: 'Validation failed',
      errors: parsed.error.flatten().fieldErrors,
    }
  }

  const data = parsed.data // Type-safe!
  // TODO: Implement business logic

  return { success: true, data }
}
```

[Full documentation →](./validated/README.md)

### 3. Server Action with Revalidation (`revalidate`)

Generate a Server Action with Next.js cache revalidation patterns.

**Use when:**
- Data changes need to update cached pages
- Building real-time-feeling applications
- Need fine-grained cache control
- Want optimistic UI updates

**Example:**
```bash
hypergen action:revalidate \
  --name createPost \
  --fields title:string:min(5) content:string:min(10) \
  --revalidationType both \
  --revalidatePath /posts \
  --revalidateTags posts,content
```

**Generated:**
```typescript
export async function createPost(prevState, formData) {
  const parsed = createPostSchema.safeParse(rawData)

  if (!parsed.success) {
    return { error: 'Validation failed', errors: parsed.error.flatten().fieldErrors }
  }

  const data = parsed.data

  // Save to database
  await db.insert(posts).values(data)

  // Revalidate cache
  revalidatePath('/posts')
  revalidateTag('posts')
  revalidateTag('content')

  return { success: true, data }
}
```

[Full documentation →](./revalidate/README.md)

## Field Type Reference

All recipes support these field types:

| Field Format | Description | Zod Schema | Example |
|--------------|-------------|------------|---------|
| `name:string` | Required string | `z.string().min(1)` | `email:string` |
| `name:string:email` | Email validation | `z.string().email()` | `email:string:email` |
| `name:string:url` | URL validation | `z.string().url()` | `website:string:url` |
| `name:string:min(n)` | Min length | `z.string().min(n)` | `password:string:min(8)` |
| `name:string:max(n)` | Max length | `z.string().max(n)` | `bio:string:max(500)` |
| `name:string:optional` | Optional field | `z.string().optional()` | `notes:string:optional` |
| `name:number` | Number field | `z.number()` | `age:number` |
| `name:number:min(n)` | Min value | `z.number().min(n)` | `age:number:min(18)` |
| `name:number:max(n)` | Max value | `z.number().max(n)` | `score:number:max(100)` |
| `name:boolean` | Boolean field | `z.boolean()` | `subscribe:boolean` |
| `name:date` | Date field | `z.date()` | `birthdate:date` |
| `name:enum:a,b,c` | Enum values | `z.enum(['a','b','c'])` | `role:enum:admin,user` |
| `name:array` | String array | `z.array(z.string())` | `tags:array` |

## Usage Patterns

### Pattern 1: Simple Form Submission

```tsx
'use client'

import { useActionState } from 'react'
import { createUser } from '@/app/actions/createUser'

export function UserForm() {
  const [state, formAction, pending] = useActionState(createUser, null)

  return (
    <form action={formAction}>
      <input name="email" type="email" required />
      <input name="name" type="text" required />

      <button disabled={pending}>
        {pending ? 'Creating...' : 'Create User'}
      </button>

      {state?.error && <p className="text-red-500">{state.error}</p>}
      {state?.success && <p className="text-green-500">Success!</p>}
    </form>
  )
}
```

### Pattern 2: Field-level Error Display

```tsx
'use client'

import { useActionState } from 'react'
import { createUser } from '@/app/actions/createUser'

export function UserFormWithErrors() {
  const [state, formAction, pending] = useActionState(createUser, null)

  return (
    <form action={formAction}>
      <div>
        <input
          name="email"
          className={state?.errors?.email ? 'border-red-500' : ''}
        />
        {state?.errors?.email && (
          <p className="text-red-500 text-sm">{state.errors.email[0]}</p>
        )}
      </div>

      <div>
        <input
          name="name"
          className={state?.errors?.name ? 'border-red-500' : ''}
        />
        {state?.errors?.name && (
          <p className="text-red-500 text-sm">{state.errors.name[0]}</p>
        )}
      </div>

      <button disabled={pending}>Submit</button>
    </form>
  )
}
```

### Pattern 3: Optimistic Updates

```tsx
'use client'

import { useActionState, useOptimistic } from 'react'
import { createPost } from '@/app/actions/createPost'

export function PostList({ initialPosts }) {
  const [state, formAction] = useActionState(createPost, null)

  const [optimisticPosts, addOptimisticPost] = useOptimistic(
    initialPosts,
    (state, newPost) => [...state, newPost]
  )

  async function handleSubmit(formData: FormData) {
    addOptimisticPost({
      id: crypto.randomUUID(),
      title: formData.get('title'),
    })
    await formAction(formData)
  }

  return (
    <>
      <form action={handleSubmit}>
        <input name="title" />
        <button>Create Post</button>
      </form>

      {optimisticPosts.map((post) => (
        <div key={post.id}>{post.title}</div>
      ))}
    </>
  )
}
```

### Pattern 4: With React Hook Form

Server Actions work great with React Hook Form:

```tsx
'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createUserSchema } from '@/lib/schemas/create-user'
import { createUser } from '@/app/actions/createUser'

export function UserFormWithRHF() {
  const form = useForm({
    resolver: zodResolver(createUserSchema),
  })

  async function onSubmit(data) {
    const formData = new FormData()
    Object.entries(data).forEach(([key, value]) => {
      formData.append(key, value)
    })

    const result = await createUser(null, formData)

    if (result?.errors) {
      Object.entries(result.errors).forEach(([field, messages]) => {
        form.setError(field, { message: messages[0] })
      })
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      {/* form fields with form.register() */}
    </form>
  )
}
```

## Integration with Other Cookbooks

### Forms Cookbook

Generate matching form and action:

```bash
# 1. Generate form
hypergen form:rhf \
  --name UserForm \
  --fields email:email name:text password:password

# 2. Generate matching action
hypergen action:validated \
  --name createUser \
  --fields email:string:email name:string:min(2) password:string:min(8)
```

### CRUD Cookbook

CRUD resources automatically use validated actions with revalidation:

```bash
hypergen crud:resource --name Post
# Generates: createPost, updatePost, deletePost actions
```

## Return Type Reference

All Server Actions return a state object:

```typescript
type ActionState = {
  error?: string                     // General error message
  errors?: Record<string, string[]>  // Field-level validation errors
  success?: boolean                  // Success flag
  data?: T                           // Type-safe validated data
} | null
```

### Handling Different States

```tsx
// General error (no field errors)
{state?.error && !state?.errors && (
  <p className="text-red-500">{state.error}</p>
)}

// Field errors
{state?.errors?.fieldName && (
  <p className="text-red-500">{state.errors.fieldName[0]}</p>
)}

// Success
{state?.success && (
  <p className="text-green-500">Operation successful!</p>
)}

// Access validated data
{state?.success && state?.data && (
  <pre>{JSON.stringify(state.data, null, 2)}</pre>
)}
```

## Progressive Enhancement

Server Actions work without JavaScript:

```tsx
// Works even without JS enabled!
<form action={createUser}>
  <input name="email" type="email" required />
  <button>Submit</button>
</form>
```

To add client-side enhancements:

```tsx
'use client'

import { useActionState } from 'react'
import { createUser } from '@/app/actions/createUser'

export function EnhancedForm() {
  const [state, formAction, pending] = useActionState(createUser, null)

  return (
    <form action={formAction}>
      <input name="email" type="email" required />

      {/* JS-enhanced features */}
      <button disabled={pending}>
        {pending ? 'Submitting...' : 'Submit'}
      </button>

      {state?.error && <p>{state.error}</p>}
    </form>
  )
}
```

## Best Practices

### 1. Always Validate on Server
```typescript
// ✅ Good - server validation
export async function createUser(prevState, formData) {
  const parsed = schema.safeParse(data)
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }
  // ...
}

// ❌ Bad - trusting client data
export async function createUser(prevState, formData) {
  const data = Object.fromEntries(formData)
  await db.insert(users).values(data) // Vulnerable!
}
```

### 2. Use Type-safe Schemas
```typescript
// ✅ Good - reusable schema
export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
})

export type CreateUserInput = z.infer<typeof createUserSchema>

// Use in action
const parsed = createUserSchema.safeParse(data)
```

### 3. Handle Errors Gracefully
```typescript
// ✅ Good - comprehensive error handling
try {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed', errors: parsed.error.flatten().fieldErrors }
  }

  await db.insert(users).values(parsed.data)
  return { success: true }
} catch (error) {
  console.error('Database error:', error)
  return { error: 'Failed to create user. Please try again.' }
}
```

### 4. Revalidate After Mutations
```typescript
// ✅ Good - revalidate cache
export async function createPost(prevState, formData) {
  const data = await db.insert(posts).values(parsed.data)
  revalidatePath('/posts')
  revalidateTag('posts')
  return { success: true, data }
}
```

### 5. Use Transactions for Multiple Operations
```typescript
// ✅ Good - atomic operations
export async function createUserWithProfile(prevState, formData) {
  return await db.transaction(async (tx) => {
    const user = await tx.insert(users).values(userData)
    await tx.insert(profiles).values({ userId: user.id, ...profileData })
    return { success: true, user }
  })
}
```

## Security Considerations

### 1. Authentication
```typescript
import { auth } from '@/lib/auth'

export async function updateProfile(prevState, formData) {
  const session = await auth()
  if (!session?.user) {
    return { error: 'Unauthorized' }
  }

  // Ensure user can only update their own profile
  if (userId !== session.user.id) {
    return { error: 'Forbidden' }
  }

  // ...
}
```

### 2. Authorization
```typescript
export async function deletePost(prevState, formData) {
  const session = await auth()
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) })

  if (post.authorId !== session.user.id && !session.user.isAdmin) {
    return { error: 'Not authorized to delete this post' }
  }

  // ...
}
```

### 3. Rate Limiting
```typescript
import { ratelimit } from '@/lib/ratelimit'

export async function sendEmail(prevState, formData) {
  const { success } = await ratelimit.limit(session.user.id)

  if (!success) {
    return { error: 'Too many requests. Please try again later.' }
  }

  // ...
}
```

### 4. CSRF Protection
Next.js automatically handles CSRF protection for Server Actions. No additional setup needed!

## Troubleshooting

### Action not being called
- Ensure form has `action` attribute pointing to your Server Action
- Check that the action file has `'use server'` directive
- Verify the action is exported

### Validation errors not showing
- Check that you're using `useActionState` hook
- Ensure your action returns errors in the correct format: `{ errors: { field: ['message'] } }`
- Verify you're displaying `state?.errors?.fieldName`

### Cache not revalidating
- Make sure `revalidatePath()` or `revalidateTag()` is called AFTER successful mutation
- Check that the path matches exactly (case-sensitive)
- Verify tags match between `fetch()` and `revalidateTag()`
- Try clearing `.next` directory: `rm -rf .next`

### TypeScript errors
- Run `npm run build` to check for type errors
- Ensure Zod schema types match your form fields
- Check that `FormData` extraction matches field types

## Examples

See the individual recipe READMEs for comprehensive examples:

- [Basic Server Action examples](./add/README.md)
- [Validated Server Action examples](./validated/README.md)
- [Cache Revalidation examples](./revalidate/README.md)

## Learn More

- [Next.js Server Actions Documentation](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations)
- [useActionState Hook](https://react.dev/reference/react/useActionState)
- [useOptimistic Hook](https://react.dev/reference/react/useOptimistic)
- [Zod Documentation](https://zod.dev)
- [Next.js Caching](https://nextjs.org/docs/app/building-your-application/caching)
