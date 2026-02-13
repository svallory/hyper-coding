# Basic Server Action Recipe

Generate a basic Server Action with FormData handling and error management.

## Usage

```bash
hypergen server-actions:add
```

## Variables

- `name` (required): Action name in camelCase (e.g. "createUser", "updateProfile")
- `fields` (required): Array of form fields in format "name:type"
  - Supported types: `string`, `number`, `boolean`, `date`
  - Example: `["email:string", "age:number", "subscribe:boolean"]`
- `dir` (optional): Output directory (default: "app/actions")
- `withPrevState` (optional): Add prevState parameter for useActionState (default: true)
- `returnPath` (optional): Path to redirect/revalidate after success

## Examples

### Basic action
```bash
hypergen server-actions:add \
  --name createUser \
  --fields email:string name:string age:number
```

### Action with redirect
```bash
hypergen server-actions:add \
  --name updateProfile \
  --fields name:string bio:string \
  --returnPath /profile
```

### Action without prevState (plain form)
```bash
hypergen server-actions:add \
  --name submitFeedback \
  --fields message:string rating:number \
  --withPrevState false
```

## Generated Code

### With useActionState (default)

```typescript
'use server'

export type CreateUserState = {
  error?: string
  success?: boolean
  data?: any
} | null

export async function createUser(
  prevState: CreateUserState,
  formData: FormData
): Promise<CreateUserState> {
  try {
    const data = {
      email: formData.get('email'),
      name: formData.get('name'),
      age: Number(formData.get('age')),
    }

    // Basic validation
    if (!data.email) {
      return { error: 'Email is required' }
    }
    if (!data.name) {
      return { error: 'Name is required' }
    }

    // TODO: Implement your business logic
    console.log('CreateUser data:', data)

    return { success: true, data }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
    }
  }
}
```

### Usage in Component

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
      <input name="age" type="number" required />

      <button disabled={pending}>
        {pending ? 'Creating...' : 'Create User'}
      </button>

      {state?.error && (
        <p className="text-red-500">{state.error}</p>
      )}

      {state?.success && (
        <p className="text-green-500">User created successfully!</p>
      )}
    </form>
  )
}
```

## When to Use

Use this recipe when you need:
- ✅ Simple form submissions without complex validation
- ✅ Basic error handling
- ✅ Progressive enhancement with useActionState
- ✅ Quick prototyping

For more advanced use cases, see:
- `server-actions:add-validated` - Adds Zod validation
- `server-actions:add-revalidate` - Adds cache revalidation patterns

## Field Types

The recipe supports these field types:

| Type | FormData Extraction | Example |
|------|---------------------|---------|
| `string` | `formData.get('field')` | `email:string` |
| `number` | `Number(formData.get('field'))` | `age:number` |
| `boolean` | `formData.get('field') === 'true'` | `subscribe:boolean` |
| `date` | `new Date(formData.get('field'))` | `birthdate:date` |

## Return Types

### With prevState (useActionState)
```typescript
{
  error?: string      // Error message if action failed
  success?: boolean   // True if action succeeded
  data?: any          // Optional data returned from action
} | null
```

### Without prevState
Throws errors directly, or returns success object.

## Next Steps

1. Implement your business logic in the generated action
2. Add database operations or API calls
3. Consider adding validation with `server-actions:add-validated`
4. Add cache revalidation with `server-actions:add-revalidate`
