# Add Component Recipe

Generate React components for your Next.js application with TypeScript support and optional client/server configuration.

## Usage

```bash
# Simple component
hypergen nextjs component add --name=UserCard

# Client component with props
hypergen nextjs component add \
  --name=UserCard \
  --componentDescription="Displays user profile card" \
  --client \
  --withProps

# UI component
hypergen nextjs component add \
  --name=Button \
  --dir=components/ui \
  --componentDescription="Reusable button component" \
  --client
```

## Generated Files

- `{dir}/{name}.tsx`

## Variables

| Variable | Type | Description | Required | Default |
|----------|------|-------------|----------|---------|
| `name` | string | Component name (PascalCase) | Yes | - |
| `componentDescription` | string | What the component does | Yes | - |
| `dir` | string | Directory relative to root | No | `"components"` |
| `client` | boolean | Add "use client" directive | No | `false` |
| `withProps` | boolean | Include props interface | No | `true` |

### Naming Requirements

Component name must be in PascalCase (e.g., `UserCard`, `NavigationMenu`, `ProductList`).

## Generated Output

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

## Usage Examples

### Display Component (Server)

```bash
hypergen nextjs component add \
  --name=UserProfile \
  --componentDescription="User profile display card" \
  --withProps
```

Add props and logic:

```typescript
interface UserProfileProps {
  user: {
    name: string
    email: string
    avatar?: string
  }
}

export function UserProfile({ user }: UserProfileProps) {
  return (
    <div className="border rounded-lg p-4">
      {user.avatar && (
        <img
          src={user.avatar}
          alt={user.name}
          className="w-16 h-16 rounded-full"
        />
      )}
      <h3 className="text-xl font-bold">{user.name}</h3>
      <p className="text-gray-600">{user.email}</p>
    </div>
  )
}
```

### Interactive Component (Client)

```bash
hypergen nextjs component add \
  --name=Counter \
  --dir=components/interactive \
  --componentDescription="Counter with increment/decrement" \
  --client
```

Add state and handlers:

```typescript
'use client'

import { useState } from 'react'

interface CounterProps {
  initialValue?: number
}

export function Counter({ initialValue = 0 }: CounterProps) {
  const [count, setCount] = useState(initialValue)

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={() => setCount(count - 1)}
        className="px-4 py-2 bg-gray-200 rounded"
      >
        -
      </button>
      <span className="text-2xl font-bold">{count}</span>
      <button
        onClick={() => setCount(count + 1)}
        className="px-4 py-2 bg-blue-500 text-white rounded"
      >
        +
      </button>
    </div>
  )
}
```

### UI Component Library

```bash
hypergen nextjs component add \
  --name=Button \
  --dir=components/ui \
  --componentDescription="Reusable button component" \
  --client \
  --withProps
```

Create flexible button:

```typescript
'use client'

interface ButtonProps {
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  onClick?: () => void
  disabled?: boolean
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  onClick,
  disabled = false,
}: ButtonProps) {
  const baseClasses = 'rounded font-medium transition-colors'

  const variantClasses = {
    primary: 'bg-blue-500 text-white hover:bg-blue-600',
    secondary: 'bg-gray-200 text-gray-800 hover:bg-gray-300',
    danger: 'bg-red-500 text-white hover:bg-red-600',
  }

  const sizeClasses = {
    sm: 'px-3 py-1 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg',
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      }`}
    >
      {children}
    </button>
  )
}
```

### Form Component

```bash
hypergen nextjs component add \
  --name=ContactForm \
  --dir=components/forms \
  --componentDescription="Contact form with validation" \
  --client
```

## Server vs Client Components

### Use Server Components (default) When:

- No interactivity needed
- Fetching data from database
- Accessing backend resources
- Keeping sensitive info on server

```typescript
// Server Component
async function UserList() {
  const users = await db.user.findMany()

  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  )
}
```

### Use Client Components (--client) When:

- Using React hooks (useState, useEffect, etc.)
- Adding event handlers (onClick, onChange, etc.)
- Using browser APIs (localStorage, window, etc.)
- Using context

```typescript
'use client'

import { useState } from 'react'

export function SearchBox() {
  const [query, setQuery] = useState('')

  return (
    <input
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Search..."
    />
  )
}
```

## Props Patterns

### Required and Optional Props

```typescript
interface CardProps {
  title: string // Required
  description?: string // Optional
  children: React.ReactNode
}

export function Card({ title, description, children }: CardProps) {
  return (
    <div>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
    </div>
  )
}
```

### Event Handler Props

```typescript
interface ButtonProps {
  onClick?: () => void
  onHover?: () => void
  children: React.ReactNode
}

export function Button({ onClick, onHover, children }: ButtonProps) {
  return (
    <button onClick={onClick} onMouseEnter={onHover}>
      {children}
    </button>
  )
}
```

### Children Prop

```typescript
interface ContainerProps {
  children: React.ReactNode
  className?: string
}

export function Container({ children, className = '' }: ContainerProps) {
  return (
    <div className={`max-w-7xl mx-auto px-4 ${className}`}>
      {children}
    </div>
  )
}
```

## Best Practices

✅ **Use PascalCase** - Component names must be PascalCase
✅ **Prefer Server Components** - Use client only when needed
✅ **Type your props** - Always use TypeScript interfaces
✅ **One component per file** - Unless using compound components
✅ **Extract reusable logic** - Use custom hooks for Client Components
✅ **Keep components focused** - Single responsibility principle
✅ **Use meaningful names** - UserCard not UC
✅ **Add JSDoc comments** - Document complex components

## Styling with Tailwind

```typescript
interface CardProps {
  children: React.ReactNode
  variant?: 'default' | 'bordered' | 'elevated'
}

export function Card({ children, variant = 'default' }: CardProps) {
  const variants = {
    default: 'bg-white p-4',
    bordered: 'bg-white p-4 border border-gray-200',
    elevated: 'bg-white p-4 shadow-lg',
  }

  return <div className={`rounded-lg ${variants[variant]}`}>{children}</div>
}
```

## Compound Components

```typescript
export function Card({ children }: { children: React.ReactNode }) {
  return <div className="card">{children}</div>
}

Card.Header = function CardHeader({
  children,
}: {
  children: React.ReactNode
}) {
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

## Related Recipes

- [page/add](../../page/add/) - Generate pages that use components
- [layout/add](../../layout/add/) - Generate layouts (special components)
- [form](../../form/) - Generate form components
