# @hyper-kits/starlight

A modern [Hyper](https://github.com/SubtleTools/hyper) kit for creating beautiful [Astro/Starlight](https://starlight.astro.build/) documentation sites.

## Features

- 🚀 **Quick Setup** - Generate a complete documentation site in seconds
- 📝 **TypeDoc Integration** - Automatic API documentation from TypeScript
- 🌐 **OpenAPI/Swagger** - Interactive API documentation
- ⌨️ **Keyboard Shortcuts** - Document shortcuts with starlight-kbd
- 📑 **Auto Sidebar** - Automatic sidebar generation
- ⬆️ **Scroll to Top** - Easy navigation button
- 📋 **Changelogs** - Track project changes
- 🗂️ **Obsidian** - Publish Obsidian vaults

## Installation

```bash
hyper kit install @hyper-kits/starlight
```

## Usage

### Create a New Documentation Site

```bash
hyper starlight project create
```

### Add a Documentation Page

```bash
hyper starlight page --title "API Reference" --slug "api-reference"
```

### Add Integrations

```bash
# TypeDoc API documentation
hyper starlight integrations typedoc

# OpenAPI/Swagger
hyper starlight integrations openapi

# Keyboard shortcuts
hyper starlight integrations keyboard

# Scroll to top button
hyper starlight integrations scroll-to-top

# Changelogs
hyper starlight integrations changelogs

# Obsidian vault
hyper starlight integrations obsidian
```

## Project Structure

```
my-docs-site/
├── src/
│   ├── content/
│   │   ├── docs/          # Documentation content (MDX)
│   │   └── config.ts      # Content configuration
│   └── env.d.ts           # TypeScript declarations
├── public/                # Static assets
├── astro.config.mjs       # Astro configuration
├── tailwind.config.mjs    # Tailwind configuration
└── package.json
```

## Available Scripts

- `bun run dev` - Start development server
- `bun run build` - Build for production
- `bun run preview` - Preview production build

## License

MIT
