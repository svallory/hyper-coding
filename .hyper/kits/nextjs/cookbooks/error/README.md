# Error Cookbook

Generate error boundaries for Next.js App Router route segments to gracefully handle runtime errors.

## Quick Start

Add error boundary to a route:

```bash
hypergen nextjs error add --path=dashboard
```

With not-found page:

```bash
hypergen nextjs error add \
  --path=blog/[slug] \
  --withReset \
  --withNotFound
```

## Recipes

### [add](./add/) - Add Error Boundary
Generate `error.tsx` that catches errors in a route segment and displays fallback UI. Optionally generates `not-found.tsx` for 404 handling.

**Features:**
- Catches JavaScript errors in Server/Client Components
- Shows custom error UI
- Optional reset/retry functionality
- Automatic error isolation to segment
- Optional 404 not-found page

## What is an Error Boundary?

In Next.js App Router, `error.tsx` creates an error boundary using React Error Boundary. It:

- Catches runtime errors in the route segment
- Shows fallback UI instead of crashing
- Isolates errors to specific segments
- Provides reset functionality
- Automatically wraps child pages

## Common Use Cases

### Dashboard Error Handling
```bash
hypergen nextjs error add \
  --path=dashboard \
  --withReset
```

### Blog Post Errors
```bash
hypergen nextjs error add \
  --path=blog/[slug] \
  --withReset \
  --withNotFound
```

### API Error Boundaries
```bash
hypergen nextjs error add \
  --path=api/users \
  --withReset
```

### E-commerce Product Pages
```bash
hypergen nextjs error add \
  --path=products/[id] \
  --withNotFound
```

### Admin Panel
```bash
hypergen nextjs error add \
  --path=admin \
  --withReset
```

## Generated Files

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
    <div className="flex min-h-screen flex-col items-center justify-center">
      <h2 className="text-2xl font-bold mb-4">Something went wrong!</h2>
      <p className="text-gray-600 mb-6">{error.message}</p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Try again
      </button>
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
    <div className="flex min-h-screen flex-col items-center justify-center">
      <h2 className="text-2xl font-bold mb-4">404 - Not Found</h2>
      <p className="text-gray-600 mb-6">Could not find the requested resource</p>
      <Link
        href="/"
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Go Home
      </Link>
    </div>
  )
}
```

## Options

- `--path` (required) - Route segment path relative to app/
- `--withReset` - Include retry/reset button (default: true)
- `--withNotFound` - Also generate not-found.tsx (default: false)

## Error Boundary Hierarchy

Error boundaries catch errors in their segment and below:

```
app/
├── error.tsx                     # Catches errors in all routes
├── page.tsx
└── dashboard/
    ├── error.tsx                 # Catches errors in /dashboard/*
    ├── page.tsx
    └── settings/
        ├── error.tsx             # Catches errors in /dashboard/settings
        └── page.tsx
```

## Error Types

### Runtime Errors
Caught by error.tsx:
- JavaScript errors
- Server Component errors
- Client Component errors
- Data fetching errors
- Rendering errors

```typescript
// This error is caught by error.tsx
export default async function Page() {
  const data = await fetch('https://api.example.com/data')
  const json = await data.json()

  // If this throws, error.tsx shows
  if (!json.title) {
    throw new Error('Missing title')
  }

  return <div>{json.title}</div>
}
```

### Not Found Errors
Caught by not-found.tsx:

```typescript
import { notFound } from 'next/navigation'

export default async function Page({ params }: { params: { id: string } }) {
  const post = await fetchPost(params.id)

  if (!post) {
    notFound() // Shows not-found.tsx
  }

  return <article>{post.title}</article>
}
```

## Reset Functionality

The `reset` function attempts to re-render the segment:

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
    <div>
      <h2>Something went wrong!</h2>
      <button onClick={reset}>
        Try again
      </button>
    </div>
  )
}
```

**Note**: Reset works best for transient errors (network issues, race conditions). For persistent errors, it may not help.

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
    // Log to Sentry, LogRocket, etc.
    Sentry.captureException(error)
  }, [error])

  return (
    <div>
      <h2>Something went wrong!</h2>
      <p>Error ID: {error.digest}</p>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
```

## Common Patterns

### Error with Details
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
    <div>
      <h2>Something went wrong!</h2>
      <button onClick={reset}>Try again</button>
      <button onClick={() => setShowDetails(!showDetails)}>
        {showDetails ? 'Hide' : 'Show'} Details
      </button>
      {showDetails && (
        <pre className="mt-4 p-4 bg-gray-100 rounded">
          {error.message}
          {error.stack}
        </pre>
      )}
    </div>
  )
}
```

### Error with Support Link
```typescript
'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const supportUrl = `mailto:support@example.com?subject=Error ${error.digest}&body=${encodeURIComponent(error.message)}`

  return (
    <div>
      <h2>Something went wrong!</h2>
      <button onClick={reset}>Try again</button>
      <a href={supportUrl}>Contact Support</a>
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
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Oops! Something went wrong
          </h2>
          <p className="text-gray-600 mb-6">
            We're sorry for the inconvenience. Please try again.
          </p>
          {error.digest && (
            <p className="text-sm text-gray-500 mb-6">
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

## Best Practices

✅ **Add error boundaries early** - Don't wait for errors to happen
✅ **Log errors** - Integrate with error tracking services
✅ **Provide recovery options** - Reset button, navigation links
✅ **Show user-friendly messages** - Hide technical details from users
✅ **Include error IDs** - Use digest for support tracking
✅ **Test error states** - Manually trigger errors during development
✅ **Use nested boundaries** - Isolate errors to specific segments
✅ **Add not-found pages** - Handle 404s gracefully

## Limitations

Error boundaries do **NOT** catch:

- Errors in event handlers (use try/catch)
- Errors in async code outside React (use try/catch)
- Errors in the error boundary itself
- Errors in Server Components rendered in layouts (caught by parent layout's error boundary)

## Testing Error Boundaries

### Trigger Error in Development

```typescript
// app/test/page.tsx
'use client'

export default function TestErrorPage() {
  const [shouldError, setShouldError] = useState(false)

  if (shouldError) {
    throw new Error('Test error')
  }

  return <button onClick={() => setShouldError(true)}>Trigger Error</button>
}
```

### Test 404

```typescript
// app/test/page.tsx
import { notFound } from 'next/navigation'

export default function TestNotFoundPage() {
  notFound()
}
```

## Related Cookbooks

- [page](../page/) - Generate pages with error handling
- [loading](../loading/) - Add loading states
- [layout](../layout/) - Generate layouts (can also have error boundaries)
- [component](../component/) - Create error display components
