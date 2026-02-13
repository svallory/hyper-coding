# shadcn/ui Init Recipe

Initialize shadcn/ui component library in your Next.js project with support for both Radix UI and Base UI primitives.

## Usage

```bash
hypergen nextjs ui shadcn-init
```

Or with options:

```bash
hypergen nextjs ui shadcn-init --primitives baseui --style new-york --baseColor slate
```

## What It Does

1. **Initializes shadcn/ui**
   - Creates `components.json` configuration
   - Sets up Tailwind CSS integration
   - Configures path aliases

2. **Installs Essential Components**
   - Button
   - Form (with React Hook Form + Zod)
   - Input
   - Label
   - Select
   - Textarea

3. **Creates Documentation**
   - `components/ui/README.md` with usage examples
   - Configuration reference
   - Quick start guide

## Generated Files

- `components.json` - shadcn/ui configuration
- `components/ui/*` - Component files
- `components/ui/README.md` - Documentation and examples
- `lib/utils.ts` - Utility functions (cn helper)

## Options

- **`--primitives`** (default: `baseui`)
  - Choices: `baseui`, `radix`
  - **Base UI**: Officially supported as of January 2026, modern primitives
  - **Radix UI**: Original primitives, widely used

- **`--style`** (default: `default`)
  - Choices: `default`, `new-york`
  - Component design style

- **`--baseColor`** (default: `zinc`)
  - Choices: `slate`, `gray`, `zinc`, `neutral`, `stone`
  - Base color palette for components

- **`--cssVariables`** (default: `true`)
  - Use CSS variables for theme colors
  - Enables easy theme switching

## Why Base UI?

**Base UI** is now officially supported by shadcn/ui (as of January 2026) and offers:

✅ **Modern architecture** - Built with latest React patterns
✅ **Better accessibility** - WCAG 2.1 AAA compliance out of the box
✅ **Smaller bundle** - Optimized for performance
✅ **Active development** - Backed by MUI team

**When to use Radix UI**:
- Existing project using Radix
- Need specific Radix-only features
- Larger ecosystem compatibility

## Next Steps

After running this recipe:

1. **Browse available components**:
   Visit [ui.shadcn.com/docs/components](https://ui.shadcn.com/docs/components)

2. **Add more components**:
   ```bash
   npx shadcn@latest add dialog
   npx shadcn@latest add dropdown-menu
   npx shadcn@latest add card
   npx shadcn@latest add table
   npx shadcn@latest add toast
   ```

3. **Customize theme**:
   Edit `app/globals.css` to change colors

4. **Use in your components**:
   ```tsx
   import { Button } from '@/components/ui/button'

   export function MyComponent() {
     return <Button>Click me</Button>
   }
   ```

## Common Components to Add

### Forms & Inputs
```bash
npx shadcn@latest add form input label textarea select checkbox radio-group switch
```

### Layout & Navigation
```bash
npx shadcn@latest add card dialog drawer sheet tabs navigation-menu
```

### Data Display
```bash
npx shadcn@latest add table badge avatar tooltip popover
```

### Feedback
```bash
npx shadcn@latest add alert toast progress skeleton
```

## Customization

### Theme Colors

Edit CSS variables in `app/globals.css`:

```css
:root {
  --primary: 222.2 47.4% 11.2%;
  --primary-foreground: 210 40% 98%;
  /* ... */
}

.dark {
  --primary: 210 40% 98%;
  --primary-foreground: 222.2 47.4% 11.2%;
  /* ... */
}
```

### Component Variants

Components use `class-variance-authority` (cva) for variants:

```tsx
// components/ui/button.tsx
const buttonVariants = cva(
  "base-classes",
  {
    variants: {
      variant: {
        default: "...",
        destructive: "...",
        custom: "bg-purple-500 hover:bg-purple-600", // Add custom variant
      },
    },
  }
)
```

## Integration with Forms

shadcn/ui Form components integrate perfectly with React Hook Form:

```tsx
'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'

const schema = z.object({
  email: z.string().email(),
})

export function MyForm() {
  const form = useForm({
    resolver: zodResolver(schema),
  })

  return <Form {...form}>...</Form>
}
```

## Best Practices

✅ **Copy, don't install** - shadcn/ui copies components to your project
✅ **Customize freely** - Components are yours to modify
✅ **Use TypeScript** - Full type safety included
✅ **Follow conventions** - Keep components in `components/ui/`
✅ **Use cn() helper** - For conditional classes: `cn("base", condition && "extra")`

## Troubleshooting

### Path alias not working

Ensure `tsconfig.json` has:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

### Components not styled correctly

1. Check `tailwind.config.ts` includes component paths
2. Verify `app/globals.css` imports Tailwind directives
3. Restart dev server

### Dark mode not working

Add dark mode provider to `app/layout.tsx`:
```tsx
import { ThemeProvider } from '@/components/theme-provider'

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system">
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
```

## Related Recipes

- `ui/shadcn-add` - Add individual shadcn/ui components
- `forms/add-rhf` - Generate form with shadcn/ui + React Hook Form
- `data-table/add` - Generate data table with shadcn/ui
- `crud/resource` - Full CRUD UI with shadcn/ui components

## Resources

- **shadcn/ui Documentation**: https://ui.shadcn.com/docs
- **Base UI Documentation**: https://base-ui.com/
- **Radix UI Documentation**: https://www.radix-ui.com/
- **Tailwind CSS**: https://tailwindcss.com/docs
