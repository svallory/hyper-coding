# CRUD Detail Page Recipe

Generate a production-ready detail/show page to display a single resource with edit and delete actions.

## Features

- **Server Component** for optimal performance and SEO
- **Display All Fields** with automatic type formatting
- **Edit Button** linking to edit page
- **Delete Button** with confirmation dialog
- **Back Navigation** to list page
- **Auto-detect ORM** (Prisma/Drizzle)
- **Error Handling** with notFound() for missing resources
- **Type-safe** with TypeScript

## Generated Files

1. **Detail Page**: `app/[resource]/[id]/page.tsx`
   - Server Component that fetches single resource
   - Displays all fields in a card layout
   - Edit and delete action buttons
   - Back navigation to list

2. **Get Server Action**: `app/actions/[resource].ts`
   - `get[Resource](id)` function
   - Auto-configured for Prisma or Drizzle
   - Error handling with descriptive messages

3. **Delete Dialog**: `components/[Resource]DeleteDialog.tsx` (optional)
   - Confirmation dialog before deletion
   - Loading state during deletion
   - Toast notifications for success/error
   - Auto-redirect after successful deletion

## Usage

### Basic Usage

```bash
hypergen nextjs:crud/detail-page
# Prompts:
# - Resource name (singular): post
```

### All Options

```bash
hypergen nextjs:crud/detail-page \
  --name=post \
  --model=BlogPost \
  --includeDelete=true
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | *required* | Resource name (singular, e.g., 'post', 'user') |
| `model` | string | PascalCase(name) | Model name (PascalCase) |
| `includeDelete` | boolean | true | Include delete button with dialog |

## Field Display

The detail page automatically formats fields based on their type:

| Type | Display | Example |
|------|---------|---------|
| `string` | Plain text | "Hello World" |
| `number` | Number | 42 |
| `boolean` | Yes/No | "Yes" or "No" |
| `Date` | Localized date | "12/31/2023, 10:30:00 AM" |

## Architecture

### Request Flow

```
User visits /[resource]/[id]
  ↓
Server Component extracts id from params
  ↓
Server Action get[Resource](id) called
  ↓
ORM query by ID
  ↓
If found: Render detail page
If not found: Return 404
```

## Customization

### Custom Field Display

Replace the auto-generated field mapping with custom fields:

```tsx
<CardContent className="space-y-4">
  <div>
    <dt className="text-sm font-medium text-muted-foreground">Title</dt>
    <dd className="mt-1 text-lg font-semibold">{post.title}</dd>
  </div>

  <div>
    <dt className="text-sm font-medium text-muted-foreground">Content</dt>
    <dd className="mt-1 text-sm whitespace-pre-wrap">{post.content}</dd>
  </div>

  <div>
    <dt className="text-sm font-medium text-muted-foreground">Status</dt>
    <dd className="mt-1">
      {post.published ? (
        <Badge variant="success">Published</Badge>
      ) : (
        <Badge variant="secondary">Draft</Badge>
      )}
    </dd>
  </div>
</CardContent>
```

### Add Relations

Display related data by including relations in the Server Action:

```typescript
export async function getPost(id: string) {
  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      author: true,
      comments: true,
    },
  })

  if (!post) throw new Error('Post not found')
  return post
}
```

Then display in the page:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Author</CardTitle>
  </CardHeader>
  <CardContent>
    <p>{post.author.name}</p>
    <p className="text-sm text-muted-foreground">{post.author.email}</p>
  </CardContent>
</Card>
```

## ORM Support

### Prisma

Generates Prisma query:

```typescript
const post = await prisma.post.findUnique({
  where: { id },
})
```

### Drizzle

Generates Drizzle query boilerplate:

```typescript
const [post] = await db.select().from(posts).where(eq(posts.id, id))
```

## Requirements

### shadcn/ui Components

```bash
npx shadcn-ui@latest add button card alert-dialog toast
```

### Icons

```bash
bun add lucide-react
```

## Examples

### Blog Post

```bash
hypergen nextjs:crud/detail-page --name=post
```

### Product

```bash
hypergen nextjs:crud/detail-page --name=product
```

### User Profile

```bash
hypergen nextjs:crud/detail-page --name=user --includeDelete=false
```

## Next Steps

After generating:

1. **Implement Get Action**: Complete the `get[Resource]()` Server Action
2. **Customize Fields**: Replace auto-generated fields with custom layout
3. **Add Relations**: Include and display related data
4. **Style Card**: Customize card design to match your app
5. **Add Metadata**: Configure page metadata for SEO

## Troubleshooting

### 404 Not Found

If all detail pages show 404:
1. Check the `get[Resource]()` function is implemented
2. Verify database connection
3. Check that records exist in database
4. Ensure Prisma types are generated: `npx prisma generate`

### TypeScript Errors

If you see type errors:
1. Generate database types: `npx prisma generate`
2. Check that `@/app/actions/[resource]` exists
3. Verify component imports are correct

## Related Recipes

- `crud/list-page` - Generate list/index page
- `crud/create-page` - Generate create page with form
- `crud/edit-page` - Generate edit page with form
- `crud/delete` - Generate delete functionality only
- `crud/resource` - Generate complete CRUD (orchestrates all)

## License

MIT
