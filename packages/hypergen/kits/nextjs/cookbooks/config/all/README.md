# Next.js Stack Configuration Wizard

An interactive setup wizard that configures your entire Next.js application stack in one go. This recipe orchestrates multiple configuration recipes based on your choices, making it easy to set up a complete development environment.

## Features

- **Interactive prompts** - Guides you through configuration choices
- **Orchestrated setup** - Automatically runs the right sub-recipes based on your selections
- **Re-runnable** - Can be executed multiple times to update your configuration
- **Comprehensive** - Covers database, UI library, state management, and authentication

## Usage

### Basic Usage

Run the interactive wizard:

```bash
hypergen nextjs config all
```

The wizard will prompt you for:
1. Database ORM choice (none, Prisma, or Drizzle)
2. UI library setup (shadcn/ui)
3. State management (TanStack Query)
4. Authentication provider (NextAuth.js, Clerk, or none)

### Non-Interactive Usage

You can also run with pre-defined choices:

```bash
# Full stack setup
hypergen nextjs config all \
  --database=prisma \
  --ui=true \
  --stateManagement=true \
  --auth=nextauth

# Minimal setup (just database)
hypergen nextjs config all \
  --database=drizzle \
  --ui=false \
  --stateManagement=false \
  --auth=none

# UI and state management only
hypergen nextjs config all \
  --database=none \
  --ui=true \
  --stateManagement=true \
  --auth=none
```

## What It Does

Based on your selections, this recipe:

### Database Configuration

**If you choose Prisma:**
- Installs Prisma and @prisma/client
- Initializes Prisma with your chosen database provider
- Creates a Prisma client singleton at `lib/prisma.ts`
- Creates an example schema
- Sets up DATABASE_URL in .env

**If you choose Drizzle:**
- Installs Drizzle ORM and database driver
- Creates Drizzle config at `drizzle.config.ts`
- Creates database client at `db/index.ts`
- Sets up schema directory structure
- Creates example schema
- Adds database scripts to package.json
- Sets up DATABASE_URL in .env

### UI Library Setup

**If you enable shadcn/ui:**
- Initializes shadcn/ui with Base UI primitives (default)
- Installs essential components (button, form, input, label, select, textarea)
- Creates `components.json` configuration
- Sets up Tailwind CSS integration
- Creates component documentation

### State Management

**If you enable TanStack Query:**
- Installs @tanstack/react-query
- Installs React Query Devtools (optional)
- Creates QueryProvider component
- Sets up query client configuration
- Creates example query and mutation hooks
- Provides instructions for adding to root layout

### Authentication

**If you choose NextAuth.js or Clerk:**
- Currently displays a notice that this feature is coming soon
- Will be implemented in a future version

## Generated Output

Depending on your choices, this recipe generates:

### Prisma Setup
```
lib/
  └── prisma.ts          # Prisma client singleton
prisma/
  └── schema.prisma      # Database schema
.env                     # DATABASE_URL added
```

### Drizzle Setup
```
db/
  ├── index.ts           # Database client
  └── schema/
      └── example.ts     # Example schema
drizzle.config.ts        # Drizzle configuration
.env                     # DATABASE_URL added
```

### shadcn/ui Setup
```
components/
  └── ui/
      ├── button.tsx
      ├── form.tsx
      ├── input.tsx
      ├── label.tsx
      ├── select.tsx
      ├── textarea.tsx
      └── README.md      # Component documentation
components.json          # shadcn/ui configuration
```

### TanStack Query Setup
```
components/
  └── providers/
      └── query-provider.tsx  # QueryProvider component
lib/
  └── query-client.ts         # Query client config
hooks/
  ├── use-example-query.ts    # Example query hook
  └── use-example-mutation.ts # Example mutation hook
```

## How to Re-run to Reconfigure

This recipe is designed to be re-runnable. You can execute it multiple times to:

1. **Add new tools to your stack:**
   ```bash
   # Initially skipped UI library, now adding it
   hypergen nextjs config all --ui=true
   ```

2. **Switch database ORMs:**
   ```bash
   # Switch from Prisma to Drizzle
   hypergen nextjs config all --database=drizzle
   ```

3. **Update configuration:**
   - Most sub-recipes will skip if already configured
   - Some recipes may prompt before overwriting
   - .env updates are additive (won't overwrite existing values)

**Note:** When re-running with different database choices, you may want to manually clean up the old configuration files first.

## Common Configurations

### Full-Stack Setup
Database, UI, and state management:
```bash
hypergen nextjs config all \
  --database=prisma \
  --ui=true \
  --stateManagement=true \
  --auth=none
```

### JAMstack Setup
UI and state management without database:
```bash
hypergen nextjs config all \
  --database=none \
  --ui=true \
  --stateManagement=true \
  --auth=none
```

### Backend-Focused Setup
Just database configuration:
```bash
hypergen nextjs config all \
  --database=drizzle \
  --ui=false \
  --stateManagement=false \
  --auth=none
```

## Next Steps After Configuration

### After Prisma Setup:
1. Update `DATABASE_URL` in `.env` with your actual database credentials
2. Edit `prisma/schema.prisma` to define your data models
3. Run `npx prisma migrate dev --name init` to create your database
4. Import the client: `import { prisma } from '@/lib/prisma'`

### After Drizzle Setup:
1. Update `DATABASE_URL` in `.env` with your actual database credentials
2. Edit `db/schema/*.ts` to define your data models
3. Run `bun run db:generate` to generate migrations
4. Run `bun run db:migrate` to apply migrations
5. Import the client: `import { db } from '@/db'`

### After shadcn/ui Setup:
1. Browse components at [shadcn/ui docs](https://ui.shadcn.com/docs/components)
2. Add more components: `npx shadcn@latest add <component>`
3. Customize theme in `components.json`
4. Import components: `import { Button } from '@/components/ui/button'`

### After TanStack Query Setup:
1. Add `<QueryProvider>` to your root layout (app/layout.tsx)
2. Create query hooks in the `hooks/` directory
3. Use hooks in your components
4. Open React Query Devtools in development mode (bottom-left corner)

## Environment Variables

This recipe may add the following to your `.env` file:

```env
# Database (if Prisma or Drizzle selected)
DATABASE_URL="..."  # Template URL based on your database choice
```

Make sure to update these with your actual values before running your application.

## Troubleshooting

### "components.json already exists"
shadcn/ui recipe will prompt before overwriting. Answer 'y' to continue or 'n' to skip.

### Database connection errors
Make sure to update `DATABASE_URL` in `.env` with valid credentials before running migrations or the application.

### QueryProvider not working
Remember to manually add `<QueryProvider>` to your root layout as shown in the completion message.

## Related Recipes

You can also run individual configuration recipes:

- `hypergen nextjs config prisma` - Prisma setup only
- `hypergen nextjs config drizzle` - Drizzle setup only
- `hypergen nextjs config shadcn` - shadcn/ui setup only
- `hypergen nextjs config tanstack-query` - TanStack Query setup only

## Support

For issues or questions:
- Check individual recipe READMEs in the `config/` directory
- Review the generated code and comments
- Consult official documentation for each tool
