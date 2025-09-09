# typedoc-plugin-mintlify

> A TypeDoc plugin that generates Mintlify-compatible MDX documentation for TypeScript SDKs.

## Features

- ✅ **Mintlify MDX Generation**: Generates MDX files with proper frontmatter and components
- ✅ **SDK-Focused Documentation**: Optimized for code/SDK documentation (not REST APIs)
- ✅ **Automatic Navigation Updates**: Updates Mintlify `docs.json` with hierarchical navigation
- ✅ **Clean Output**: Hides private, internal, and non-exported items by default
- ✅ **Flexible Navigation**: Multiple organization strategies (kind, module, file)
- ✅ **Component Transformations**: Uses appropriate Mintlify components for better UX

## Installation

```bash
bun add -D typedoc-plugin-mintlify
```

## Usage

### Basic Configuration

Add both plugins to your TypeDoc configuration:

```json
{
  "plugin": ["typedoc-plugin-markdown", "typedoc-plugin-mintlify"],
  "out": "./docs/api-reference"
}
```

### Advanced Configuration

```json
{
  "plugin": ["typedoc-plugin-markdown", "typedoc-plugin-mintlify"],
  "out": "./docs/api-reference",
  "name": "My SDK",
  
  // Mintlify-specific options
  "mintlifyDocsJsonPath": "/path/to/docs.json",
  "mintlifyTabName": "SDK Reference", 
  "mintlifyNavigation": ["kind"],
  "mintlifySidebarIcons": "all",
  "mintlifyFrontmatter": true,
  "mintlifyComponents": true
}
```

## Configuration Options

### Core Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mintlifyDocsJsonPath` | `string` | - | Path to Mintlify docs.json file for automatic navigation updates |
| `mintlifyTabName` | `string` | `"SDK Reference"` | Tab name in docs.json where pages are added |
| `mintlifyNavigation` | `string[]` | `["folder", "file"]` | Navigation organization strategy |
| `mintlifySidebarIcons` | `string` | `"kind"` | Controls which navigation levels show icons |
| `mintlifyIncludeFileExtensions` | `boolean` | `false` | Include file extensions (.ts, .js) in navigation items when using file-based grouping |

### Navigation Strategies

The `mintlifyNavigation` option accepts an array of strategies:

- **`"kind"`**: Group by TypeScript constructs (Classes, Interfaces, Functions, Types, Variables)
- **`"folder"`**: Group by source directory structure  
- **`"file"`**: Group by source file structure

**Common Strategy Combinations:**
- **`["kind"]`**: Kind-only organization (recommended for most SDKs)
- **`["folder"]`**: Folder-only organization (folder groups contain direct item links)
- **`["folder", "file"]`**: Folder hierarchy with file grouping (default)
- **`["folder", "kind"]`**: Folder boundaries with kind grouping within each folder
- **`["file"]`**: File-only organization (useful for flat packages)
- **`["file", "kind"]`**: File boundaries with kind grouping within each file

### Sidebar Icons

The `mintlifySidebarIcons` option controls which navigation levels display icons:

- **`"kind"`**: Show icons only for TypeScript constructs (classes, interfaces, etc.)
- **`"folder"`**: Show icons only for folder-level groups  
- **`"file"`**: Show icons only for file-based groups
- **`"all"`**: Show icons for all navigation levels
- **`"none"`**: Show no icons

### Component Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mintlifyFrontmatter` | `boolean` | `true` | Generate Mintlify-compatible frontmatter |
| `mintlifyComponents` | `boolean` | `true` | Transform markdown to use Mintlify components |
| `useExpandableForMembers` | `boolean` | `true` | Use Expandable components for class/interface members |
| `useAccordionForOverloads` | `boolean` | `true` | Use Accordion components for function overloads |
| `enhanceCodeBlocks` | `boolean` | `true` | Enhance code blocks with better TypeScript formatting |

## Built-in TypeDoc Presets

The plugin automatically applies these TypeDoc options for cleaner SDK documentation:

```json
{
  "excludePrivate": true,        // Hide private members
  "excludeInternal": true,       // Hide @internal items  
  "excludeExternals": true,      // Hide external dependencies
  "excludeProtected": false,     // Keep protected members (part of public API)
  "excludeReferences": false,    // Keep re-exports (useful in SDKs)
  "categorizeByGroup": false,    // Better organization
  "sort": ["source-order"]       // Preserve source order
}
```

## Generated Components

This plugin transforms TypeScript documentation to use appropriate Mintlify components:

- **Function signatures** → Code blocks with TypeScript syntax highlighting
- **Class/Interface members** → `Expandable` components for better organization  
- **Multiple overloads** → `Accordion` components for clean presentation
- **Code examples** → `CodeGroup` for multiple language examples
- **Important notes** → `Info`, `Tip`, or `Warning` components based on content

## Automatic docs.json Integration

When `mintlifyDocsJsonPath` is configured, the plugin automatically:

1. **Finds or creates** the specified tab (e.g., "SDK Reference")
2. **Removes placeholder content** (Introduction, API Endpoints sections)
3. **Generates hierarchical navigation** based on your chosen strategy
4. **Organizes pages** into logical groups with appropriate icons
5. **Updates navigation** with relative paths from docs.json location

### Example Generated Navigation

```json
{
  "tab": "SDK Reference", 
  "groups": [
    {
      "group": "MySDK Engine",
      "icon": "cog",
      "pages": [
        "api-reference/my-sdk/README",
        {
          "group": "Classes",
          "icon": "cube", 
          "pages": ["api-reference/my-sdk/classes/MyClass"]
        },
        {
          "group": "Interfaces", 
          "icon": "plug",
          "pages": ["api-reference/my-sdk/interfaces/MyInterface"]
        }
      ]
    }
  ]
}
```

## Example Workflow

1. **Install the plugin**:
   ```bash
   bun add -D typedoc-plugin-mintlify
   ```

2. **Configure TypeDoc**:
   ```json
   {
     "plugin": ["typedoc-plugin-markdown", "typedoc-plugin-mintlify"],
     "out": "./docs/api-reference/my-sdk",
     "mintlifyDocsJsonPath": "./docs.json",
     "mintlifyNavigation": ["kind"]
   }
   ```

3. **Run TypeDoc**:
   ```bash
   typedoc src/index.ts
   ```

4. **Result**: Clean MDX files + automatically updated docs.json navigation

## Requirements

- **TypeDoc** ≥ 0.24.0
- **typedoc-plugin-markdown** ≥ 4.8.1 (peer dependency)
- **Node.js** ≥ 16

## License

MIT