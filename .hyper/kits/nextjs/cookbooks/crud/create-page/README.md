# CRUD Create Page Recipe

Generate a production-ready create page with form, validation, and Server Actions for Next.js applications.

## Features

- **Client Component** with React Hook Form
- **Zod Validation** with type-safe schemas
- **Server Action** for data creation
- **Auto-redirect** after successful creation
- **Auto-detect ORM** schema to generate form fields
- **shadcn/ui Components** for consistent UI

## Generated Files

1. **Create Page**: `app/[resource]/new/page.tsx`
2. **Form Component**: `components/[Resource]Form.tsx` (reusable for create/edit)
3. **Zod Schema**: `lib/schemas/[resource]-schema.ts`
4. **Server Action**: `app/actions/[resource].ts` (create function)

## Usage

```bash
# Basic
hypergen nextjs:crud/create-page --name=post

# With fields
hypergen nextjs:crud/create-page --name=post \
  --fields="title:string,content:text,published:boolean"

# With auto-detection
hypergen nextjs:crud/create-page --name=post
# Auto-detects fields from Prisma/Drizzle schema
```

## Field Types

| Type | Component | Validation |
|------|-----------|------------|
| `string` | Input | `z.string()` |
| `text` | Textarea | `z.string()` |
| `number` | Number input | `z.number()` |
| `boolean` | Switch | `z.boolean()` |
| `date` | Date input | `z.date()` |
| `email` | Email input | `z.string().email()` |

## Requirements

```bash
npx shadcn-ui@latest add form input textarea switch button
bun add zod react-hook-form @hookform/resolvers
```

## Related Recipes

- `crud/edit-page` - Generate edit page
- `crud/list-page` - Generate list page
- `crud/detail-page` - Generate detail page
- `crud/resource` - Generate complete CRUD

## License

MIT
