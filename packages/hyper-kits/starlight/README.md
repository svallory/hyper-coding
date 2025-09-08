# @hyper-kits/starlight

A Hypergen V8 cookbook for creating beautiful Astro/Starlight documentation sites with TypeDoc integration using the Recipe Step System.

## Features

- 🚀 **Astro/Starlight**: Built on the fast and modern Astro framework with Starlight theme
- 📖 **TypeDoc Integration**: Automatic API documentation generation from TypeScript
- 📋 **OpenAPI Support**: Interactive API documentation from OpenAPI/Swagger specs
- 🎨 **Modern Design**: Clean, responsive design with dark mode support
- 🔍 **Built-in Search**: Full-text search functionality
- 📱 **Mobile Friendly**: Responsive design that works on all devices
- ⌨️ **Keyboard Shortcuts**: Optional keyboard navigation support
- 🔗 **Auto Sidebar**: Automatic sidebar generation from content structure
- 📈 **Changelog Support**: Built-in changelog documentation
- 🗂️ **Obsidian Integration**: Connect with Obsidian vaults
- 🔄 **Recipe Step System**: Uses Hypergen V8's new Recipe Step System with Template, Action, and CodeMod tools

## Usage

### Install the cookbook

```bash
bun add @hyper-kits/starlight
```

### Generate a new documentation site

```bash
# Execute complete recipe with all steps
hypergen recipe execute @hyper-kits/starlight --projectName="My Project" --projectDescription="My awesome project docs"

# Or use the local recipe file
hypergen recipe execute ./recipe.yml --projectName="My Project"
```

### Step-by-step execution

```bash
# List all steps in the recipe
hypergen step list @hyper-kits/starlight

# Execute individual steps
hypergen step execute @hyper-kits/starlight "Generate project README" --projectName="My Project"
```

### Available options

The template will prompt you for:

- **Project folder name**: Where files will be generated
- **Project name**: Name for your documentation site
- **Project description**: Brief description of your project
- **Site URL**: Production URL for the site
- **GitHub repository**: Link to your GitHub repo (optional)
- **TypeDoc integration**: Generate API docs from TypeScript
- **TypeScript entry point**: Main file for API documentation
- **OpenAPI documentation**: Include OpenAPI/Swagger docs
- **Keyboard shortcuts**: Enable keyboard navigation
- **Auto sidebar**: Automatic sidebar generation
- **Scroll to top**: Add scroll-to-top button
- **Changelog support**: Include changelog documentation
- **Obsidian integration**: Connect with Obsidian vaults

## Cookbook Structure

This cookbook follows the Hypergen V8 Recipe Step System conventions:

- Package name: `@hyper-kits/starlight` (follows `@hyper-kits/*` naming pattern)
- Repository: Tagged with `hyper-kit` topic
- Structure: Uses `recipe.yml` for Recipe Step System configuration with coordinated Template and Action tools
- Format: Recipe Step System V2.0 with sequential step execution

## Development

After generating your documentation site:

```bash
cd your-project-folder
bun install
bun run dev
```

## Requirements

- Node.js 16+
- Hypergen 8+
- Bun or npm for package management

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
