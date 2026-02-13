# Loading Cookbook

Generate loading UI states for Next.js App Router route segments using React Suspense boundaries.

## Quick Start

Add loading UI to a route:

```bash
hypergen nextjs loading add --path=dashboard
```

With a specific style:

```bash
hypergen nextjs loading add --path=blog/[slug] --style=spinner
```

## Recipes

### [add](./add/) - Add Loading UI
Generate `loading.tsx` that displays while the page or segment is loading. Uses React Suspense to show fallback UI during async operations.

**Features:**
- Skeleton screen layouts
- Spinner animations
- Pulse loading effects
- Automatic integration with Suspense
- Route segment isolation

## What is Loading UI?

In Next.js App Router, `loading.tsx` creates an instant loading state using React Suspense. It wraps page content and shows while:

- Page components are rendering (Server Components fetching data)
- Route transitions are happening
- Data is being loaded

Loading UI is shown instantly, providing better UX than blank screens or spinners in components.

## Common Use Cases

### Dashboard Pages
```bash
hypergen nextjs loading add \
  --path=dashboard \
  --style=skeleton
```

### Blog Posts
```bash
hypergen nextjs loading add \
  --path=blog/[slug] \
  --style=pulse
```

### Data Tables
```bash
hypergen nextjs loading add \
  --path=admin/users \
  --style=skeleton
```

### Product Pages
```bash
hypergen nextjs loading add \
  --path=products/[id] \
  --style=spinner
```

## Loading Styles

### Skeleton
Best for: Pages with known layout structure

Displays placeholder boxes that match your page layout:
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

### Spinner
Best for: Simple pages or unknown content structure

Displays a centered loading spinner:
```typescript
export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
    </div>
  )
}
```

### Pulse
Best for: Content-heavy pages

Displays pulsing content placeholders:
```typescript
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-8 bg-gray-200 rounded animate-pulse"></div>
      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
    </div>
  )
}
```

## How It Works

Next.js automatically wraps your page in a Suspense boundary with loading.tsx as the fallback:

```typescript
// Automatically created by Next.js
<Suspense fallback={<Loading />}>
  <Page />
</Suspense>
```

## Generated Files

- `app/{path}/loading.tsx` - Loading UI component

Example skeleton output:

```typescript
export default function Loading() {
  return (
    <div className="space-y-6 p-6">
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="space-y-3">
          <div className="h-4 bg-gray-200 rounded w-full"></div>
          <div className="h-4 bg-gray-200 rounded w-5/6"></div>
          <div className="h-4 bg-gray-200 rounded w-4/6"></div>
        </div>
      </div>
    </div>
  )
}
```

## Options

- `--path` (required) - Route segment path relative to app/
- `--style` - Loading UI style (skeleton, spinner, pulse)

## Placement

Loading UI applies to route segments:

```
app/
├── loading.tsx              # Shows for all pages
├── dashboard/
│   ├── loading.tsx          # Shows only for /dashboard/*
│   ├── page.tsx
│   └── settings/
│       ├── loading.tsx      # Shows only for /dashboard/settings
│       └── page.tsx
```

## Best Practices

✅ **Match page layout** - Use skeleton screens that match actual content
✅ **Keep it simple** - Loading states should be lightweight
✅ **Use appropriate style** - Skeleton for structured, spinner for simple
✅ **Add to data-heavy routes** - Pages with async data fetching
✅ **Consider nested segments** - Each segment can have its own loading state
✅ **Use Tailwind animations** - Built-in pulse and spin animations
✅ **Test loading states** - Simulate slow networks

## Advanced Usage

### Custom Skeleton Matching Layout
```typescript
export default function Loading() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header skeleton */}
      <div className="h-10 bg-gray-200 rounded w-1/3 mb-6 animate-pulse"></div>

      {/* Content skeleton matching your actual layout */}
      <div className="grid grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-40 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-4 bg-gray-200 rounded w-3/4 animate-pulse"></div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

### Streaming with Suspense
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

## Customization

After generating, customize the loading UI to match your design:

```typescript
export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      {/* Your brand's loading animation */}
      <YourLogo className="animate-pulse" />
      <p className="mt-4 text-gray-600">Loading amazing content...</p>
    </div>
  )
}
```

## Troubleshooting

### Loading state not showing
- Ensure file is named exactly `loading.tsx`
- Check that it's in the correct route segment
- Verify your page actually has async operations

### Loading flashes briefly
- Expected behavior for fast responses
- Consider adding minimum display time in production
- Use streaming Suspense for granular loading

### Doesn't match page layout
- Customize skeleton to match your actual page structure
- Measure actual content dimensions
- Use CSS Grid/Flexbox matching your layout

## Related Cookbooks

- [page](../page/) - Generate pages that use loading states
- [error](../error/) - Generate error boundaries
- [layout](../layout/) - Generate layouts
- [component](../component/) - Create loading components
