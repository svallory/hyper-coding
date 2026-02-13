# Validated Server Action Recipe

Generate a Server Action with Zod validation, providing type-safe formData extraction and field-level error handling.

## Usage

```bash
hypergen server-actions:add-validated
```

## Variables

- `name` (required): Action name in camelCase (e.g. "createUser", "updateProfile")
- `fields` (required): Array of form fields in format "name:type:validation"
  - **Types**: `string`, `number`, `boolean`, `date`, `enum`, `array`
  - **Validations**: `email`, `url`, `min(n)`, `max(n)`, `length(n)`, `optional`, `enum values`
  - Example: `["email:string:email", "age:number:min(18)", "role:enum:admin,user"]`
- `dir` (optional): Output directory for action (default: "app/actions")
- `schemaDir` (optional): Output directory for schema (default: "lib/schemas")
- `withPrevState` (optional): Add prevState parameter for useActionState (default: true)
- `returnPath` (optional): Path to redirect/revalidate after success

## Examples

### User registration with email validation
```bash
hypergen server-actions:add-validated \
  --name createUser \
  --fields email:string:email name:string:min(2) password:string:min(8) age:number:min(18)
```

### Profile update with optional fields
```bash
hypergen server-actions:add-validated \
  --name updateProfile \
  --fields name:string bio:string:optional website:string:url avatar:string:optional
```

### Post creation with enum
```bash
hypergen server-actions:add-validated \
  --name createPost \
  --fields title:string:min(5) content:string:min(10) status:enum:draft,published category:enum:tech,design,business
```

## Generated Files

### 1. Zod Schema (`lib/schemas/create-user.ts`)

```typescript
import { z } from 'zod'

export const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(2, 'Minimum 2 characters required'),
  password: z.string().min(8, 'Minimum 8 characters required'),
  age: z.number().min(18, 'Minimum value is 18'),
})

export type CreateUserInput = z.infer<typeof createUserSchema>
```

### 2. Server Action (`app/actions/createUser.ts`)

```typescript
'use server'

import { createUserSchema, type CreateUserInput } from '@/lib/schemas/create-user'

export type CreateUserState = {
  error?: string
  errors?: Record<string, string[]>
  success?: boolean
  data?: CreateUserInput
} | null

export async function createUser(
  prevState: CreateUserState,
  formData: FormData
): Promise<CreateUserState> {
  try {
    const rawData = {
      email: formData.get('email'),
      name: formData.get('name'),
      password: formData.get('password'),
      age: formData.get('age') ? Number(formData.get('age')) : undefined,
    }

    const parsed = createUserSchema.safeParse(rawData)

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      return {
        error: 'Validation failed. Please check the form for errors.',
        errors,
      }
    }

    const data = parsed.data

    // TODO: Implement your business logic
    console.log('CreateUser validated data:', data)

    return { success: true, data }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
    }
  }
}
```

## Usage in Component

```tsx
'use client'

import { useActionState } from 'react'
import { createUser } from '@/app/actions/createUser'

export function UserRegistrationForm() {
  const [state, formAction, pending] = useActionState(createUser, null)

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          className={state?.errors?.email ? 'border-red-500' : ''}
        />
        {state?.errors?.email && (
          <p className="text-red-500 text-sm">{state.errors.email[0]}</p>
        )}
      </div>

      <div>
        <label htmlFor="name">Name</label>
        <input
          id="name"
          name="name"
          type="text"
          className={state?.errors?.name ? 'border-red-500' : ''}
        />
        {state?.errors?.name && (
          <p className="text-red-500 text-sm">{state.errors.name[0]}</p>
        )}
      </div>

      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          className={state?.errors?.password ? 'border-red-500' : ''}
        />
        {state?.errors?.password && (
          <p className="text-red-500 text-sm">{state.errors.password[0]}</p>
        )}
      </div>

      <div>
        <label htmlFor="age">Age</label>
        <input
          id="age"
          name="age"
          type="number"
          className={state?.errors?.age ? 'border-red-500' : ''}
        />
        {state?.errors?.age && (
          <p className="text-red-500 text-sm">{state.errors.age[0]}</p>
        )}
      </div>

      <button disabled={pending} type="submit">
        {pending ? 'Creating account...' : 'Create Account'}
      </button>

      {state?.error && !state?.errors && (
        <p className="text-red-500">{state.error}</p>
      )}

      {state?.success && (
        <p className="text-green-500">Account created successfully!</p>
      )}
    </form>
  )
}
```

## Field Type Reference

### String Field
```
name:string              → z.string().min(1, 'Name is required')
email:string:email       → z.string().email('Invalid email address')
url:string:url           → z.string().url('Invalid URL')
bio:string:min(10)       → z.string().min(10, 'Minimum 10 characters required')
code:string:length(6)    → z.string().length(6, 'Must be exactly 6 characters')
notes:string:optional    → z.string().optional()
```

### Number Field
```
age:number               → z.number()
age:number:min(18)       → z.number().min(18, 'Minimum value is 18')
score:number:max(100)    → z.number().max(100, 'Maximum value is 100')
count:number:optional    → z.number().optional()
```

### Boolean Field
```
subscribe:boolean        → z.boolean()
```

### Date Field
```
birthdate:date           → z.date()
```

### Enum Field
```
role:enum:admin,user,guest          → z.enum(['admin', 'user', 'guest'])
status:enum:draft,published         → z.enum(['draft', 'published'])
```

### Array Field
```
tags:array               → z.array(z.string())
```

## State Type Reference

The generated action returns a state object with this structure:

```typescript
{
  error?: string                     // General error message
  errors?: Record<string, string[]>  // Field-level validation errors
  success?: boolean                  // Success flag
  data?: YourSchemaType              // Type-safe validated data
} | null
```

### Error Handling

**Field-level errors:**
```tsx
{state?.errors?.email && (
  <p className="text-red-500">{state.errors.email[0]}</p>
)}
```

**General error:**
```tsx
{state?.error && !state?.errors && (
  <p className="text-red-500">{state.error}</p>
)}
```

**Success state:**
```tsx
{state?.success && (
  <p className="text-green-500">Success! Data: {JSON.stringify(state.data)}</p>
)}
```

## When to Use

Use this recipe when you need:
- ✅ Type-safe form validation
- ✅ Field-level error messages
- ✅ Complex validation rules (email, URL, min/max, etc.)
- ✅ Reusable validation schemas
- ✅ Production-ready form handling

For simpler use cases, see:
- `server-actions:add` - Basic action without Zod

For cache revalidation patterns, see:
- `server-actions:add-revalidate` - Adds revalidation strategies

## Integration with Forms Cookbook

This recipe works seamlessly with forms generated by the `forms` cookbook:

```bash
# Generate a form
hypergen forms:add-rhf --name UserForm --fields email:email name:text

# Generate matching validated action
hypergen server-actions:add-validated --name createUser --fields email:string:email name:string:min(2)
```

## Advanced Patterns

### Custom validation messages
Edit the generated schema to customize error messages:

```typescript
export const createUserSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter'),
})
```

### Nested objects
Extend the schema with nested validation:

```typescript
export const createUserSchema = z.object({
  name: z.string(),
  address: z.object({
    street: z.string(),
    city: z.string(),
    zip: z.string().length(5),
  }),
})
```

### Transform data
Use Zod transforms for data normalization:

```typescript
export const createUserSchema = z.object({
  email: z.string().email().toLowerCase(),
  name: z.string().trim().min(2),
})
```
