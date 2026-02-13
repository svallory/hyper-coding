# Route Cookbook

Generate API route handlers for Next.js App Router with support for all HTTP methods and request handling.

## Quick Start

Create a simple GET/POST API route:

```bash
hypergen nextjs route add --path=api/users
```

Create a route with specific methods:

```bash
hypergen nextjs route add \
  --path=api/posts/[id] \
  --methods=GET,PUT,DELETE
```

## Recipes

### [add](./add/) - Add API Route
Generate `route.ts` with HTTP method handlers (GET, POST, PUT, PATCH, DELETE). Creates type-safe route handlers in the Next.js App Router.

**Features:**
- Multiple HTTP methods
- Dynamic route segments
- Request/Response types
- Error handling
- JSON responses
- TypeScript support

## What is an API Route?

In Next.js App Router, `route.ts` files create API endpoints. They export functions named after HTTP methods (GET, POST, etc.) that handle requests.

Examples:
- `app/api/users/route.ts` → `/api/users`
- `app/api/posts/[id]/route.ts` → `/api/posts/123`
- `app/api/v1/products/route.ts` → `/api/v1/products`

## Common Use Cases

### REST API for Users
```bash
hypergen nextjs route add \
  --path=api/users \
  --routeDescription="User CRUD operations" \
  --methods=GET,POST
```

### Single Resource Endpoint
```bash
hypergen nextjs route add \
  --path=api/posts/[id] \
  --routeDescription="Single post operations" \
  --methods=GET,PUT,DELETE
```

### Webhook Handler
```bash
hypergen nextjs route add \
  --path=api/webhooks/stripe \
  --routeDescription="Stripe webhook handler" \
  --methods=POST
```

### File Upload
```bash
hypergen nextjs route add \
  --path=api/upload \
  --routeDescription="File upload endpoint" \
  --methods=POST
```

### Public API
```bash
hypergen nextjs route add \
  --path=api/v1/posts \
  --routeDescription="Public blog posts API" \
  --methods=GET
```

## HTTP Methods

### GET - Read Data
```typescript
export async function GET(request: Request) {
  const data = await fetchData()
  return Response.json(data)
}
```

### POST - Create Data
```typescript
export async function POST(request: Request) {
  const body = await request.json()
  const result = await createData(body)
  return Response.json(result, { status: 201 })
}
```

### PUT - Update (Replace)
```typescript
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const body = await request.json()
  const result = await updateData(params.id, body)
  return Response.json(result)
}
```

### PATCH - Update (Partial)
```typescript
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const body = await request.json()
  const result = await partialUpdate(params.id, body)
  return Response.json(result)
}
```

### DELETE - Remove Data
```typescript
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  await deleteData(params.id)
  return new Response(null, { status: 204 })
}
```

## Generated Files

- `app/{path}/route.ts` - API route handler

Example with GET and POST:

```typescript
import { NextResponse } from 'next/server'

// GET /api/users
export async function GET(request: Request) {
  try {
    // Fetch data from database
    const users = await db.users.findMany()

    return NextResponse.json(users)
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

// POST /api/users
export async function POST(request: Request) {
  try {
    const body = await request.json()

    // Validate and create user
    const user = await db.users.create({ data: body })

    return NextResponse.json(user, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

## Dynamic Routes

Routes with `[param]` in the path receive params:

```typescript
// app/api/posts/[id]/route.ts

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const post = await db.posts.findUnique({
    where: { id: params.id }
  })

  if (!post) {
    return NextResponse.json(
      { error: 'Post not found' },
      { status: 404 }
    )
  }

  return NextResponse.json(post)
}
```

## Request Handling

### Read JSON Body
```typescript
export async function POST(request: Request) {
  const body = await request.json()
  // Use body data
}
```

### Read Query Params
```typescript
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = searchParams.get('page')
  const limit = searchParams.get('limit')
}
```

### Read Headers
```typescript
export async function POST(request: Request) {
  const auth = request.headers.get('authorization')
  const contentType = request.headers.get('content-type')
}
```

### Read Cookies
```typescript
import { cookies } from 'next/headers'

export async function GET() {
  const cookieStore = cookies()
  const token = cookieStore.get('token')
}
```

### Handle FormData
```typescript
export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get('file') as File
  const name = formData.get('name') as string
}
```

## Response Types

### JSON Response
```typescript
return NextResponse.json({ message: 'Success' })
```

### With Status Code
```typescript
return NextResponse.json({ error: 'Not found' }, { status: 404 })
```

### With Headers
```typescript
return NextResponse.json(data, {
  headers: {
    'Cache-Control': 'public, max-age=3600',
  },
})
```

### Redirect
```typescript
return NextResponse.redirect(new URL('/login', request.url))
```

### Stream Response
```typescript
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue('chunk 1')
    controller.close()
  },
})

return new Response(stream)
```

## Options

- `--path` (required) - API route path relative to app/
- `--routeDescription` (required) - What this route does
- `--methods` - HTTP methods to generate (default: GET,POST)

## Best Practices

✅ **Use proper HTTP methods** - GET for reads, POST for creates, etc.
✅ **Validate input** - Always validate request data
✅ **Handle errors** - Use try/catch and return proper status codes
✅ **Use TypeScript** - Type your request/response data
✅ **Follow REST conventions** - Use standard status codes and patterns
✅ **Add authentication** - Protect sensitive endpoints
✅ **Use CORS headers** - For public APIs
✅ **Rate limit** - Prevent abuse
✅ **Log requests** - For debugging and monitoring

## Authentication Example

```typescript
import { auth } from '@/lib/auth'

export async function GET(request: Request) {
  const session = await auth(request)

  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const data = await fetchUserData(session.userId)
  return NextResponse.json(data)
}
```

## Validation Example

```typescript
import { z } from 'zod'

const userSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const validated = userSchema.parse(body)

    const user = await createUser(validated)
    return NextResponse.json(user, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

## CORS Example

```typescript
export async function GET(request: Request) {
  const data = await fetchData()

  return NextResponse.json(data, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
```

## Related Cookbooks

- [action](../action/) - Server Actions for form submissions
- [middleware](../middleware/) - Middleware for request processing
- [api](../api/) - Other API-related recipes (GraphQL, webhooks)
- [crud](../crud/) - Generate CRUD operations
