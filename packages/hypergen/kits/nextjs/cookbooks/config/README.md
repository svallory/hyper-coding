# Configuration Cookbook

Set up and configure your Next.js application stack with interactive wizards and individual setup recipes.

## Quick Start

Run the interactive wizard to configure your entire stack:

```bash
hypergen nextjs config all
```

Or configure individual tools:

```bash
hypergen nextjs config prisma    # Database with Prisma
hypergen nextjs config shadcn    # shadcn/ui components
```

## Recipes

### [all](./all/) - Complete Stack Setup Wizard
Interactive wizard that configures your entire Next.js application in one go. Prompts for database ORM, UI library, state management, and authentication choices, then runs the appropriate sub-recipes.

**Features:**
- Database: Prisma or Drizzle ORM
- UI: shadcn/ui component library
- State: TanStack Query setup
- Auth: NextAuth.js or Clerk (coming soon)

### [prisma](./prisma/) - Prisma ORM Setup
Configure Prisma ORM with PostgreSQL, MySQL, or SQLite. Generates Prisma schema, client singleton, and database scripts.

### [drizzle](./drizzle/) - Drizzle ORM Setup
Configure Drizzle ORM with your database of choice. Generates schema directory, database client, and migration scripts.

### [shadcn](./shadcn/) - shadcn/ui Component Library
Initialize shadcn/ui with essential components (button, form, input, select, textarea). Configures Tailwind CSS integration.

### [tanstack-query](./tanstack-query/) - TanStack Query Setup
Set up TanStack Query (React Query) for server state management. Generates QueryProvider, example hooks, and devtools configuration.

## Common Use Cases

### Full-Stack Application
Database, UI components, and state management:
```bash
hypergen nextjs config all \
  --database=prisma \
  --ui=true \
  --stateManagement=true
```

### JAMstack/Frontend-Only
UI and state management without database:
```bash
hypergen nextjs config all \
  --database=none \
  --ui=true \
  --stateManagement=true
```

### API/Backend Project
Just database configuration:
```bash
hypergen nextjs config drizzle
```

### Add to Existing Project
Re-run to add tools to your stack:
```bash
# Already have Prisma, now adding UI
hypergen nextjs config shadcn

# Adding state management
hypergen nextjs config tanstack-query
```

## What Gets Configured

### Database Setup
- **Prisma**: Schema file, client singleton, DATABASE_URL in .env
- **Drizzle**: Schema directory, database client, migration config, npm scripts

### UI Library
- **shadcn/ui**: components.json config, essential components, Tailwind integration

### State Management
- **TanStack Query**: QueryProvider, query client config, example hooks, devtools

## Next Steps

After running configuration recipes:

1. **Update environment variables** in `.env`
2. **Review generated files** and customize as needed
3. **Run migrations** (for database setups)
4. **Install provider components** in your root layout (for TanStack Query)
5. **Start building** with your configured stack

## Related Cookbooks

- [crud](../crud/) - Generate CRUD operations using your configured database
- [form](../form/) - Generate forms that work with your UI library
- [api](../api/) - Create API routes for your backend
