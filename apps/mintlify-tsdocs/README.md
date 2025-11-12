# mintlify-tsdocs

This tool generates [Mintlify](https://mintlify.com/)-compatible API documentation for your TypeScript library.
It reads the `*.api.json` data files produced by [API Extractor](https://api-extractor.com/) and generates
MDX files with proper frontmatter, navigation integration, and Mintlify-specific components.

## Features

- Generates MDX files with Mintlify frontmatter (title, description, icon)
- Automatic navigation integration via `docs.json` updates
- Rich UI components: `<ParamField>`, `<ResponseField>`, `<Expandable>` for nested types
- Support for complex TypeScript types with nested object documentation
- README.md conversion to index.mdx for package overview pages

## Quick Start

```bash
# Install API Extractor and generate .api.json files
npm install -g @microsoft/api-extractor
api-extractor run --local

# Generate Mintlify documentation
npx mintlify-tsdocs markdown \
  -i ./temp \
  -o ./docs/api \
  --docs-json ./docs/docs.json \
  --tab-name "API Reference" \
  --group "Core API"
```

## CLI Options

| Option | Description |
|--------|-------------|
| `-i, --input-folder` | Folder containing `*.api.json` files (default: `./input`) |
| `-o, --output-folder` | Output folder for MDX files - **contents will be deleted!** (default: `./markdown`) |
| `--docs-json` | Path to Mintlify `docs.json` file to update with navigation |
| `--tab-name` | Tab name in Mintlify navigation (default: "API Reference") |
| `--group` | Group name within the tab for organizing pages |
| `--menu` | Enable menu for the group in navigation |
| `--readme` | Convert project `README.md` to `index.mdx` |
| `--readme-title` | Custom title for the README page (only with `--readme`) |

## Links

- [API Reference](https://hyperdev.saulo.engineer/sdk-reference/mintlify-tsdocs/)
- [Architecture Documentation](./docs/architecture.md)
- [Contributing Guide](./CONTRIBUTING.md)

This project is based on [API Documenter](https://github.com/microsoft/rushstack/tree/main/apps/api-documenter) from the [Rush Stack](https://rushstack.io/) family of projects, enhanced with Mintlify-specific features.
