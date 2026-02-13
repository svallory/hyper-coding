# Add Page Recipe

Generate a new page for Next.js App Router with optional layout, loading, and error boundaries.

## Usage

```bash
# Simple page
hypergen nextjs page add --path=about

# Blog post page
hypergen nextjs page add \
  --path="blog/[slug]" \
  --pageDescription="Individual blog post" \
  --withLoading

# Dashboard page with all features
hypergen nextjs page add \
  --path=dashboard/settings \
  --pageDescription="User settings page" \
  --withLayout \
  --withLoading \
  --withError
```

## Generated Files

**Basic page:**
- `app/{path}/page.tsx`

**With options:**
- `app/{path}/page.tsx` (always)
- `app/{path}/layout.tsx` (if `--withLayout`)
- `app/{path}/loading.tsx` (if `--withLoading`)
- `app/{path}/error.tsx` (if `--withError`)

## Variables

| Variable | Type | Description | Required | Default |
|----------|------|-------------|----------|---------|
| `path` | string | Route path relative to app/ | Yes | - |
| `pageDescription` | string | Brief description of the page | Yes | - |
| `withLayout` | boolean | Generate layout.tsx | No | `false` |
| `withLoading` | boolean | Generate loading.tsx | No | `false` |
| `withError` | boolean | Generate error.tsx | No | `false` |

## Route Types

### Static Routes
```bash
hypergen nextjs page add --path=about
# Creates: app/about/page.tsx
# URL: /about
```

### Dynamic Routes
```bash
hypergen nextjs page add --path="posts/[id]"
# Creates: app/posts/[id]/page.tsx
# URL: /posts/1, /posts/2, etc.
```

### Nested Routes
```bash
hypergen nextjs page add --path="blog/posts/[slug]"
# Creates: app/blog/posts/[slug]/page.tsx
# URL: /blog/posts/hello-world
```

### Catch-All Routes
```bash
hypergen nextjs page add --path="docs/[...slug]"
# Creates: app/docs/[...slug]/page.tsx
# URL: /docs/a, /docs/a/b, /docs/a/b/c
```

### Optional Catch-All
```bash
hypergen nextjs page add --path="shop/[[...categories]]"
# Creates: app/shop/[[...categories]]/page.tsx
# URL: /shop, /shop/electronics, /shop/electronics/phones
```

### Route Groups
```bash
hypergen nextjs page add --path="(marketing)/pricing"
# Creates: app/(marketing)/pricing/page.tsx
# URL: /pricing (group name omitted)
```

## Generated Output

### Simple Page

```typescript
export default function AboutPage() {
  return (
    <div>
      <h1>About</h1>
      <p>About us page</p>
    </div>
  )
}
```

### Dynamic Page

```typescript
export default function PostPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <h1>Post {params.id}</h1>
    </div>
  )
}
```

### Async Server Component

```typescript
async function getData(slug: string) {
  const res = await fetch(`https://api.example.com/posts/${slug}`)
  return res.json()
}

export default async function PostPage({
  params
}: {
  params: { slug: string }
}) {
  const post = await getData(params.slug)

  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
    </article>
  )
}
```

## With Layout

When `--withLayout` is used, also generates:

```typescript
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex">
      <aside className="w-64 border-r">
        <nav>
          <a href="/dashboard">Dashboard</a>
          <a href="/dashboard/settings">Settings</a>
        </nav>
      </aside>
      <main className="flex-1">{children}</main>
    </div>
  )
}
```

## With Loading State

When `--withLoading` is used, also generates:

```typescript
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 bg-gray-200 rounded w-1/4"></div>
      <div className="h-4 bg-gray-200 rounded w-1/2"></div>
      <div className="h-64 bg-gray-200 rounded"></div>
    </div>
  )
}
```

## With Error Boundary

When `--withError` is used, also generates:

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
      <button onClick={reset}>Try again</button>
    </div>
  )
}
```

## Usage Examples

### Product Page with All Features

```bash
hypergen nextjs page add \
  --path="products/[id]" \
  --pageDescription="Product detail page" \
  --withLoading \
  --withError
```

Creates:
- `app/products/[id]/page.tsx` - Product page
- `app/products/[id]/loading.tsx` - Loading skeleton
- `app/products/[id]/error.tsx` - Error boundary

### Dashboard Section

```bash
hypergen nextjs page add \
  --path=dashboard \
  --pageDescription="Dashboard home" \
  --withLayout \
  --withLoading
```

Creates:
- `app/dashboard/page.tsx` - Dashboard page
- `app/dashboard/layout.tsx` - Layout with navigation
- `app/dashboard/loading.tsx` - Loading state

### Marketing Page

```bash
hypergen nextjs page add \
  --path="(marketing)/about" \
  --pageDescription="About us page"
```

Creates:
- `app/(marketing)/about/page.tsx` - About page (routes to /about)

## Server vs Client Components

By default, pages are **Server Components**:

```typescript
// Server Component (default)
export default async function Page() {
  const data = await fetch('...')
  return <div>{data.title}</div>
}
```

For client features, add `'use client'`:

```typescript
'use client'

import { useState } from 'react'

export default function Page() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
```

## Metadata

Add metadata to pages:

```typescript
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'About Us',
  description: 'Learn about our company',
}

export default function AboutPage() {
  return <div>About content</div>
}
```

### Dynamic Metadata

```typescript
export async function generateMetadata({
  params
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const post = await fetchPost(params.slug)

  return {
    title: post.title,
    description: post.excerpt,
  }
}

export default async function Page({ params }: { params: { slug: string } }) {
  const post = await fetchPost(params.slug)
  return <article>{post.title}</article>
}
```

## Best Practices

✅ **Use Server Components** - Default for better performance
✅ **Add loading states** - Improve UX with loading.tsx
✅ **Add error boundaries** - Handle errors gracefully
✅ **Use layouts for shared UI** - Navigation, headers, footers
✅ **Follow naming conventions** - Use descriptive paths
✅ **Type your params** - Use TypeScript for dynamic routes
✅ **Add metadata** - For SEO and social sharing

## Related Recipes

- [layout/add](../../layout/add/) - Generate layouts
- [loading/add](../../loading/add/) - Generate loading UI
- [error/add](../../error/add/) - Generate error boundaries
- [component/add](../../component/add/) - Create components for pages
