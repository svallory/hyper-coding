# Prisma Init Recipe

Initialize Prisma ORM in your Next.js project with best practices.

## Usage

```bash
hypergen nextjs database prisma-init
```

Or with options:

```bash
hypergen nextjs database prisma-init --database postgresql --databaseUrl "postgresql://user:pass@localhost:5432/mydb"
```

## What It Does

1. **Installs Dependencies**
   - `prisma` (dev dependency) - Prisma CLI
   - `@prisma/client` - Prisma Client for database access

2. **Initializes Prisma**
   - Creates `prisma/schema.prisma` with your chosen database provider
   - Sets up `.env` file with `DATABASE_URL`

3. **Creates Prisma Client Singleton** (`lib/prisma.ts`)
   - Follows Next.js best practices to avoid connection exhaustion
   - Enables query logging in development
   - Reuses client instance in development (hot reload safe)

4. **Adds Example Models**
   - User and Post models to get you started
   - Demonstrates relationships and common patterns

## Generated Files

- `prisma/schema.prisma` - Database schema definition
- `lib/prisma.ts` - Prisma Client singleton
- `.env` - Environment variables (DATABASE_URL)

## Options

- **`--database`** (default: `postgresql`)
  - Choices: `postgresql`, `mysql`, `sqlite`, `mongodb`, `cockroachdb`
  - The database provider you want to use

- **`--databaseUrl`** (optional)
  - Full database connection string
  - If not provided, a template URL is added to `.env`

## Next Steps

After running this recipe:

1. **Update `.env`** with your actual database credentials
2. **Edit `prisma/schema.prisma`** to define your data models
3. **Create your first migration**:
   ```bash
   npx prisma migrate dev --name init
   ```
4. **Generate Prisma Client**:
   ```bash
   npx prisma generate
   ```
5. **Use in your code**:
   ```typescript
   import { prisma } from '@/lib/prisma'

   const users = await prisma.user.findMany()
   ```

## Database-Specific Setup

### PostgreSQL
```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
```

### MySQL
```env
DATABASE_URL="mysql://USER:PASSWORD@HOST:PORT/DATABASE"
```

### SQLite (for local development)
```env
DATABASE_URL="file:./dev.db"
```

### MongoDB
```env
DATABASE_URL="mongodb+srv://USER:PASSWORD@HOST/DATABASE"
```

## Best Practices

✅ **Use the singleton pattern** - Import from `lib/prisma.ts`, not `@prisma/client`
✅ **Commit `prisma/schema.prisma`** - Your schema is code
✅ **Don't commit `.env`** - Contains sensitive credentials
✅ **Use migrations** - `prisma migrate dev` for development
✅ **Generate client after schema changes** - `prisma generate`

## Related Recipes

- `database/prisma-model` - Add a new Prisma model
- `crud/resource` - Generate full CRUD workflow (uses Prisma if detected)
- `server-actions/add-validated` - Create Server Actions with Prisma integration
