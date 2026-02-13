# Component Cookbook

Generate React components for your Next.js application with TypeScript support and optional client/server configuration.

## Quick Start

Create a simple component:

```bash
hypergen nextjs component add --name=UserCard
```

Create a client component with props:

```bash
hypergen nextjs component add \
  --name=UserCard \
  --componentDescription="Displays user profile information" \
  --client \
  --withProps
```

## Recipes

### [add](./add/) - Add Component
Generate a React component with TypeScript. Creates a .tsx file with optional "use client" directive and typed props interface.

**Features:**
- Server Components (default) or Client Components
- TypeScript props interface
- Customizable directory placement
- PascalCase naming validation

## What is a Component?

Components are reusable pieces of UI. In Next.js 15:

- **Server Components** (default) - Rendered on server, no JavaScript to client
- **Client Components** - Interactive, use hooks, event handlers, browser APIs

## Common Use Cases

### UI Components (Client)
```bash
hypergen nextjs component add \
  --name=Button \
  --dir=components/ui \
  --client \
  --withProps
```

### Display Components (Server)
```bash
hypergen nextjs component add \
  --name=UserProfile \
  --componentDescription="User profile display" \
  --withProps
```

### Layout Components (Server)
```bash
hypergen nextjs component add \
  --name=Container \
  --dir=components/layout \
  --componentDescription="Content container wrapper"
```

### Interactive Forms (Client)
```bash
hypergen nextjs component add \
  --name=ContactForm \
  --dir=components/forms \
  --client
```

### Card Components
```bash
hypergen nextjs component add \
  --name=ProductCard \
  --dir=components/cards \
  --componentDescription="Product display card" \
  --withProps
```

## Generated Files

- `{dir}/{name}.tsx` - Component file

### Server Component (Default)
```typescript
interface UserCardProps {
  // Add your props here
}

export function UserCard({}: UserCardProps) {
  return (
    <div>
      {/* Component content */}
    </div>
  )
}
```

### Client Component (with --client)
```typescript
'use client'

import { useState } from 'react'

interface UserCardProps {
  // Add your props here
}

export function UserCard({}: UserCardProps) {
  return (
    <div>
      {/* Component content */}
    </div>
  )
}
```

### Without Props (--withProps=false)
```typescript
export function UserCard() {
  return (
    <div>
      {/* Component content */}
    </div>
  )
}
```

## Options

- `--name` (required) - Component name in PascalCase
- `--componentDescription` (required) - What the component does
- `--dir` - Directory for component (default: "components")
- `--client` - Add "use client" directive (default: false)
- `--withProps` - Include props interface (default: true)

## Server vs Client Components

### Use Server Components When:
- Fetching data from database
- Accessing backend resources
- Keeping sensitive info on server (API keys)
- No interactivity needed
- Large dependencies (keep on server)

```typescript
// Server Component - no 'use client'
export async function UserProfile({ userId }: { userId: string }) {
  const user = await db.user.findUnique({ where: { id: userId } })

  return <div>{user.name}</div>
}
```

### Use Client Components When:
- Using React hooks (useState, useEffect, etc.)
- Adding event listeners (onClick, onChange, etc.)
- Using browser APIs (localStorage, window, etc.)
- Using context providers/consumers
- Adding interactivity

```typescript
'use client'

import { useState } from 'react'

export function Counter() {
  const [count, setCount] = useState(0)

  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
```

## Component Organization

Common directory structures:

```
components/
├── ui/              # Reusable UI primitives (Button, Input, etc.)
├── forms/           # Form components
├── cards/           # Card components
├── layout/          # Layout components (Header, Footer, etc.)
├── icons/           # Icon components
└── providers/       # Context providers

app/
└── _components/     # Route-specific components (private)
```

## Props Interface

Always type your props:

```typescript
interface UserCardProps {
  name: string
  email: string
  avatar?: string
  onEdit?: () => void
}

export function UserCard({ name, email, avatar, onEdit }: UserCardProps) {
  return (
    <div>
      {avatar && <img src={avatar} alt={name} />}
      <h3>{name}</h3>
      <p>{email}</p>
      {onEdit && <button onClick={onEdit}>Edit</button>}
    </div>
  )
}
```

## Children Prop

For wrapper components:

```typescript
interface ContainerProps {
  children: React.ReactNode
  className?: string
}

export function Container({ children, className }: ContainerProps) {
  return (
    <div className={`max-w-7xl mx-auto px-4 ${className}`}>
      {children}
    </div>
  )
}
```

## Composition Patterns

### Compound Components
```typescript
export function Card({ children }: { children: React.ReactNode }) {
  return <div className="card">{children}</div>
}

Card.Header = function CardHeader({ children }: { children: React.ReactNode }) {
  return <div className="card-header">{children}</div>
}

Card.Body = function CardBody({ children }: { children: React.ReactNode }) {
  return <div className="card-body">{children}</div>
}

// Usage:
// <Card>
//   <Card.Header>Title</Card.Header>
//   <Card.Body>Content</Card.Body>
// </Card>
```

### Render Props
```typescript
interface DataFetcherProps<T> {
  url: string
  children: (data: T | null, loading: boolean) => React.ReactNode
}

export function DataFetcher<T>({ url, children }: DataFetcherProps<T>) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(url).then(/* ... */)
  }, [url])

  return <>{children(data, loading)}</>
}
```

## Best Practices

✅ **Use PascalCase** - Component names should be PascalCase
✅ **One component per file** - Unless using compound components
✅ **Prefer Server Components** - Use client only when needed
✅ **Type your props** - Always use TypeScript interfaces
✅ **Extract reusable logic** - Use custom hooks for Client Components
✅ **Keep components focused** - Single responsibility
✅ **Use meaningful names** - UserCard not UC
✅ **Add JSDoc comments** - Document complex components

## Styling

### Tailwind CSS (Recommended)
```typescript
export function Button({ children }: { children: React.ReactNode }) {
  return (
    <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
      {children}
    </button>
  )
}
```

### CSS Modules
```typescript
import styles from './Button.module.css'

export function Button({ children }: { children: React.ReactNode }) {
  return <button className={styles.button}>{children}</button>
}
```

### Conditional Classes
```typescript
interface ButtonProps {
  variant?: 'primary' | 'secondary'
  children: React.ReactNode
}

export function Button({ variant = 'primary', children }: ButtonProps) {
  const baseClasses = 'px-4 py-2 rounded'
  const variantClasses = {
    primary: 'bg-blue-500 text-white',
    secondary: 'bg-gray-200 text-gray-800',
  }

  return (
    <button className={`${baseClasses} ${variantClasses[variant]}`}>
      {children}
    </button>
  )
}
```

## Testing

```typescript
import { render, screen } from '@testing-library/react'
import { UserCard } from './UserCard'

test('renders user name', () => {
  render(<UserCard name="John Doe" email="john@example.com" />)
  expect(screen.getByText('John Doe')).toBeInTheDocument()
})
```

## Related Cookbooks

- [page](../page/) - Generate pages that use components
- [layout](../layout/) - Generate layouts (special components)
- [form](../form/) - Generate form components
- [table](../table/) - Generate table components
