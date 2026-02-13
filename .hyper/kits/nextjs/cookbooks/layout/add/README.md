# Add Layout Recipe

Generate layouts for Next.js App Router route segments to create shared UI that wraps multiple pages.

## Usage

```bash
# Simple layout
hypergen nextjs layout add --path=dashboard

# Layout with navigation
hypergen nextjs layout add \
  --path=dashboard \
  --layoutDescription="Dashboard layout with sidebar" \
  --withNav

# Marketing layout
hypergen nextjs layout add \
  --path="(marketing)" \
  --layoutDescription="Marketing pages layout" \
  --withNav
```

## Generated Files

- `app/{path}/layout.tsx`

## Variables

| Variable | Type | Description | Required | Default |
|----------|------|-------------|----------|---------|
| `path` | string | Route segment path relative to app/ | Yes | - |
| `layoutDescription` | string | Purpose of the layout | No | "Layout for this route segment" |
| `withNav` | boolean | Include navigation UI | No | `true` |

## Generated Output

### Layout with Navigation

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
              <a
                href="/dashboard"
                className="block px-4 py-2 rounded hover:bg-gray-100"
              >
                Dashboard
              </a>
            </li>
            <li>
              <a
                href="/dashboard/settings"
                className="block px-4 py-2 rounded hover:bg-gray-100"
              >
                Settings
              </a>
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

### Layout without Navigation

```typescript
export default function Layout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div>
      {children}
    </div>
  )
}
```

## Layout Hierarchy

Layouts nest from root to leaf:

```
app/
├── layout.tsx                    # Root layout
├── page.tsx
└── dashboard/
    ├── layout.tsx                # Dashboard layout
    ├── page.tsx
    └── settings/
        ├── layout.tsx            # Settings layout
        └── page.tsx
```

Rendered as:
```
RootLayout
  └─ DashboardLayout
      └─ SettingsLayout
          └─ SettingsPage
```

## Usage Examples

### Dashboard with Sidebar

```bash
hypergen nextjs layout add \
  --path=dashboard \
  --layoutDescription="Dashboard with navigation sidebar" \
  --withNav
```

Customize the navigation:

```typescript
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r bg-gray-50">
        <div className="p-4">
          <h2 className="text-xl font-bold mb-4">Dashboard</h2>
          <nav>
            <ul className="space-y-2">
              <li>
                <a href="/dashboard">Overview</a>
              </li>
              <li>
                <a href="/dashboard/analytics">Analytics</a>
              </li>
              <li>
                <a href="/dashboard/settings">Settings</a>
              </li>
            </ul>
          </nav>
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
```

### Marketing Pages Layout

```bash
hypergen nextjs layout add \
  --path="(marketing)" \
  --layoutDescription="Marketing layout with header and footer"
```

Add header and footer:

```typescript
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <header className="border-b">
        <nav className="max-w-7xl mx-auto px-4 py-4">
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/pricing">Pricing</a>
          <a href="/contact">Contact</a>
        </nav>
      </header>

      <main className="min-h-screen">{children}</main>

      <footer className="border-t bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <p>&copy; 2024 Your Company</p>
        </div>
      </footer>
    </>
  )
}
```

### Documentation Layout

```bash
hypergen nextjs layout add \
  --path=docs \
  --layoutDescription="Documentation with sidebar"
```

Three-column layout:

```typescript
export default function DocsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-12 gap-4 max-w-7xl mx-auto p-6">
      {/* Left sidebar - Table of contents */}
      <aside className="col-span-3">
        <nav>
          <h3>Getting Started</h3>
          <ul>
            <li><a href="/docs/installation">Installation</a></li>
            <li><a href="/docs/quickstart">Quick Start</a></li>
          </ul>
        </nav>
      </aside>

      {/* Main content */}
      <main className="col-span-6">{children}</main>

      {/* Right sidebar - On this page */}
      <aside className="col-span-3">
        <h3>On This Page</h3>
        <ul>
          <li><a href="#section-1">Section 1</a></li>
          <li><a href="#section-2">Section 2</a></li>
        </ul>
      </aside>
    </div>
  )
}
```

## Customization

### Add Data Fetching

Layouts can fetch data (Server Components):

```typescript
async function getUser() {
  // Fetch user data
  const user = await fetchCurrentUser()
  return user
}

export default async function Layout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getUser()

  return (
    <div>
      <header>
        <p>Welcome, {user.name}</p>
      </header>
      {children}
    </div>
  )
}
```

### Client Component Layout

For interactive features:

```typescript
'use client'

import { useState } from 'react'

export default function Layout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true)

  return (
    <div className="flex">
      {sidebarOpen && (
        <aside className="w-64">
          <nav>Navigation</nav>
        </aside>
      )}
      <main className="flex-1">
        <button onClick={() => setSidebarOpen(!sidebarOpen)}>
          Toggle Sidebar
        </button>
        {children}
      </main>
    </div>
  )
}
```

### Active Link Highlighting

```typescript
'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'

export default function Layout({
  children,
}: {
  children: React.ReactNode
}) {
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
        <Link
          href="/dashboard/settings"
          className={pathname === '/dashboard/settings' ? 'active' : ''}
        >
          Settings
        </Link>
      </nav>
      {children}
    </div>
  )
}
```

## Metadata

Add metadata to layouts:

```typescript
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: {
    template: '%s | Dashboard',
    default: 'Dashboard',
  },
  description: 'Dashboard for managing your account',
}

export default function Layout({
  children,
}: {
  children: React.ReactNode
}) {
  return <div>{children}</div>
}
```

## Best Practices

✅ **Keep layouts focused** - One responsibility per layout
✅ **Use Server Components** - Default for better performance
✅ **Persist UI state** - Layouts don't re-render during navigation
✅ **Use route groups** - Apply layouts without URL impact
✅ **Share common UI** - Navigation, headers, footers
✅ **Optimize for reusability** - Extract navigation to components
✅ **Add loading states** - Use loading.tsx for nested segments
✅ **Handle errors** - Use error.tsx for error boundaries

## Related Recipes

- [page/add](../../page/add/) - Generate pages that use layouts
- [loading/add](../../loading/add/) - Add loading states
- [error/add](../../error/add/) - Add error boundaries
- [component/add](../../component/add/) - Create navigation components
