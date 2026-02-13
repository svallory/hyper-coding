# Add Middleware Recipe

Generate Next.js middleware for request processing before routes are rendered. Perfect for authentication, redirects, headers, and internationalization.

## Usage

```bash
# Authentication middleware
hypergen nextjs middleware add --purpose=auth

# Custom headers
hypergen nextjs middleware add --purpose=headers

# Internationalization
hypergen nextjs middleware add \
  --purpose=i18n \
  --matcher="/((?!api|_next/static|_next/image|favicon.ico).*)"

# Custom logic
hypergen nextjs middleware add \
  --purpose=custom \
  --matcher="/dashboard/:path*"
```

## Generated Files

- `middleware.ts` (or `src/middleware.ts` if using src directory)

## Variables

| Variable | Type | Description | Default |
|----------|------|-------------|---------|
| `purpose` | enum | Primary purpose of middleware | `auth` |
| `matcher` | string | Route matcher pattern | `"/((?!api\|_next/static\|_next/image\|favicon.ico).*)"` |

### Purpose Options

- **`auth`** - Authentication checks, redirect to login if unauthenticated
- **`redirect`** - Conditional redirects based on request properties
- **`headers`** - Add/modify response headers (CORS, security, etc.)
- **`i18n`** - Internationalization and locale detection
- **`custom`** - Blank template for custom logic

## Generated Output

### Authentication Middleware

```typescript
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Check for authentication token
  const token = request.cookies.get('token')

  if (!token) {
    // Redirect to login if not authenticated
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)',
}
```

### Headers Middleware

```typescript
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  // Add security headers
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'origin-when-cross-origin')
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  )

  return response
}

export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)',
}
```

### i18n Middleware

```typescript
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const locales = ['en', 'es', 'fr', 'de']
const defaultLocale = 'en'

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Check if pathname already has a locale
  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
  )

  if (pathnameHasLocale) return NextResponse.next()

  // Detect locale from Accept-Language header or cookie
  const locale = request.cookies.get('locale')?.value || defaultLocale

  // Redirect to path with locale
  return NextResponse.redirect(
    new URL(`/${locale}${pathname}`, request.url)
  )
}

export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)',
}
```

## Matcher Patterns

Common matcher patterns:

```typescript
// All routes
matcher: '/:path*'

// Dashboard routes only
matcher: '/dashboard/:path*'

// Multiple patterns
matcher: ['/dashboard/:path*', '/admin/:path*']

// Exclude API and static files
matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)'

// Specific routes
matcher: ['/login', '/register', '/forgot-password']
```

## Customization Examples

### Role-Based Access Control

```typescript
export function middleware(request: NextRequest) {
  const role = request.cookies.get('user-role')?.value
  const pathname = request.nextUrl.pathname

  // Protect admin routes
  if (pathname.startsWith('/admin')) {
    if (role !== 'admin') {
      return NextResponse.redirect(new URL('/unauthorized', request.url))
    }
  }

  // Protect user routes
  if (pathname.startsWith('/dashboard')) {
    if (!role || !['user', 'admin'].includes(role)) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  return NextResponse.next()
}
```

### A/B Testing

```typescript
export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  if (pathname === '/') {
    // Get or set A/B test variant
    const variant = request.cookies.get('ab-variant')?.value
    const nextVariant = variant || (Math.random() < 0.5 ? 'A' : 'B')

    const response = NextResponse.next()

    if (!variant) {
      response.cookies.set('ab-variant', nextVariant)
    }

    // Rewrite to variant page
    if (nextVariant === 'B') {
      return NextResponse.rewrite(new URL('/home-b', request.url))
    }
  }

  return NextResponse.next()
}
```

### Device Detection

```typescript
export function middleware(request: NextRequest) {
  const userAgent = request.headers.get('user-agent') || ''
  const isMobile = /mobile/i.test(userAgent)
  const pathname = request.nextUrl.pathname

  // Redirect mobile users to mobile-optimized pages
  if (isMobile && !pathname.startsWith('/m')) {
    return NextResponse.redirect(new URL(`/m${pathname}`, request.url))
  }

  return NextResponse.next()
}
```

### Rate Limiting

```typescript
const rateLimit = new Map()

export function middleware(request: NextRequest) {
  const ip = request.ip || request.headers.get('x-forwarded-for') || 'unknown'
  const now = Date.now()
  const windowMs = 60000 // 1 minute
  const max = 100 // max requests per window

  const record = rateLimit.get(ip) || { count: 0, resetTime: now + windowMs }

  if (now > record.resetTime) {
    record.count = 1
    record.resetTime = now + windowMs
  } else {
    record.count++
  }

  rateLimit.set(ip, record)

  if (record.count > max) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429 }
    )
  }

  return NextResponse.next()
}
```

## Best Practices

✅ **Keep middleware fast** - Runs on every request
✅ **Use specific matchers** - Only run on routes that need it
✅ **Avoid database calls** - Use edge-compatible data stores
✅ **Handle errors gracefully** - Always return a valid Response
✅ **Test thoroughly** - Middleware affects all matched routes
✅ **Use environment variables** - For configuration
✅ **Log sparingly** - Avoid excessive logging
✅ **Consider Edge Runtime limits** - No Node.js APIs

## Edge Runtime Limitations

Middleware runs in the Edge Runtime, which has limitations:

- **No Node.js APIs** - fs, crypto, etc. not available
- **Limited npm packages** - Must be Edge-compatible
- **Response size limit** - Typically 4MB
- **Execution time limit** - Must respond quickly

## Troubleshooting

### Middleware not running
1. Check file name is exactly `middleware.ts`
2. Verify file location (root or src/)
3. Check matcher pattern matches your routes

### Infinite redirects
1. Ensure redirect target is not matched by middleware
2. Add redirect destination to matcher exclusions
3. Check for circular redirect logic

### TypeScript errors
1. Import types from 'next/server'
2. Use NextRequest and NextResponse types
3. Run `bun run build` to check for errors

## Related Recipes

- [action](../../action/) - Server Actions
- [route](../../route/) - API routes
- [page](../../page/) - Protected pages
