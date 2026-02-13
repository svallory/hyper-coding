# Add Error Boundary Recipe

Generate error boundaries for Next.js App Router route segments to gracefully handle runtime errors.

## Usage

```bash
# Basic error boundary
hypergen nextjs error add --path=dashboard

# With reset button
hypergen nextjs error add \
  --path=dashboard \
  --withReset

# With not-found page
hypergen nextjs error add \
  --path="blog/[slug]" \
  --withReset \
  --withNotFound
```

## Generated Files

**Basic:**
- `app/{path}/error.tsx`

**With --withNotFound:**
- `app/{path}/error.tsx`
- `app/{path}/not-found.tsx`

## Variables

| Variable | Type | Description | Required | Default |
|----------|------|-------------|----------|---------|
| `path` | string | Route segment path relative to app/ | Yes | - |
| `withReset` | boolean | Include retry/reset button | No | `true` |
| `withNotFound` | boolean | Also generate not-found.tsx | No | `false` |

## Generated Output

### Error Boundary (error.tsx)

```typescript
'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log error to error reporting service
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          Something went wrong!
        </h2>
        <p className="text-gray-600 mb-6">{error.message}</p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
```

### Not Found Page (not-found.tsx)

When `--withNotFound` is used:

```typescript
import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          404 - Not Found
        </h2>
        <p className="text-gray-600 mb-6">
          Could not find the requested resource
        </p>
        <Link
          href="/"
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors inline-block"
        >
          Go Home
        </Link>
      </div>
    </div>
  )
}
```

## How It Works

Next.js automatically wraps route segments with error boundaries:

```typescript
// Automatically created by Next.js
<ErrorBoundary fallback={<Error />}>
  <Page />
</ErrorBoundary>
```

Catches:
- Runtime errors in Server/Client Components
- Rendering errors
- Data fetching errors
- Any JavaScript errors in the segment

## Usage Examples

### Dashboard Error Handler

```bash
hypergen nextjs error add \
  --path=dashboard \
  --withReset
```

Customize with error logging:

```typescript
'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log to Sentry
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <h2>Something went wrong in the dashboard!</h2>
      <p>Error ID: {error.digest}</p>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
```

### Blog Post with 404

```bash
hypergen nextjs error add \
  --path="blog/[slug]" \
  --withReset \
  --withNotFound
```

Use `notFound()` in your page:

```typescript
// app/blog/[slug]/page.tsx
import { notFound } from 'next/navigation'

export default async function Page({ params }: { params: { slug: string } }) {
  const post = await fetchPost(params.slug)

  if (!post) {
    notFound() // Shows not-found.tsx
  }

  return <article>{post.title}</article>
}
```

### E-commerce Product Page

```bash
hypergen nextjs error add \
  --path="products/[id]" \
  --withNotFound
```

## Error Boundary Hierarchy

Error boundaries catch errors in their segment and children:

```
app/
├── error.tsx                     # Catches all route errors
├── page.tsx
└── dashboard/
    ├── error.tsx                 # Catches /dashboard/* errors
    ├── page.tsx
    └── settings/
        ├── error.tsx             # Catches /dashboard/settings errors
        └── page.tsx
```

## Reset Functionality

The `reset()` function attempts to re-render the segment:

```typescript
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div>
      <h2>Something went wrong!</h2>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
```

**Note:** Reset works best for transient errors (network issues). For persistent errors, users may need to navigate away.

## Customization Examples

### Error with Details Toggle

```typescript
'use client'

import { useState } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <h2 className="text-2xl font-bold mb-4">Something went wrong!</h2>

        <button
          onClick={reset}
          className="w-full px-4 py-2 bg-blue-500 text-white rounded mb-4"
        >
          Try again
        </button>

        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-sm text-gray-600 underline"
        >
          {showDetails ? 'Hide' : 'Show'} error details
        </button>

        {showDetails && (
          <pre className="mt-4 p-4 bg-gray-100 rounded text-xs overflow-auto">
            {error.message}
            {'\n\n'}
            {error.stack}
          </pre>
        )}
      </div>
    </div>
  )
}
```

### Error with Support Contact

```typescript
'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const supportEmail = 'support@example.com'
  const subject = `Error Report: ${error.digest || 'Unknown'}`
  const body = `Error: ${error.message}\n\nError ID: ${error.digest || 'N/A'}`
  const mailtoLink = `mailto:${supportEmail}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-4">Something went wrong!</h2>
        <p className="text-gray-600 mb-6">
          We apologize for the inconvenience.
        </p>

        <div className="space-x-4">
          <button
            onClick={reset}
            className="px-4 py-2 bg-blue-500 text-white rounded"
          >
            Try again
          </button>

          <a
            href={mailtoLink}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded inline-block"
          >
            Contact Support
          </a>
        </div>

        {error.digest && (
          <p className="mt-4 text-sm text-gray-500">Error ID: {error.digest}</p>
        )}
      </div>
    </div>
  )
}
```

### Styled Error Page

```typescript
'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <div className="text-center">
          {/* Error Icon */}
          <div className="text-6xl mb-4">⚠️</div>

          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Oops! Something went wrong
          </h2>

          <p className="text-gray-600 mb-6">
            We're sorry for the inconvenience. Please try again.
          </p>

          {error.digest && (
            <p className="text-sm text-gray-500 mb-6 font-mono">
              Error ID: {error.digest}
            </p>
          )}

          <button
            onClick={reset}
            className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  )
}
```

## Error Logging

Integrate with error tracking services:

```typescript
'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log to error tracking service
    Sentry.captureException(error, {
      tags: {
        errorDigest: error.digest,
      },
    })
  }, [error])

  return (
    <div>
      <h2>Something went wrong!</h2>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
```

## Limitations

Error boundaries do **NOT** catch:

- Errors in event handlers (use try/catch)
- Errors in async code outside React
- Errors in the error boundary itself
- Errors in Server Components in layouts (caught by parent layout's error boundary)

## Testing

Trigger error for testing:

```typescript
// app/test-error/page.tsx
'use client'

export default function TestErrorPage() {
  return (
    <button onClick={() => { throw new Error('Test error') }}>
      Trigger Error
    </button>
  )
}
```

## Best Practices

✅ **Add early** - Don't wait for errors to happen
✅ **Log errors** - Integrate with error tracking
✅ **Provide recovery** - Reset button, navigation links
✅ **User-friendly messages** - Hide technical details
✅ **Include error IDs** - Use digest for support
✅ **Test error states** - Manually trigger errors
✅ **Nest boundaries** - Isolate errors to segments
✅ **Add not-found pages** - Handle 404s gracefully

## Related Recipes

- [page/add](../../page/add/) - Generate pages with error handling
- [loading/add](../../loading/add/) - Add loading states
- [layout/add](../../layout/add/) - Generate layouts
