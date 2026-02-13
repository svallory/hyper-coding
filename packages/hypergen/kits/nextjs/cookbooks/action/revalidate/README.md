# Server Action with Cache Revalidation

Generate a Server Action with Next.js cache revalidation patterns (revalidatePath, revalidateTag) and optimistic updates.

## Usage

```bash
hypergen server-actions:add-revalidate
```

## Variables

- `name` (required): Action name in camelCase (e.g. "createPost", "updateUser")
- `fields` (required): Array of form fields in format "name:type:validation"
  - Same format as `add-validated` recipe
- `revalidationType` (optional): Type of revalidation - `path`, `tag`, or `both` (default: "both")
- `revalidatePath` (optional): Path to revalidate (e.g. "/posts", "/dashboard")
- `revalidateTags` (optional): Array of cache tags to revalidate (e.g. ["posts", "user-posts"])
- `dir` (optional): Output directory for action (default: "app/actions")
- `schemaDir` (optional): Output directory for schema (default: "lib/schemas")
- `withOptimistic` (optional): Include optimistic update examples (default: false)
- `redirectAfter` (optional): Redirect after successful action (default: false)
- `redirectPath` (optional): Path to redirect to after success

## Examples

### Path-based revalidation
```bash
hypergen server-actions:add-revalidate \
  --name createPost \
  --fields title:string:min(5) content:string:min(10) \
  --revalidationType path \
  --revalidatePath /posts
```

### Tag-based revalidation
```bash
hypergen server-actions:add-revalidate \
  --name updateUser \
  --fields name:string bio:string:optional \
  --revalidationType tag \
  --revalidateTags user-data,profile
```

### Both path and tag revalidation
```bash
hypergen server-actions:add-revalidate \
  --name createComment \
  --fields postId:number content:string:min(1) \
  --revalidationType both \
  --revalidatePath /posts \
  --revalidateTags comments,post-comments
```

### With redirect after success
```bash
hypergen server-actions:add-revalidate \
  --name publishPost \
  --fields title:string status:enum:draft,published \
  --revalidatePath /posts \
  --redirectAfter true \
  --redirectPath /posts
```

## Generated Code

### Server Action with Path Revalidation

```typescript
'use server'

import { createPostSchema, type CreatePostInput } from '@/lib/schemas/create-post'
import { revalidatePath } from 'next/cache'

export type CreatePostState = {
  error?: string
  errors?: Record<string, string[]>
  success?: boolean
  data?: CreatePostInput
} | null

export async function createPost(
  prevState: CreatePostState,
  formData: FormData
): Promise<CreatePostState> {
  try {
    const rawData = {
      title: formData.get('title'),
      content: formData.get('content'),
    }

    const parsed = createPostSchema.safeParse(rawData)

    if (!parsed.success) {
      return {
        error: 'Validation failed. Please check the form for errors.',
        errors: parsed.error.flatten().fieldErrors,
      }
    }

    const data = parsed.data

    // Save to database
    await db.insert(posts).values(data)

    // Revalidate the posts page to show the new post
    revalidatePath('/posts')

    return { success: true, data }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
    }
  }
}
```

## Cache Revalidation Strategies

### 1. Path Revalidation (`revalidatePath`)

Invalidates cached data for a specific route or layout.

**Use cases:**
- After creating/updating/deleting data that affects a specific page
- When you know exactly which route needs to be refreshed

**Examples:**
```typescript
// Revalidate a specific page
revalidatePath('/posts')

// Revalidate a dynamic route
revalidatePath(`/posts/${postId}`)

// Revalidate an entire layout
revalidatePath('/dashboard', 'layout')

// Revalidate all pages (use sparingly!)
revalidatePath('/', 'layout')
```

### 2. Tag Revalidation (`revalidateTag`)

Invalidates all cached data with a specific tag, regardless of route.

**Use cases:**
- When data is used across multiple pages
- When you want fine-grained cache control
- When building a flexible caching strategy

**Examples:**
```typescript
// Revalidate all requests tagged with 'posts'
revalidateTag('posts')

// Revalidate user-specific data
revalidateTag(`user-${userId}`)

// Revalidate multiple related caches
revalidateTag('comments')
revalidateTag('post-comments')
```

**Setting tags in fetch:**
```typescript
// In your data fetching function
async function getPosts() {
  const res = await fetch('https://api.example.com/posts', {
    next: {
      tags: ['posts', 'content'],
      revalidate: 3600, // Optional: revalidate after 1 hour
    },
  })
  return res.json()
}
```

### 3. Combining Both Strategies

Use both for comprehensive cache invalidation:

```typescript
export async function updatePost(prevState, formData) {
  try {
    // ... validation and update logic

    // Revalidate specific post page
    revalidatePath(`/posts/${postId}`)

    // Revalidate posts list
    revalidatePath('/posts')

    // Revalidate all caches tagged with 'posts'
    revalidateTag('posts')

    return { success: true }
  } catch (error) {
    return { error: error.message }
  }
}
```

## Optimistic Updates

Use `useOptimistic` hook for instant UI updates before server confirmation.

### Example: Optimistic Post Creation

```tsx
'use client'

import { useActionState, useOptimistic } from 'react'
import { createPost } from '@/app/actions/createPost'

type Post = {
  id: string
  title: string
  content: string
}

export function PostList({ initialPosts }: { initialPosts: Post[] }) {
  const [state, formAction, pending] = useActionState(createPost, null)

  // Optimistic state
  const [optimisticPosts, addOptimisticPost] = useOptimistic(
    initialPosts,
    (state, newPost: Post) => [...state, newPost]
  )

  async function handleSubmit(formData: FormData) {
    // Add optimistically
    const tempPost = {
      id: crypto.randomUUID(),
      title: formData.get('title') as string,
      content: formData.get('content') as string,
    }
    addOptimisticPost(tempPost)

    // Submit to server
    await formAction(formData)
  }

  return (
    <div>
      <form action={handleSubmit}>
        <input name="title" placeholder="Post title" />
        <textarea name="content" placeholder="Post content" />
        <button disabled={pending}>Create Post</button>
      </form>

      <div>
        {optimisticPosts.map((post) => (
          <div key={post.id} className={pending ? 'opacity-50' : ''}>
            <h3>{post.title}</h3>
            <p>{post.content}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
```

### Example: Optimistic Like Button

```tsx
'use client'

import { useOptimistic } from 'react'
import { likePost } from '@/app/actions/likePost'

export function LikeButton({ postId, initialLikes }: { postId: string; initialLikes: number }) {
  const [optimisticLikes, addOptimisticLike] = useOptimistic(
    initialLikes,
    (state, amount: number) => state + amount
  )

  async function handleLike() {
    addOptimisticLike(1)
    await likePost(postId)
  }

  return (
    <button onClick={handleLike}>
      ❤️ {optimisticLikes}
    </button>
  )
}
```

## Usage Patterns

### Pattern 1: Form with Revalidation

```tsx
'use client'

import { useActionState } from 'react'
import { createPost } from '@/app/actions/createPost'

export function CreatePostForm() {
  const [state, formAction, pending] = useActionState(createPost, null)

  return (
    <form action={formAction}>
      <input name="title" required />
      <textarea name="content" required />
      <button disabled={pending}>Create</button>
      {state?.success && <p>Post created! The list will refresh automatically.</p>}
    </form>
  )
}
```

### Pattern 2: Inline Edit with Revalidation

```tsx
'use client'

import { useActionState } from 'react'
import { updatePost } from '@/app/actions/updatePost'

export function EditablePost({ post }) {
  const [state, formAction, pending] = useActionState(updatePost, null)
  const [isEditing, setIsEditing] = useState(false)

  return (
    <div>
      {isEditing ? (
        <form action={formAction} onSubmit={() => setIsEditing(false)}>
          <input name="id" type="hidden" value={post.id} />
          <input name="title" defaultValue={post.title} />
          <button disabled={pending}>Save</button>
        </form>
      ) : (
        <div>
          <h3>{post.title}</h3>
          <button onClick={() => setIsEditing(true)}>Edit</button>
        </div>
      )}
    </div>
  )
}
```

### Pattern 3: Delete with Optimistic Update

```tsx
'use client'

import { useOptimistic } from 'react'
import { deletePost } from '@/app/actions/deletePost'

export function PostList({ posts }) {
  const [optimisticPosts, removePost] = useOptimistic(
    posts,
    (state, postId: string) => state.filter((p) => p.id !== postId)
  )

  async function handleDelete(postId: string) {
    removePost(postId)
    await deletePost(postId)
  }

  return (
    <div>
      {optimisticPosts.map((post) => (
        <div key={post.id}>
          <h3>{post.title}</h3>
          <button onClick={() => handleDelete(post.id)}>Delete</button>
        </div>
      ))}
    </div>
  )
}
```

## When to Use

Use this recipe when you need:
- ✅ Automatic cache invalidation after mutations
- ✅ Fine-grained cache control with tags
- ✅ Instant UI feedback with optimistic updates
- ✅ Production-ready data synchronization
- ✅ Server-rendered pages that stay fresh

## Best Practices

### 1. Use Specific Tags
```typescript
// ✅ Good - specific tags
revalidateTag(`post-${postId}`)
revalidateTag(`user-${userId}-posts`)

// ❌ Bad - too broad
revalidateTag('data')
```

### 2. Combine Path and Tag
```typescript
// Update a specific post
revalidatePath(`/posts/${postId}`)  // Specific page
revalidateTag('posts')               // All posts lists
revalidateTag(`user-${userId}`)      // User-specific data
```

### 3. Handle Errors Gracefully
```typescript
try {
  await db.update(posts).set(data)
  revalidatePath('/posts')
} catch (error) {
  // Don't revalidate if the mutation failed
  return { error: 'Update failed' }
}
```

### 4. Use Optimistic Updates Carefully
```typescript
// ✅ Good - simple, reversible changes
addOptimisticLike(1)

// ❌ Bad - complex state changes
// Optimistic updates work best for simple increments/additions
// Use with caution for complex state transformations
```

## Integration with Other Recipes

### With Forms Cookbook
```bash
# Generate form
hypergen forms:add-rhf --name PostForm --fields title:text content:textarea

# Generate action with revalidation
hypergen server-actions:add-revalidate \
  --name createPost \
  --fields title:string:min(5) content:string:min(10) \
  --revalidatePath /posts
```

### With CRUD Resources
The `crud/resource` recipe automatically uses this pattern for all mutations.

## Next.js Caching Reference

### Static Rendering (Default)
```typescript
// Page is cached at build time
export default async function PostsPage() {
  const posts = await getPosts() // Cached
  return <PostList posts={posts} />
}
```

### Dynamic Rendering
```typescript
// Page is rendered on every request
export const dynamic = 'force-dynamic'

export default async function PostsPage() {
  const posts = await getPosts() // Not cached
  return <PostList posts={posts} />
}
```

### Time-based Revalidation
```typescript
// Revalidate every hour
export const revalidate = 3600

export default async function PostsPage() {
  const posts = await getPosts()
  return <PostList posts={posts} />
}
```

### On-demand Revalidation (This Recipe!)
```typescript
// Revalidate when data changes
'use server'

export async function createPost(prevState, formData) {
  await db.insert(posts).values(data)
  revalidatePath('/posts') // 👈 Instant refresh!
}
```

## Debugging Cache Issues

### Check if cache is being used
```typescript
// Add logging to your data fetching
async function getPosts() {
  console.log('Fetching posts at', new Date().toISOString())
  const res = await fetch('...')
  return res.json()
}
```

### Force revalidation during development
```bash
# Next.js automatically disables caching in dev mode
npm run dev

# To test caching, build and start production
npm run build
npm start
```

### Clear Next.js cache
```bash
# Remove .next directory
rm -rf .next
npm run build
```
