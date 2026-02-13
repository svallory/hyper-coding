# Middleware Cookbook

Generate Next.js middleware for authentication, redirects, headers, internationalization, and custom request processing.

## Quick Start

Generate middleware for authentication:

```bash
hypergen nextjs middleware add --purpose=auth
```

## Recipes

### [add](./add/) - Add Middleware
Generate middleware.ts in your project root (or src/ directory). Middleware runs before every request and can modify requests, responses, or redirect users.

**Features:**
- Authentication checks
- Redirects based on conditions
- Custom header modification
- Internationalization (i18n)
- Custom request processing

## What is Middleware?

Next.js middleware runs before your application routes. It's perfect for:

- **Authentication**: Protect routes, redirect to login
- **Authorization**: Check user roles/permissions
- **Redirects**: Redirect based on conditions (locale, device, A/B testing)
- **Header Modification**: Add security headers, CORS, custom headers
- **Internationalization**: Detect and redirect based on locale
- **Analytics**: Log requests, track page views
- **Bot Detection**: Block or handle bot traffic differently

## Common Use Cases

### Protect Dashboard Routes
```bash
hypergen nextjs middleware add \
  --purpose=auth \
  --matcher="/dashboard/:path*"
```

### Add Security Headers
```bash
hypergen nextjs middleware add \
  --purpose=headers
```

### Internationalization
```bash
hypergen nextjs middleware add \
  --purpose=i18n \
  --matcher="/((?!api|_next/static|_next/image|favicon.ico).*)"
```

### Custom Business Logic
```bash
hypergen nextjs middleware add \
  --purpose=custom
```

## Generated Files

- `middleware.ts` (or `src/middleware.ts` if using src directory)

Example output:

```typescript
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Authentication logic
  const token = request.cookies.get('token')

  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/dashboard/:path*',
}
```

## Matcher Patterns

The `matcher` config specifies which routes the middleware runs on:

| Pattern | Matches |
|---------|---------|
| `'/dashboard/:path*'` | All routes under /dashboard |
| `'/api/:path*'` | All API routes |
| `'/((?!api\|_next/static\|favicon.ico).*)'` | All routes except API, static files, favicon |
| `['/dashboard/:path*', '/profile/:path*']` | Multiple route patterns |
| `'/:path*'` | All routes |

## Middleware Options

### Authentication
Checks for authentication token and redirects to login if missing.

### Redirects
Conditional redirects based on request properties (user-agent, locale, cookies).

### Headers
Adds or modifies response headers (security, CORS, caching).

### Internationalization
Detects user locale and redirects to appropriate language version.

### Custom
Template for your own middleware logic.

## Best Practices

✅ **Use specific matchers** - Only run middleware on routes that need it
✅ **Keep it fast** - Middleware runs on every request
✅ **Avoid heavy operations** - No database calls or external API requests
✅ **Use Edge Runtime** - Middleware runs on the Edge for best performance
✅ **Handle errors gracefully** - Always return a valid Response
✅ **Test thoroughly** - Middleware affects all matched routes
✅ **Use environment variables** - For configuration like API keys

## Common Patterns

### Authentication Check
```typescript
export function middleware(request: NextRequest) {
  const token = request.cookies.get('session')

  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}
```

### Add Security Headers
```typescript
export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'origin-when-cross-origin')

  return response
}
```

### Role-Based Access
```typescript
export function middleware(request: NextRequest) {
  const role = request.cookies.get('user-role')?.value

  if (request.nextUrl.pathname.startsWith('/admin') && role !== 'admin') {
    return NextResponse.redirect(new URL('/unauthorized', request.url))
  }

  return NextResponse.next()
}
```

### Locale Detection
```typescript
export function middleware(request: NextRequest) {
  const locale = request.cookies.get('locale')?.value || 'en'
  const pathname = request.nextUrl.pathname

  if (!pathname.startsWith(`/${locale}`)) {
    return NextResponse.redirect(
      new URL(`/${locale}${pathname}`, request.url)
    )
  }

  return NextResponse.next()
}
```

## Limitations

- **No direct database access** - Use Edge-compatible data stores or API calls
- **No Node.js APIs** - Runs in Edge Runtime (subset of Node.js)
- **Response size limit** - Keep responses under 4MB
- **Execution time limit** - Must respond quickly (typically <50ms)

## Troubleshooting

### Middleware not running
- Check that `matcher` pattern matches your route
- Ensure file is named exactly `middleware.ts`
- Verify file is in project root or `src/` directory

### Infinite redirects
- Make sure redirect target is not matched by middleware
- Check for circular redirect logic
- Exclude redirect destination from matcher

### Performance issues
- Use specific matchers to limit execution
- Avoid heavy computations
- Remove unnecessary logging
- Consider moving logic to route handlers

## Related Cookbooks

- [action](../action/) - Server Actions for form submissions
- [api](../api/) - API route handlers
- [page](../page/) - Protected pages that require middleware
