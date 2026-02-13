# GraphQL Endpoint Generator

Generate a GraphQL API endpoint using GraphQL Yoga for Next.js with schema-first development.

## Features

- **GraphQL Yoga**: Modern, fast GraphQL server
- **Schema-First**: Type-safe schema definitions using SDL
- **GraphQL Playground**: Interactive query interface in development
- **Authentication**: Optional auth context integration
- **ORM Integration**: Works with Prisma and Drizzle
- **Type Safety**: Full TypeScript support

## Usage

### Basic GraphQL Endpoint

```bash
hypergen api graphql
```

Generates:
- `app/api/graphql/route.ts` - GraphQL route handler
- `lib/graphql/schema.ts` - GraphQL schema definition
- `lib/graphql/resolvers.ts` - Query and mutation resolvers
- `lib/graphql/context.ts` - Context creation with dependencies

### With Authentication

```bash
hypergen api graphql --auth
```

Automatically detects your auth provider and adds user context.

### Custom Directory

```bash
hypergen api graphql --dir app/api/v1/graphql
```

## Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `dir` | string | `"app/api/graphql"` | Output directory |
| `playground` | boolean | `true` | Enable GraphQL Playground in dev |
| `auth` | boolean | `false` | Add authentication context |

## Dependencies

This recipe requires GraphQL Yoga:

```bash
npm install graphql graphql-yoga
```

The recipe will automatically check and install these if missing.

## Generated Schema Example

```graphql
type Query {
  hello: String!
  user(id: ID!): User
  users: [User!]!
}

type Mutation {
  createUser(input: CreateUserInput!): User!
  updateUser(id: ID!, input: UpdateUserInput!): User!
  deleteUser(id: ID!): Boolean!
}

type User {
  id: ID!
  name: String!
  email: String!
  createdAt: String!
}

input CreateUserInput {
  name: String!
  email: String!
}

input UpdateUserInput {
  name: String
  email: String
}
```

## Generated Resolvers Example

```typescript
export const resolvers = {
  Query: {
    hello: () => 'Hello from GraphQL!',

    user: async (_parent, args, context) => {
      const { id } = args
      const user = await prisma.user.findUnique({
        where: { id },
      })
      return user
    },

    users: async () => {
      const users = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
      })
      return users
    },
  },

  Mutation: {
    createUser: async (_parent, args, context) => {
      // Check authentication
      if (!context.user) {
        throw new Error('Unauthorized')
      }

      const { input } = args
      const user = await prisma.user.create({
        data: input,
      })
      return user
    },
  },
}
```

## Testing Your GraphQL API

### GraphQL Playground

Visit `http://localhost:3000/api/graphql` in development to access the interactive playground.

### Example Queries

```graphql
# Simple query
query {
  hello
}

# Query with arguments
query GetUser {
  user(id: "123") {
    id
    name
    email
    createdAt
  }
}

# Query all users
query GetAllUsers {
  users {
    id
    name
    email
  }
}

# Mutation
mutation CreateUser {
  createUser(input: { name: "John Doe", email: "john@example.com" }) {
    id
    name
    email
  }
}

# Mutation with variables
mutation CreateUser($input: CreateUserInput!) {
  createUser(input: $input) {
    id
    name
  }
}

# Variables:
# {
#   "input": {
#     "name": "Jane Doe",
#     "email": "jane@example.com"
#   }
# }
```

### Using fetch

```typescript
const response = await fetch('/api/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    query: `
      query GetUser($id: ID!) {
        user(id: $id) {
          id
          name
          email
        }
      }
    `,
    variables: {
      id: '123',
    },
  }),
})

const { data, errors } = await response.json()
```

### Using GraphQL Client Libraries

#### Apollo Client

```bash
npm install @apollo/client graphql
```

```typescript
import { ApolloClient, InMemoryCache, gql } from '@apollo/client'

const client = new ApolloClient({
  uri: '/api/graphql',
  cache: new InMemoryCache(),
})

const { data } = await client.query({
  query: gql`
    query GetUsers {
      users {
        id
        name
        email
      }
    }
  `,
})
```

#### urql

```bash
npm install urql graphql
```

```typescript
import { createClient } from 'urql'

const client = createClient({
  url: '/api/graphql',
})

const result = await client
  .query(
    `
    query GetUsers {
      users {
        id
        name
      }
    }
  `,
    {}
  )
  .toPromise()
```

## Authentication

### With NextAuth

```typescript
// lib/graphql/context.ts
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function createContext(initialContext) {
  const session = await getServerSession(authOptions)

  return {
    user: session?.user
      ? {
          id: session.user.id,
          email: session.user.email,
        }
      : undefined,
  }
}
```

### With Clerk

```typescript
// lib/graphql/context.ts
import { auth } from '@clerk/nextjs/server'

export async function createContext() {
  const { userId } = await auth()

  return {
    user: userId ? { id: userId } : undefined,
  }
}
```

### Protected Resolvers

```typescript
export const resolvers = {
  Mutation: {
    createUser: async (_parent, args, context) => {
      // Require authentication
      if (!context.user) {
        throw new Error('Unauthorized')
      }

      // Resolver logic...
    },
  },
}
```

## Advanced Features

### Custom Scalars

```typescript
import { GraphQLScalarType } from 'graphql'

const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description: 'ISO 8601 date-time string',
  serialize(value) {
    return value instanceof Date ? value.toISOString() : null
  },
  parseValue(value) {
    return new Date(value)
  },
})

export const schema = createSchema({
  typeDefs: /* GraphQL */ `
    scalar DateTime

    type User {
      createdAt: DateTime!
    }
  `,
  resolvers: {
    DateTime: DateTimeScalar,
    // ...other resolvers
  },
})
```

### Field Resolvers

```typescript
export const resolvers = {
  User: {
    // Resolve computed fields
    fullName: (parent) => {
      return `${parent.firstName} ${parent.lastName}`
    },

    // Async field resolver
    posts: async (parent) => {
      return await prisma.post.findMany({
        where: { authorId: parent.id },
      })
    },
  },
}
```

### DataLoader for N+1 Prevention

```bash
npm install dataloader
```

```typescript
import DataLoader from 'dataloader'

export async function createContext() {
  return {
    loaders: {
      user: new DataLoader(async (ids) => {
        const users = await prisma.user.findMany({
          where: { id: { in: [...ids] } },
        })
        return ids.map((id) => users.find((u) => u.id === id))
      }),
    },
  }
}

// In resolver
const user = await context.loaders.user.load(userId)
```

### Error Handling

```typescript
import { GraphQLError } from 'graphql'

export const resolvers = {
  Query: {
    user: async (_parent, args) => {
      const user = await prisma.user.findUnique({
        where: { id: args.id },
      })

      if (!user) {
        throw new GraphQLError('User not found', {
          extensions: {
            code: 'NOT_FOUND',
          },
        })
      }

      return user
    },
  },
}
```

## Next Steps

1. **Define your schema** in `lib/graphql/schema.ts`
2. **Implement resolvers** in `lib/graphql/resolvers.ts`
3. **Add authentication** if needed in `lib/graphql/context.ts`
4. **Test queries** in GraphQL Playground
5. **Add validation** using GraphQL directives
6. **Set up client** (Apollo, urql, etc.)

## Best Practices

### Schema Design

- Use descriptive type and field names
- Define input types for mutations
- Use non-nullable types (`!`) appropriately
- Add descriptions to types and fields
- Version your schema for breaking changes

### Resolver Performance

- Use DataLoader to prevent N+1 queries
- Implement pagination for list queries
- Add query complexity limits
- Cache frequently accessed data

### Security

- Always validate and sanitize inputs
- Implement rate limiting
- Protect sensitive fields
- Use authentication for mutations
- Add query depth limiting

### Error Handling

- Use meaningful error messages
- Include error codes for client handling
- Log errors for monitoring
- Don't expose internal implementation details

## Resources

- [GraphQL Yoga Docs](https://the-guild.dev/graphql/yoga-server/docs)
- [GraphQL Spec](https://spec.graphql.org/)
- [Apollo Client](https://www.apollographql.com/docs/react/)
- [urql](https://formidable.com/open-source/urql/)
- [DataLoader](https://github.com/graphql/dataloader)
