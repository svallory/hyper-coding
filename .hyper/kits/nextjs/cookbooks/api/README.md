# API Cookbook

Generate REST API routes, webhook handlers, and GraphQL endpoints for Next.js applications.

## Overview

This cookbook provides three powerful recipes for building APIs in Next.js:

1. **REST API Routes** - Type-safe REST endpoints with validation and authentication
2. **Webhook Handlers** - Secure webhook receivers with signature verification
3. **GraphQL Endpoint** - GraphQL API with schema-first development

## When to Use Each Recipe

### REST API Routes (`api route`)

Use when you need:
- Traditional REST endpoints for external APIs
- Public APIs for mobile apps or third-party integrations
- Webhook senders (your app calling external services)
- Simple CRUD operations over HTTP
- APIs that don't need real-time updates

**Perfect for:**
- Mobile app backends
- Third-party integrations
- Microservices communication
- Public APIs

### Webhook Handlers (`api webhook`)

Use when you need:
- Receive events from external services (Stripe, GitHub, etc.)
- Process asynchronous notifications
- Integrate with SaaS platforms
- Handle payment provider callbacks
- Sync data from external systems

**Perfect for:**
- Payment processing (Stripe, PayPal)
- Git hosting webhooks (GitHub, GitLab)
- E-commerce platforms (Shopify)
- Authentication providers (Clerk)
- Email services (Resend, SendGrid)

### GraphQL Endpoint (`api graphql`)

Use when you need:
- Flexible querying with nested relationships
- Reduce over-fetching and under-fetching
- Strong typing and schema validation
- Real-time subscriptions (future)
- Complex data requirements

**Perfect for:**
- Complex client applications
- Mobile apps with limited bandwidth
- Admin dashboards with varied data needs
- APIs with many related entities

## Quick Start

### Install the Kit

```bash
npm install @hypergen/nextjs-kit
```

### Generate a REST API

```bash
# Basic CRUD API
hypergen api route users --methods GET,POST,PUT,DELETE

# With authentication
hypergen api route posts --methods GET,POST --auth

# With CORS for external access
hypergen api route public-data --methods GET --cors
```

### Generate a Webhook Handler

```bash
# Stripe webhook
hypergen api webhook stripe --provider stripe

# GitHub webhook
hypergen api webhook github --provider github

# Custom webhook
hypergen api webhook custom-service
```

### Generate a GraphQL Endpoint

```bash
# Basic GraphQL setup
hypergen api graphql

# With authentication
hypergen api graphql --auth
```

## Recipe Comparison

| Feature | REST Route | Webhook | GraphQL |
|---------|-----------|---------|---------|
| HTTP Methods | GET, POST, PUT, PATCH, DELETE | POST only | POST only |
| Validation | Zod schemas | Signature verification | Schema validation |
| Authentication | Optional (NextAuth, Clerk, Lucia) | N/A | Optional |
| CORS | Optional | N/A | Built-in |
| ORM Support | Prisma, Drizzle | N/A | Prisma, Drizzle |
| Use Case | External APIs | Receive events | Flexible queries |

## Architecture

### REST API Flow

```
Client Request
  ↓
Next.js Route Handler (app/api/[name]/route.ts)
  ↓
Authentication Check (if enabled)
  ↓
Zod Validation (if enabled)
  ↓
Business Logic / Database Query
  ↓
JSON Response
```

### Webhook Flow

```
External Service (Stripe, GitHub, etc.)
  ↓
Next.js Route Handler (app/api/webhooks/[name]/route.ts)
  ↓
Signature Verification
  ↓
Event Type Routing
  ↓
Event Handler
  ↓
200 OK Response (immediately)
  ↓
Async Processing (optional)
```

### GraphQL Flow

```
Client Query
  ↓
GraphQL Yoga Server (app/api/graphql/route.ts)
  ↓
Schema Validation
  ↓
Context Creation (auth, database)
  ↓
Resolver Execution
  ↓
Response with Requested Fields
```

## Directory Structure

```
your-nextjs-app/
├── app/
│   └── api/
│       ├── users/              # REST API endpoint
│       │   └── route.ts
│       ├── webhooks/           # Webhook handlers
│       │   ├── stripe/
│       │   │   └── route.ts
│       │   └── github/
│       │       └── route.ts
│       └── graphql/            # GraphQL endpoint
│           └── route.ts
├── lib/
│   ├── schemas/                # Zod validation schemas
│   │   └── api-users-schema.ts
│   ├── webhooks/               # Webhook verifiers
│   │   ├── stripe-verifier.ts
│   │   └── github-verifier.ts
│   └── graphql/                # GraphQL setup
│       ├── schema.ts
│       ├── resolvers.ts
│       └── context.ts
```

## Common Patterns

### Pagination

```typescript
// REST API
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get('page')) || 1
  const limit = Number(searchParams.get('limit')) || 10

  const [items, total] = await Promise.all([
    prisma.user.findMany({ skip: (page - 1) * limit, take: limit }),
    prisma.user.count(),
  ])

  return NextResponse.json({
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  })
}
```

### Error Handling

```typescript
// Validation errors
if (error instanceof z.ZodError) {
  return NextResponse.json(
    { error: 'Validation error', details: error.errors },
    { status: 400 }
  )
}

// Authentication errors
if (!user) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

// Not found errors
if (!resource) {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

// Server errors
return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
```

### Rate Limiting

```typescript
import { ratelimit } from '@/lib/ratelimit'

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const { success } = await ratelimit.limit(ip)

  if (!success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // Continue with handler logic...
}
```

## Environment Variables

### REST APIs

```env
# Authentication (if using)
NEXTAUTH_SECRET=...
NEXTAUTH_URL=...

# Database
DATABASE_URL=...

# CORS (if enabled)
ALLOWED_ORIGINS=https://example.com,https://app.example.com
```

### Webhooks

```env
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# GitHub
GITHUB_WEBHOOK_SECRET=your_secret

# Shopify
SHOPIFY_WEBHOOK_SECRET=your_secret

# Clerk
CLERK_WEBHOOK_SECRET=whsec_...

# Resend
RESEND_WEBHOOK_SECRET=your_secret
```

### GraphQL

```env
# Same as REST APIs
# Plus any GraphQL-specific config
```

## Testing

### REST API Testing

```bash
# GET request
curl http://localhost:3000/api/users?page=1&limit=10

# POST request
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"John","email":"john@example.com"}'
```

### Webhook Testing

```bash
# Stripe CLI
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger checkout.session.completed

# GitHub (use ngrok)
ngrok http 3000
# Configure webhook in GitHub to https://xxx.ngrok.io/api/webhooks/github
```

### GraphQL Testing

Visit `http://localhost:3000/api/graphql` in development for the interactive playground.

## Best Practices

### Security

1. **Always validate inputs** using Zod or similar
2. **Verify webhook signatures** to prevent spoofing
3. **Use authentication** for sensitive endpoints
4. **Enable CORS** only for specific origins in production
5. **Rate limit** public endpoints
6. **Sanitize errors** before sending to clients

### Performance

1. **Use database indexes** for frequently queried fields
2. **Implement pagination** for list endpoints
3. **Cache responses** when appropriate
4. **Use DataLoader** in GraphQL to prevent N+1 queries
5. **Return 200 OK immediately** for webhooks, process async

### Monitoring

1. **Log all API requests** with structured logging
2. **Track error rates** and response times
3. **Monitor webhook delivery** failures
4. **Set up alerts** for critical endpoints
5. **Use APM tools** (Sentry, DataDog, etc.)

## Next Steps

1. Choose the appropriate recipe for your use case
2. Generate the API endpoint using the CLI
3. Customize the generated code for your needs
4. Add tests for your endpoints
5. Deploy and monitor in production

## Resources

- [Next.js API Routes](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- [Zod Validation](https://zod.dev/)
- [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server/docs)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [GitHub Webhooks](https://docs.github.com/en/webhooks)

## Support

For issues or questions:
- Check the individual recipe READMEs
- Open an issue on GitHub
- Join our Discord community
