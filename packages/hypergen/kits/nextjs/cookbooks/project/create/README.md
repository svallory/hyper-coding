# Create Project Recipe

Bootstrap a complete Next.js 15 project with TypeScript, Tailwind CSS v4, and modern development tooling.

## Usage

```bash
# Basic project
hypergen nextjs project create --name=my-app

# With src directory
hypergen nextjs project create \
  --name=my-app \
  --description="My awesome Next.js app" \
  --useSrcDir

# With Biome linter
hypergen nextjs project create \
  --name=my-app \
  --linter=biome

# No linter
hypergen nextjs project create \
  --name=my-app \
  --linter=none
```

## Generated Files

```
my-app/
├── app/                         # App Router directory (or src/app if --useSrcDir)
│   ├── globals.css             # Tailwind CSS + custom styles
│   ├── layout.tsx              # Root layout
│   └── page.tsx                # Home page
├── public/                      # Static assets
│   ├── next.svg                # Next.js logo
│   ├── vercel.svg             # Vercel logo
│   ├── file.svg               # File icon
│   ├── globe.svg              # Globe icon
│   └── window.svg             # Window icon
├── .env.example                # Environment variables template
├── .gitignore                  # Git ignore rules
├── eslint.config.mjs          # ESLint config (if linter=eslint)
├── biome.json                  # Biome config (if linter=biome)
├── next.config.ts              # Next.js configuration
├── next-env.d.ts              # Next.js TypeScript declarations
├── package.json                # Dependencies and scripts
├── postcss.config.mjs         # PostCSS configuration
├── README.md                   # Project documentation
└── tsconfig.json              # TypeScript configuration
```

## Variables

| Variable | Type | Description | Default |
|----------|------|-------------|---------|
| `name` | string | Project directory name | **Required** |
| `description` | string | Project description | "A Next.js application" |
| `useSrcDir` | boolean | Use src/ directory structure | `false` |
| `linter` | enum | Linting tool (eslint, biome, none) | `eslint` |

## Generated Configuration

### package.json

```json
{
  "name": "my-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "typescript": "^5",
    "@tailwindcss/postcss": "^4",
    "tailwindcss": "^4"
  }
}
```

### TypeScript Configuration

Strict TypeScript with path aliases:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"]  // or ["./src/*"] if useSrcDir
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### Tailwind CSS

Modern Tailwind v4 setup in `app/globals.css`:

```css
@import "tailwindcss";

@theme {
  /* Your custom design tokens */
  --font-family-sans: "Inter", system-ui, sans-serif;
}

/* Your custom styles */
```

### Next.js Configuration

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /* config options here */
}

export default nextConfig
```

## After Creation

### 1. Install Dependencies

```bash
cd my-app
bun install
```

### 2. Start Development Server

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000)

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 4. Configure Your Stack

Use the config cookbook:

```bash
# Interactive wizard
hypergen nextjs config all

# Or individual tools
hypergen nextjs config prisma
hypergen nextjs config shadcn
hypergen nextjs config tanstack-query
```

## Linting Options

### ESLint (Default)

TypeScript-first ESLint with Next.js rules:

```javascript
// eslint.config.mjs
import { FlatCompat } from "@eslint/eslintrc"

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
})

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
]

export default eslintConfig
```

Run linter:
```bash
bun run lint
```

### Biome

Fast Rust-based linter and formatter:

```json
{
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  }
}
```

Run linter:
```bash
bunx @biomejs/biome check .
```

## Directory Structure

### Standard (without --useSrcDir)

```
my-app/
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── public/
└── ... (config files)
```

### With src/ Directory (--useSrcDir)

```
my-app/
├── src/
│   └── app/
│       ├── globals.css
│       ├── layout.tsx
│       └── page.tsx
├── public/
└── ... (config files)
```

**Benefits of src/ directory:**
- Better separation of source code and configuration
- Cleaner project root
- Recommended for larger projects

## Initial Pages

### Root Layout

```typescript
import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Create Next App",
  description: "Generated by create next app",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

### Home Page

Starter page with Next.js branding and links to documentation.

## Environment Variables

Example `.env.example`:

```env
# App
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Database
# DATABASE_URL="postgresql://user:password@localhost:5432/mydb"

# Authentication
# NEXTAUTH_SECRET=
# NEXTAUTH_URL=http://localhost:3000

# API Keys
# STRIPE_SECRET_KEY=
# STRIPE_PUBLISHABLE_KEY=
```

## Next Steps

### Add Database

```bash
hypergen nextjs config prisma
# or
hypergen nextjs config drizzle
```

### Add UI Components

```bash
hypergen nextjs config shadcn
```

### Add State Management

```bash
hypergen nextjs config tanstack-query
```

### Create Features

```bash
# Generate CRUD resource
hypergen nextjs crud resource --name=post

# Generate pages
hypergen nextjs page add --path=about
hypergen nextjs page add --path="blog/[slug]"

# Generate components
hypergen nextjs component add --name=Header
hypergen nextjs component add --name=Footer
```

## Available Scripts

```bash
# Development with Turbopack
bun dev

# Production build
bun run build

# Start production server
bun start

# Run linter
bun run lint
```

## Git Setup

Initialize Git repository:

```bash
cd my-app
git init
git add .
git commit -m "feat: initial project setup"
```

The `.gitignore` includes:
- node_modules/
- .next/
- .env files (except .env.example)
- Build output
- IDE files

## Deployment

### Vercel (Recommended)

```bash
bun install -g vercel
vercel
```

### Docker

See [project README](../../../project/) for Dockerfile example.

### Other Platforms

Works on any Node.js platform:
- Netlify
- Railway
- Render
- AWS Amplify
- DigitalOcean

## Best Practices

✅ **Use src/ for larger projects** - Better organization
✅ **Set up environment variables** - Use .env.example as template
✅ **Choose linting tool wisely** - ESLint for ecosystem, Biome for speed
✅ **Initialize Git early** - Track changes from start
✅ **Configure stack next** - Database, UI, state management
✅ **Use TypeScript strictly** - Catch errors early
✅ **Follow Next.js conventions** - App Router best practices

## Troubleshooting

### Port already in use
```bash
bun dev -- -p 3001
```

### Build errors
```bash
rm -rf .next
bun run build
```

### TypeScript errors
```bash
rm -rf .next
bun dev  # Regenerates types
```

## Related Recipes

- [config/all](../../config/all/) - Configure your project stack
- [page/add](../../page/add/) - Generate pages
- [component/add](../../component/add/) - Create components
- [crud/resource](../../crud/resource/) - Build CRUD features
