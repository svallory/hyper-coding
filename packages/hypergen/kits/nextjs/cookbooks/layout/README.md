# Layout Cookbook

Generate layouts for Next.js App Router route segments to create shared UI that wraps multiple pages.

## Quick Start

Create a layout for a route segment:

```bash
hypergen nextjs layout add --path=dashboard
```

Create a layout with navigation:

```bash
hypergen nextjs layout add \
  --path=dashboard \
  --layoutDescription="Dashboard with sidebar nav" \
  --withNav
```

## Recipes

### [add](./add/) - Add Layout
Generate `layout.tsx` that wraps child pages in a route segment. Layouts are shared across all pages in the segment and persist during navigation.

**Features:**
- Shared UI components
- Navigation sidebars/headers
- Persistent state
- Nested layouts
- Route group support

## What is a Layout?

In Next.js App Router, `layout.tsx` defines UI shared across multiple pages. Layouts:

- Wrap child pages and nested layouts
- Persist during navigation (don't re-render)
- Can fetch data and pass to children
- Stack hierarchically (root → segment → nested segment)

Examples:
- `app/layout.tsx` → Root layout (wraps entire app)
- `app/dashboard/layout.tsx` → Wraps all `/dashboard/*` pages
- `app/(marketing)/layout.tsx` → Wraps route group pages

## Common Use Cases

### Dashboard Layout
```bash
hypergen nextjs layout add \
  --path=dashboard \
  --layoutDescription="Dashboard layout with sidebar" \
  --withNav
```

### Marketing Layout
```bash
hypergen nextjs layout add \
  --path="(marketing)" \
  --layoutDescription="Marketing pages layout" \
  --withNav
```

### Blog Layout
```bash
hypergen nextjs layout add \
  --path=blog \
  --layoutDescription="Blog layout with header" \
  --withNav
```

### Admin Layout
```bash
hypergen nextjs layout add \
  --path=admin \
  --layoutDescription="Admin panel layout" \
  --withNav
```

### Documentation Layout
```bash
hypergen nextjs layout add \
  --path=docs \
  --layoutDescription="Docs with sidebar navigation"
```

## Layout Hierarchy

Layouts nest from root to leaf:

```
app/
├── layout.tsx                    # Root (wraps everything)
├── page.tsx
└── dashboard/
    ├── layout.tsx                # Dashboard (wraps /dashboard/*)
    ├── page.tsx
    └── settings/
        ├── layout.tsx            # Settings (wraps /dashboard/settings/*)
        └── page.tsx
```

Rendered as:
```
RootLayout
  └─ DashboardLayout
      └─ SettingsLayout
          └─ SettingsPage
```

## Generated Files

- `app/{path}/layout.tsx` - Layout component

Example with navigation:

```typescript
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r bg-gray-50">
        <nav className="p-4">
          <ul className="space-y-2">
            <li>
              <a href="/dashboard">Dashboard</a>
            </li>
            <li>
              <a href="/dashboard/settings">Settings</a>
            </li>
            <li>
              <a href="/dashboard/profile">Profile</a>
            </li>
          </ul>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6">
        {children}
      </main>
    </div>
  )
}
```

## Options

- `--path` (required) - Route segment path relative to app/
- `--layoutDescription` - Purpose of this layout
- `--withNav` - Include navigation UI (default: true)

## Layout Features

### Persistent UI
Layouts don't re-render during navigation within the segment:

```typescript
'use client'

export default function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // State persists during page navigation!
  return (
    <div>
      <Sidebar open={sidebarOpen} />
      {children}
    </div>
  )
}
```

### Data Fetching
Layouts can fetch data (Server Components):

```typescript
export default async function Layout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  return (
    <div>
      <Header user={user} />
      {children}
    </div>
  )
}
```

### Route Groups
Use route groups to organize without affecting URLs:

```typescript
// app/(marketing)/layout.tsx
// Applies to: /about, /pricing, /contact
// NOT in URL: /(marketing) is omitted

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div>
      <MarketingNav />
      {children}
      <Footer />
    </div>
  )
}
```

## Common Patterns

### Sidebar Layout
```typescript
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex">
      <aside className="w-64 border-r">
        <Sidebar />
      </aside>
      <main className="flex-1">{children}</main>
    </div>
  )
}
```

### Header + Footer Layout
```typescript
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b">
        <Navigation />
      </header>
      <main className="min-h-screen">{children}</main>
      <footer className="border-t">
        <Footer />
      </footer>
    </>
  )
}
```

### Centered Content Layout
```typescript
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {children}
    </div>
  )
}
```

### Multi-Column Layout
```typescript
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-12 gap-4">
      <aside className="col-span-3">
        <TableOfContents />
      </aside>
      <main className="col-span-6">{children}</main>
      <aside className="col-span-3">
        <RelatedLinks />
      </aside>
    </div>
  )
}
```

## Best Practices

✅ **Keep layouts focused** - One responsibility per layout
✅ **Use Server Components** - For better performance (default)
✅ **Avoid layout shifts** - Maintain consistent dimensions
✅ **Use route groups** - To apply layouts without URL impact
✅ **Share common UI** - Navigation, headers, footers
✅ **Optimize for persistence** - Layouts don't re-render on navigation
✅ **Handle loading states** - Use loading.tsx for nested segments
✅ **Add metadata** - Use generateMetadata for SEO

## Root Layout

Every app must have a root layout at `app/layout.tsx`:

```typescript
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

**Note**: Root layout must include `<html>` and `<body>` tags.

## Metadata

Add metadata to layouts:

```typescript
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'User dashboard',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>
}
```

## Navigation Links

Use `next/link` for client-side navigation:

```typescript
import Link from 'next/link'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/dashboard/settings">Settings</Link>
      </nav>
      {children}
    </div>
  )
}
```

## Active Link Highlighting

```typescript
'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div>
      <nav>
        <Link
          href="/dashboard"
          className={pathname === '/dashboard' ? 'active' : ''}
        >
          Dashboard
        </Link>
      </nav>
      {children}
    </div>
  )
}
```

## Related Cookbooks

- [page](../page/) - Generate pages that use layouts
- [loading](../loading/) - Add loading states to segments
- [error](../error/) - Add error boundaries to segments
- [component](../component/) - Create navigation components
