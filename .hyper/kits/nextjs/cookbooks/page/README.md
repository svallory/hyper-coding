# Page Cookbook

Generate pages for your Next.js App Router application with optional layouts, loading states, and error boundaries.

## Quick Start

Create a simple page:

```bash
hypergen nextjs page add --path=about
```

Create a page with all features:

```bash
hypergen nextjs page add \
  --path=dashboard/settings \
  --withLayout \
  --withLoading \
  --withError
```

## Recipes

### [add](./add/) - Add Page
Generate a new page in your Next.js App Router project. Creates `page.tsx` in the specified route segment with optional layout, loading, and error files.

**Features:**
- Dynamic route segments (`[id]`, `[slug]`)
- Catch-all routes (`[...slug]`)
- Optional catch-all (`[[...slug]]`)
- Route groups `(group)`
- Parallel routes `@folder`
- Automatic layout generation
- Loading UI generation
- Error boundary generation

## What is a Page?

In Next.js App Router, `page.tsx` files define the UI for a route segment. They're automatically routed based on their folder structure.

Examples:
- `app/page.tsx` → `/` (home page)
- `app/about/page.tsx` → `/about`
- `app/blog/[slug]/page.tsx` → `/blog/hello-world`
- `app/dashboard/(admin)/users/page.tsx` → `/dashboard/users` (route group)

## Common Use Cases

### Simple Static Page
```bash
hypergen nextjs page add \
  --path=about \
  --pageDescription="About us page"
```

### Blog Post Page
```bash
hypergen nextjs page add \
  --path="blog/[slug]" \
  --pageDescription="Individual blog post" \
  --withLoading
```

### Dashboard with Layout
```bash
hypergen nextjs page add \
  --path=dashboard \
  --pageDescription="Dashboard home" \
  --withLayout \
  --withLoading \
  --withError
```

### Settings Page
```bash
hypergen nextjs page add \
  --path="dashboard/settings" \
  --pageDescription="User settings" \
  --withError
```

### Product Detail Page
```bash
hypergen nextjs page add \
  --path="products/[id]" \
  --pageDescription="Product detail page" \
  --withLoading \
  --withError
```

## Route Types

### Static Routes
```bash
hypergen nextjs page add --path=contact
# Creates: app/contact/page.tsx
# Routes to: /contact
```

### Dynamic Segments
```bash
hypergen nextjs page add --path="posts/[id]"
# Creates: app/posts/[id]/page.tsx
# Routes to: /posts/1, /posts/2, /posts/abc
```

### Nested Routes
```bash
hypergen nextjs page add --path="blog/posts/[slug]"
# Creates: app/blog/posts/[slug]/page.tsx
# Routes to: /blog/posts/hello-world
```

### Catch-All Routes
```bash
hypergen nextjs page add --path="docs/[...slug]"
# Creates: app/docs/[...slug]/page.tsx
# Routes to: /docs/a, /docs/a/b, /docs/a/b/c
```

### Optional Catch-All
```bash
hypergen nextjs page add --path="shop/[[...categories]]"
# Creates: app/shop/[[...categories]]/page.tsx
# Routes to: /shop, /shop/electronics, /shop/electronics/phones
```

### Route Groups
```bash
hypergen nextjs page add --path="(marketing)/pricing"
# Creates: app/(marketing)/pricing/page.tsx
# Routes to: /pricing (group name omitted from URL)
```

## Generated Files

### Basic Page
```typescript
export default function AboutPage() {
  return (
    <div>
      <h1>About</h1>
    </div>
  )
}
```

### Page with Layout
When `--withLayout` is used, also generates `layout.tsx`:

```typescript
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav>{/* Navigation */}</nav>
      {children}
    </div>
  )
}
```

### Page with Loading UI
When `--withLoading` is used, also generates `loading.tsx`:

```typescript
export default function Loading() {
  return <div>Loading...</div>
}
```

### Page with Error Boundary
When `--withError` is used, also generates `error.tsx`:

```typescript
'use client'

export default function Error({ error, reset }: {
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

## Options

- `--path` (required) - Route path relative to app/ directory
- `--pageDescription` (required) - Brief description of the page
- `--withLayout` - Also generate a layout.tsx
- `--withLoading` - Also generate a loading.tsx
- `--withError` - Also generate an error.tsx

## Best Practices

✅ **Use descriptive paths** - `dashboard/settings` not `dash/set`
✅ **Add loading states** - Improve UX with loading.tsx
✅ **Add error boundaries** - Gracefully handle errors with error.tsx
✅ **Use layouts for shared UI** - Navigation, headers, footers
✅ **Keep pages focused** - One responsibility per page
✅ **Use dynamic segments** - For ID-based routes
✅ **Use route groups** - To organize without affecting URLs
✅ **Follow Next.js conventions** - Use proper file names (page.tsx, layout.tsx)

## Server vs Client Components

By default, pages are Server Components:
- Fetch data on the server
- No JavaScript sent to client
- Better performance and SEO

For client features (hooks, event handlers), add `'use client'`:

```typescript
'use client'

import { useState } from 'react'

export default function Page() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
```

## Data Fetching

### Server Component (Recommended)
```typescript
export default async function Page() {
  const data = await fetch('https://api.example.com/data')
  const json = await data.json()

  return <div>{json.title}</div>
}
```

### With Dynamic Segments
```typescript
export default async function Page({ params }: { params: { id: string } }) {
  const post = await fetchPost(params.id)

  return <article>{post.title}</article>
}
```

## Related Cookbooks

- [layout](../layout/) - Generate layouts for route segments
- [loading](../loading/) - Generate loading UI
- [error](../error/) - Generate error boundaries
- [component](../component/) - Generate reusable components for pages
- [route](../route/) - Generate API route handlers
