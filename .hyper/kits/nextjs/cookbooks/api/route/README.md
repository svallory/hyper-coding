# API Route Generator

Generate type-safe REST API endpoints for Next.js with validation, authentication, and ORM integration.

## Features

- **Multiple HTTP Methods**: Support GET, POST, PUT, PATCH, DELETE
- **Type Safety**: Full TypeScript support with NextRequest/NextResponse
- **Validation**: Automatic Zod schema generation for request validation
- **Authentication**: Auto-detect and integrate auth providers (NextAuth, Clerk, Lucia)
- **ORM Integration**: Works with Prisma and Drizzle
- **CORS Support**: Optional CORS headers for external API access
- **Error Handling**: Proper HTTP status codes and error responses
- **Pagination**: Built-in pagination for GET endpoints

## Usage

### Basic CRUD API

```bash
hypergen api route users --methods GET,POST,PUT,DELETE --validation
```

Generates:
- `app/api/users/route.ts` - Route handlers for GET and POST
- `lib/schemas/api-users-schema.ts` - Zod validation schemas

### Authenticated API

```bash
hypergen api route posts --methods GET,POST --auth --validation
```

Automatically detects your auth provider and adds authentication checks.

### External API with CORS

```bash
hypergen api route webhooks --methods POST --cors
```

Adds CORS headers for external API access.

### Custom Output Directory

```bash
hypergen api route admin/users --dir app/api/admin
```

## Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | string | required | Route name in kebab-case (e.g., "users", "blog-posts") |
| `methods` | array | `["GET", "POST"]` | HTTP methods to support |
| `auth` | boolean | `false` | Add authentication check |
| `validation` | boolean | `true` | Add Zod validation schemas |
| `cors` | boolean | `false` | Add CORS headers |
| `dir` | string | `"app/api"` | Output directory |

## Generated Code Examples

### GET Handler with Pagination

```typescript
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const page = Number(searchParams.get('page')) || 1
    const limit = Number(searchParams.get('limit')) || 10

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count(),
    ])

    return NextResponse.json({
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
```

### POST Handler with Validation

```typescript
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = createUserSchema.parse(body)

    const user = await prisma.user.create({
      data: validated,
    })

    return NextResponse.json(user, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
```

### Authenticated Handler (NextAuth)

```typescript
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Handler logic...
}
```

## Testing Your API

### Using curl

```bash
# GET with pagination
curl "http://localhost:3000/api/users?page=1&limit=10"

# POST with JSON
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"John Doe","email":"john@example.com"}'

# PUT to update
curl -X PUT http://localhost:3000/api/users/123 \
  -H 'Content-Type: application/json' \
  -d '{"name":"Jane Doe"}'

# DELETE
curl -X DELETE http://localhost:3000/api/users/123
```

### Using fetch in client components

```typescript
// GET
const response = await fetch('/api/users?page=1&limit=10')
const { data, pagination } = await response.json()

// POST
const response = await fetch('/api/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
})
const user = await response.json()
```

## Next Steps

1. **Customize validation schemas** in `lib/schemas/api-${name}-schema.ts`
2. **Implement database queries** using your ORM
3. **Add middleware** for rate limiting, logging, etc.
4. **Add tests** for your API endpoints
5. **Configure authentication** if enabled

## Error Handling

The generated handlers include proper error handling:

- `400 Bad Request` - Validation errors (Zod)
- `401 Unauthorized` - Authentication required
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Unexpected errors

## ORM Support

### Prisma

Automatically generates queries using your Prisma schema:

```typescript
const items = await prisma.user.findMany()
```

### Drizzle

Generates Drizzle query templates (requires schema import):

```typescript
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const items = await db.select().from(users).limit(10)
```

## Authentication Providers

### NextAuth

```typescript
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const session = await getServerSession(authOptions)
```

### Clerk

```typescript
import { auth } from '@clerk/nextjs/server'

const { userId } = await auth()
```

### Lucia

```typescript
import { validateRequest } from '@/lib/auth'

const { user } = await validateRequest()
```

## CORS Configuration

When `cors: true`, adds headers:

```typescript
{
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}
```

For production, customize the `Access-Control-Allow-Origin` to your domain.
