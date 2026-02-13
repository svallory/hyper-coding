# Add Loading UI Recipe

Generate loading states for Next.js App Router route segments using React Suspense.

## Usage

```bash
# Skeleton loading
hypergen nextjs loading add --path=dashboard

# Spinner loading
hypergen nextjs loading add \
  --path=blog/[slug] \
  --style=spinner

# Pulse animation
hypergen nextjs loading add \
  --path=admin/users \
  --style=pulse
```

## Generated Files

- `app/{path}/loading.tsx`

## Variables

| Variable | Type | Description | Required | Default |
|----------|------|-------------|----------|---------|
| `path` | string | Route segment path relative to app/ | Yes | - |
| `style` | enum | Loading UI style | No | `skeleton` |

### Style Options

- **`skeleton`** - Placeholder boxes matching page layout
- **`spinner`** - Centered loading spinner
- **`pulse`** - Pulsing content placeholders

## Generated Output

### Skeleton Style

```typescript
export default function Loading() {
  return (
    <div className="space-y-6 p-6">
      <div className="animate-pulse">
        {/* Header skeleton */}
        <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>

        {/* Content skeleton */}
        <div className="space-y-3">
          <div className="h-4 bg-gray-200 rounded w-full"></div>
          <div className="h-4 bg-gray-200 rounded w-5/6"></div>
          <div className="h-4 bg-gray-200 rounded w-4/6"></div>
        </div>

        {/* Card skeletons */}
        <div className="grid grid-cols-3 gap-4 mt-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-40 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

### Spinner Style

```typescript
export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
    </div>
  )
}
```

### Pulse Style

```typescript
export default function Loading() {
  return (
    <div className="space-y-4 p-6">
      <div className="h-8 bg-gray-200 rounded animate-pulse"></div>
      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
      <div className="h-4 bg-gray-200 rounded animate-pulse w-5/6"></div>
      <div className="h-64 bg-gray-200 rounded animate-pulse mt-6"></div>
    </div>
  )
}
```

## How It Works

Next.js automatically wraps your page with a Suspense boundary:

```typescript
// Automatically created by Next.js
<Suspense fallback={<Loading />}>
  <Page />
</Suspense>
```

The loading UI shows while:
- Server Component is fetching data
- Page is rendering
- Route transition is happening

## Usage Examples

### Dashboard with Skeleton

```bash
hypergen nextjs loading add \
  --path=dashboard \
  --style=skeleton
```

Customize to match dashboard layout:

```typescript
export default function Loading() {
  return (
    <div className="p-6">
      {/* Stats cards skeleton */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 bg-gray-200 rounded animate-pulse"></div>
        ))}
      </div>

      {/* Chart skeleton */}
      <div className="h-64 bg-gray-200 rounded animate-pulse mb-6"></div>

      {/* Table skeleton */}
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-12 bg-gray-200 rounded animate-pulse"></div>
        ))}
      </div>
    </div>
  )
}
```

### Blog Post with Spinner

```bash
hypergen nextjs loading add \
  --path="blog/[slug]" \
  --style=spinner
```

### Data Table with Pulse

```bash
hypergen nextjs loading add \
  --path=admin/users \
  --style=pulse
```

## Customization

### Match Your Page Layout

Create skeleton that matches actual content:

```typescript
export default function Loading() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Title */}
      <div className="h-10 bg-gray-200 rounded w-1/3 mb-6 animate-pulse"></div>

      {/* Image */}
      <div className="aspect-video bg-gray-200 rounded mb-6 animate-pulse"></div>

      {/* Content */}
      <div className="space-y-3">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="h-4 bg-gray-200 rounded animate-pulse"
            style={{ width: `${Math.random() * 20 + 80}%` }}
          ></div>
        ))}
      </div>
    </div>
  )
}
```

### Add Your Brand

```typescript
export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <YourLogo className="w-16 h-16 animate-pulse mb-4" />
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      <p className="mt-4 text-gray-600">Loading...</p>
    </div>
  )
}
```

### Tailwind Custom Animation

```typescript
// Add to globals.css:
// @keyframes shimmer {
//   0% { background-position: -1000px 0; }
//   100% { background-position: 1000px 0; }
// }
//
// .animate-shimmer {
//   animation: shimmer 2s infinite;
//   background: linear-gradient(to right, #f0f0f0 4%, #e0e0e0 25%, #f0f0f0 36%);
//   background-size: 1000px 100%;
// }

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-8 rounded animate-shimmer"></div>
      <div className="h-4 rounded animate-shimmer"></div>
    </div>
  )
}
```

## Placement

Loading UI applies to the route segment:

```
app/
├── loading.tsx              # Shows for all pages
├── dashboard/
│   ├── loading.tsx          # Shows for /dashboard/*
│   ├── page.tsx
│   └── settings/
│       ├── loading.tsx      # Shows for /dashboard/settings
│       └── page.tsx
```

## Streaming with Suspense

For granular loading, use Suspense in your page:

```typescript
// app/page.tsx
import { Suspense } from 'react'

export default function Page() {
  return (
    <div>
      <h1>My Page</h1>

      <Suspense fallback={<div>Loading posts...</div>}>
        <Posts />
      </Suspense>

      <Suspense fallback={<div>Loading comments...</div>}>
        <Comments />
      </Suspense>
    </div>
  )
}
```

## Best Practices

✅ **Match page layout** - Skeleton should look like actual content
✅ **Keep it lightweight** - Loading states should render fast
✅ **Use appropriate style** - Skeleton for structured, spinner for simple
✅ **Test loading states** - Use slow network throttling
✅ **Consider accessibility** - Add aria-label or sr-only text
✅ **Use Tailwind animations** - Built-in pulse and spin
✅ **Nest loading states** - Each segment can have its own

## Related Recipes

- [page/add](../../page/add/) - Generate pages with loading states
- [error/add](../../error/add/) - Generate error boundaries
- [layout/add](../../layout/add/) - Generate layouts
