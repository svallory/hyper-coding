# Drizzle Init Recipe

Initialize Drizzle ORM in your Next.js project with best practices.

## Usage

```bash
hypergen nextjs database drizzle-init
```

Or with options:

```bash
hypergen nextjs database drizzle-init --database postgresql --databaseUrl "postgresql://user:pass@localhost:5432/mydb"
```

## What It Does

1. **Installs Dependencies**
   - `drizzle-orm` - Drizzle ORM core
   - `drizzle-kit` - Migration and schema management tools
   - Database driver (`postgres`, `mysql2`, or `better-sqlite3`)

2. **Creates Configuration**
   - `drizzle.config.ts` - Drizzle Kit configuration
   - `.env` file with `DATABASE_URL`

3. **Sets Up Database Client** (`db/index.ts`)
   - Singleton pattern for Next.js
   - Proper connection pooling
   - Schema exports

4. **Creates Example Schema** (`db/schema/index.ts`)
   - User and Post tables with relations
   - TypeScript type inference
   - Best practices for each database

5. **Adds NPM Scripts**
   - `db:generate` - Generate migrations
   - `db:migrate` - Apply migrations
   - `db:push` - Push schema changes (dev only)
   - `db:studio` - Launch Drizzle Studio GUI

## Generated Files

- `drizzle.config.ts` - Drizzle Kit configuration
- `db/index.ts` - Database client singleton
- `db/schema/index.ts` - Schema definitions
- `.env` - Environment variables (DATABASE_URL)

## Options

- **`--database`** (default: `postgresql`)
  - Choices: `postgresql`, `mysql`, `sqlite`
  - The database provider you want to use

- **`--databaseUrl`** (optional)
  - Full database connection string
  - If not provided, a template URL is added to `.env`

## Next Steps

After running this recipe:

1. **Update `.env`** with your actual database credentials

2. **Edit `db/schema/index.ts`** to define your data models

3. **Generate migrations**:
   ```bash
   bun run db:generate
   ```

4. **Apply migrations**:
   ```bash
   bun run db:migrate
   ```

5. **Use in your code**:
   ```typescript
   import { db } from '@/db'

   const users = await db.query.users.findMany()
   ```

## Database-Specific Setup

### PostgreSQL
```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
```

Install CUID2 for IDs:
```bash
bun add @paralleldrive/cuid2
```

### MySQL
```env
DATABASE_URL="mysql://USER:PASSWORD@HOST:PORT/DATABASE"
```

Install CUID2 for IDs:
```bash
bun add @paralleldrive/cuid2
```

### SQLite (for local development)
```env
DATABASE_URL="file:./local.db"
```

Uses auto-increment integers for IDs by default.

## Drizzle Commands

### Development Workflow

```bash
# Generate migrations from schema changes
bun run db:generate

# Apply migrations to database
bun run db:migrate

# Push schema directly (skip migrations - dev only)
bun run db:push

# Open Drizzle Studio (visual database browser)
bun run db:studio
```

### Query Examples

```typescript
import { db } from '@/db'
import { users, posts } from '@/db/schema'
import { eq } from 'drizzle-orm'

// Insert
const newUser = await db.insert(users).values({
  email: 'user@example.com',
  name: 'John Doe'
})

// Select
const allUsers = await db.select().from(users)

// Select with relations
const usersWithPosts = await db.query.users.findMany({
  with: { posts: true }
})

// Update
await db.update(users)
  .set({ name: 'Jane Doe' })
  .where(eq(users.id, '123'))

// Delete
await db.delete(users).where(eq(users.id, '123'))
```

## Schema Organization

You can split your schema into multiple files:

```
db/schema/
├── index.ts          # Re-exports all schemas
├── users.ts          # User-related tables
├── posts.ts          # Post-related tables
└── comments.ts       # Comment-related tables
```

Just make sure to export everything from `index.ts`.

## Best Practices

✅ **Use type inference** - `typeof users.$inferSelect` for types
✅ **Define relations** - Enable relational queries
✅ **Use migrations** - `db:generate` and `db:migrate` for production
✅ **Use `db:push` only in dev** - Skip migrations for rapid prototyping
✅ **Commit migrations** - Track schema changes in git
✅ **Don't commit `.env`** - Contains sensitive credentials

## Drizzle Studio

Launch the visual database browser:

```bash
bun run db:studio
```

Opens at `https://local.drizzle.studio` - browse data, run queries, inspect schema.

## Related Recipes

- `database/drizzle-schema` - Add a new Drizzle table
- `crud/resource` - Generate full CRUD workflow (uses Drizzle if detected)
- `server-actions/add-validated` - Create Server Actions with Drizzle integration

## Comparison with Prisma

| Feature | Drizzle | Prisma |
|---------|---------|--------|
| Type safety | ✅ Full TypeScript | ✅ Generated types |
| Bundle size | Smaller | Larger |
| Query builder | SQL-like | Method chaining |
| Studio | ✅ Built-in | ✅ Built-in |
| Edge runtime | ✅ Yes | ⚠️ Limited |
| Learning curve | Steeper | Gentler |

Choose Drizzle for:
- Edge runtime compatibility
- Smaller bundle size
- SQL-like queries
- Maximum performance

Choose Prisma for:
- Simpler learning curve
- Better documentation
- Larger ecosystem
- MongoDB support
