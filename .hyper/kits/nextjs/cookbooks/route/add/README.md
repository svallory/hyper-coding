# Add API Route Recipe

Generate API route handlers for Next.js App Router with support for all HTTP methods.

## Usage

```bash
# Basic GET/POST route
hypergen nextjs route add --path=api/users

# Specific methods
hypergen nextjs route add \
  --path=api/posts/[id] \
  --routeDescription="Single post operations" \
  --methods=GET,PUT,DELETE

# Webhook endpoint
hypergen nextjs route add \
  --path=api/webhooks/stripe \
  --routeDescription="Stripe webhook handler" \
  --methods=POST
```

## Generated Files

- `app/{path}/route.ts`

## Variables

| Variable | Type | Description | Required | Default |
|----------|------|-------------|----------|---------|
| `path` | string | API route path relative to app/ | Yes | - |
| `routeDescription` | string | What this route does | Yes | - |
| `methods` | enum[] | HTTP methods to generate | No | `[GET, POST]` |

### Available Methods

- `GET` - Read data
- `POST` - Create data
- `PUT` - Update (replace) data
- `PATCH` - Update (partial) data
- `DELETE` - Remove data

## Generated Output

### GET and POST Handlers

```typescript
import { NextResponse } from 'next/server'

// GET /api/users
export async function GET(request: Request) {
  try {
    // TODO: Fetch data from database
    const users = [] // Replace with actual data fetching

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

    // TODO: Validate and create user
    const user = body // Replace with actual creation logic

    return NextResponse.json(user, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

### Dynamic Route (with params)

```typescript
// app/api/posts/[id]/route.ts

import { NextResponse } from 'next/server'

// GET /api/posts/[id]
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    // Access route parameter
    const post = await fetchPost(params.id)

    if (!post) {
      return NextResponse.json(
        { error: 'Post not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(post)
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

// PUT /api/posts/[id]
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const updated = await updatePost(params.id, body)

    return NextResponse.json(updated)
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

// DELETE /api/posts/[id]
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await deletePost(params.id)

    return new Response(null, { status: 204 })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

## Usage Examples

### REST API for Users

```bash
hypergen nextjs route add \
  --path=api/users \
  --routeDescription="User CRUD operations" \
  --methods=GET,POST
```

Then add to the generated file:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { userSchema } from '@/lib/schemas/user-schema'

export async function GET(request: Request) {
  const users = await prisma.user.findMany()
  return NextResponse.json(users)
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const validated = userSchema.parse(body)

    const user = await prisma.user.create({ data: validated })

    return NextResponse.json(user, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 })
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

### Single Resource Endpoint

```bash
hypergen nextjs route add \
  --path=api/posts/[id] \
  --routeDescription="Single post operations" \
  --methods=GET,PUT,DELETE
```

### File Upload

```bash
hypergen nextjs route add \
  --path=api/upload \
  --routeDescription="File upload endpoint" \
  --methods=POST
```

Then customize:

```typescript
export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get('file') as File

  if (!file) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  }

  // Upload to S3, Cloudinary, etc.
  const url = await uploadFile(file)

  return NextResponse.json({ url }, { status: 201 })
}
```

### Webhook Handler

```bash
hypergen nextjs route add \
  --path=api/webhooks/stripe \
  --routeDescription="Stripe webhook handler" \
  --methods=POST
```

Then customize:

```typescript
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')!

  try {
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )

    switch (event.type) {
      case 'checkout.session.completed':
        // Handle successful checkout
        break
      case 'customer.subscription.updated':
        // Handle subscription update
        break
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    return NextResponse.json({ error: 'Webhook error' }, { status: 400 })
  }
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

### Read Query Parameters

```typescript
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = searchParams.get('page') || '1'
  const limit = searchParams.get('limit') || '10'

  const users = await fetchUsers({
    page: parseInt(page),
    limit: parseInt(limit),
  })

  return NextResponse.json(users)
}
```

### Read Headers

```typescript
export async function POST(request: Request) {
  const auth = request.headers.get('authorization')

  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = auth.substring(7)
  // Verify token
}
```

### Read Cookies

```typescript
import { cookies } from 'next/headers'

export async function GET() {
  const cookieStore = cookies()
  const token = cookieStore.get('session')

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
```

### Handle FormData

```typescript
export async function POST(request: Request) {
  const formData = await request.formData()
  const name = formData.get('name') as string
  const file = formData.get('file') as File

  // Process form data
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
    'X-Custom-Header': 'value',
  },
})
```

### Empty Response

```typescript
return new Response(null, { status: 204 })
```

### Redirect

```typescript
return NextResponse.redirect(new URL('/success', request.url))
```

## Best Practices

✅ **Use proper HTTP methods** - GET for reads, POST for creates
✅ **Validate input** - Always validate request data
✅ **Handle errors** - Use try/catch and return proper status codes
✅ **Type your data** - Use TypeScript for request/response
✅ **Use Zod validation** - For type-safe input validation
✅ **Add authentication** - Protect sensitive endpoints
✅ **Return proper status codes** - 200, 201, 400, 401, 404, 500
✅ **Use CORS headers** - For public APIs
✅ **Rate limit** - Prevent abuse

## CORS Support

For public APIs:

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

## Related Recipes

- [action](../../action/) - Server Actions for form submissions
- [middleware](../../middleware/add/) - Middleware for auth/headers
- [crud](../../crud/) - Generate CRUD operations
