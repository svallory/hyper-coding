# Navigation Module

**Mintlify navigation structure generation and docs.json management**

## Overview

The navigation module manages the generation of navigation structures for Mintlify documentation sites. It handles docs.json updates, hierarchical organization of API documentation, and automatic categorization of API items by type (classes, interfaces, functions, etc.).

## Architecture

### Component Structure

```
NavigationManager
├── Navigation Item Management
│   ├── Add items
│   ├── Prevent duplicates
│   └── Track API kinds
├── Hierarchy Generation
│   ├── Categorize by API kind
│   ├── Group and sort
│   └── Apply icons
└── docs.json Updates
    ├── Read existing file
    ├── Merge navigation
    └── Write updated JSON
```

### Design Patterns

- **Builder Pattern**: Accumulate navigation items, then generate structure
- **Strategy Pattern**: Different update strategies for simple vs tab structures
- **Configuration Object**: Options for customizing navigation behavior

## Files

### `NavigationManager.ts`

Core navigation management class that handles docs.json structure and API categorization.

**Responsibilities:**
- Accumulate navigation items during documentation generation
- Categorize API items by kind (Class, Interface, Function, etc.)
- Generate hierarchical navigation structure
- Update docs.json with proper merging logic
- Support both simple and tab-based navigation structures

**Key Features:**

#### 1. Navigation Item Management

```typescript
const navManager = new NavigationManager({
  docsJsonPath: './docs/docs.json',
  tabName: 'API Reference',
  groupName: 'Core API',
  enableMenu: true,
  outputFolder: './docs/api'
});

// Add individual items
navManager.addNavigationItem({
  page: 'api/MyClass.mdx',
  apiKind: ApiItemKind.Class
});

// Add API items automatically
navManager.addApiItem(apiItem, 'MyClass.mdx');
```

#### 2. Hierarchical Structure Generation

Automatically organizes API items into categories:

```typescript
// Generates structure like:
{
  group: "Core API",
  icon: "code",
  pages: [
    {
      group: "Classes",
      icon: "box",
      pages: ["api/User.mdx", "api/Product.mdx"]
    },
    {
      group: "Interfaces",
      icon: "plug",
      pages: ["api/IUser.mdx", "api/IProduct.mdx"]
    },
    {
      group: "Functions",
      icon: "function",
      pages: ["api/createUser.mdx", "api/deleteUser.mdx"]
    }
  ]
}
```

#### 3. docs.json Structure Support

**Mintlify V4 (Tab Structure):**
```json
{
  "navigation": {
    "tabs": [
      {
        "tab": "API Reference",
        "groups": [
          {
            "group": "Core API",
            "icon": "code",
            "pages": [ ... ]
          }
        ]
      }
    ]
  }
}
```

**Simple Structure:**
```json
{
  "navigation": [
    {
      "group": "Core API",
      "icon": "code",
      "pages": [ ... ]
    }
  ]
}
```

#### 4. Category Icons

Default icon mapping for API kinds:

| API Kind | Display Name | Icon |
|----------|--------------|------|
| Class | Classes | `box` |
| Interface | Interfaces | `plug` |
| Function | Functions | `function` |
| TypeAlias | Types | `file-code` |
| Variable | Variables | `variable` |
| Enum | Enums | `list` |
| Namespace | Namespaces | `folder` |

**Usage Example:**

```typescript
import { NavigationManager } from './navigation';
import { ApiModel, ApiItemKind } from '@microsoft/api-extractor-model';

// Create navigation manager
const navManager = new NavigationManager({
  docsJsonPath: './docs/docs.json',
  tabName: 'API Reference',
  groupName: 'Core API',
  enableMenu: true,
  outputFolder: './docs/api'
});

// During documentation generation
for (const apiItem of apiModel.members) {
  if (apiItem.kind === ApiItemKind.Class) {
    const filename = `${apiItem.displayName}.mdx`;
    navManager.addApiItem(apiItem, filename);
  }
}

// Generate and write navigation
await navManager.generateNavigation();

// Get statistics
const stats = navManager.getStats();
console.log(`Added ${stats.totalItems} navigation items`);
```

**API Methods:**

| Method | Description |
|--------|-------------|
| `addNavigationItem(item)` | Add a navigation item manually |
| `addApiItem(apiItem, filename)` | Add API item with auto-categorization |
| `generateNavigation()` | Write navigation to docs.json |
| `generateHierarchicalNavigation()` | Get hierarchical structure |
| `getStats()` | Get navigation statistics |
| `clear()` | Clear all navigation items |

**Code Quality:** ⭐⭐⭐⭐ (see issues below)

---

### `index.ts`

Barrel export file for the navigation module.

**Exports:**
- `NavigationManager` - Main navigation manager class
- `NavigationItem` - Type for navigation items
- `NavigationManagerOptions` - Configuration options type

## Usage for Contributors

### Basic Navigation Generation

```typescript
import { NavigationManager } from '../navigation';

const navManager = new NavigationManager({
  docsJsonPath: './docs/docs.json',
  tabName: 'API',
  groupName: 'Core',
  enableMenu: true
});

// Add items
navManager.addNavigationItem({
  page: 'api/overview.mdx'
});

// Generate docs.json
await navManager.generateNavigation();
```

### Automatic API Categorization

```typescript
import { ApiModel } from '@microsoft/api-extractor-model';

const apiModel = new ApiModel();
apiModel.loadPackage('./my-package.api.json');

const navManager = new NavigationManager({
  docsJsonPath: './docs/docs.json',
  outputFolder: './docs/api'
});

// Automatically categorize all API items
for (const member of apiModel.members[0].members) {
  if (navManager.isTopLevelItem(member)) {
    navManager.addApiItem(member, `${member.displayName}.mdx`);
  }
}

await navManager.generateNavigation();
```

### Custom Navigation Structure

```typescript
// Disable automatic categorization
const navManager = new NavigationManager({
  docsJsonPath: './docs/docs.json',
  groupName: ''  // Empty group name = flat navigation
});

// Add items in custom order
navManager.addNavigationItem({ page: 'intro.mdx' });
navManager.addNavigationItem({ page: 'getting-started.mdx' });
navManager.addNavigationItem({ page: 'api/classes.mdx' });

// Generates flat array instead of hierarchical structure
await navManager.generateNavigation();
```

### Merging with Existing Navigation

```typescript
// NavigationManager automatically merges with existing docs.json
const navManager = new NavigationManager({
  docsJsonPath: './docs/docs.json',
  groupName: 'Core API'
});

// Add items for Core API
navManager.addApiItem(coreApiItem, 'core.mdx');

// Generates navigation - preserves other groups in docs.json
await navManager.generateNavigation();
```

### Path Resolution

```typescript
const navManager = new NavigationManager({
  docsJsonPath: '../docs/docs.json',  // Parent directory OK (monorepo)
  outputFolder: '../docs/api'          // Parent directory OK
});

// Paths are automatically resolved relative to current working directory
// and normalized for cross-platform compatibility
```

### Statistics and Debugging

```typescript
const navManager = new NavigationManager({ ... });

// Add items...
navManager.addApiItem(item1, 'file1.mdx');
navManager.addApiItem(item2, 'file2.mdx');

// Get statistics
const stats = navManager.getStats();
console.log(`Total items: ${stats.totalItems}`);
console.log(`Tab name: ${stats.tabName}`);
console.log(`Group name: ${stats.groupName}`);
console.log(`Hierarchical: ${stats.hasHierarchical}`);
console.log(`docs.json path: ${stats.docsJsonPath}`);

// Clear for reuse
navManager.clear();
```

### Custom Icon Mapping

Currently icons are hardcoded. To customize:

```typescript
// Option 1: Modify CATEGORY_INFO constant (requires code change)
private static readonly CATEGORY_INFO = {
  [ApiItemKind.Class]: { displayName: 'Classes', icon: 'cube' },  // Custom icon
  // ...
};

// Option 2: Post-process generated navigation
const hierarchy = navManager.generateHierarchicalNavigation();
for (const group of hierarchy[0].pages) {
  if (group.group === 'Classes') {
    group.icon = 'cube';  // Override icon
  }
}
```

### Testing Navigation Generation

```typescript
import { NavigationManager } from '../navigation';
import { ApiItemKind } from '@microsoft/api-extractor-model';
import * as fs from 'fs';

describe('NavigationManager', () => {
  it('should categorize API items correctly', () => {
    const navManager = new NavigationManager({
      groupName: 'Test API'
    });

    navManager.addNavigationItem({
      page: 'class1.mdx',
      apiKind: ApiItemKind.Class
    });

    navManager.addNavigationItem({
      page: 'interface1.mdx',
      apiKind: ApiItemKind.Interface
    });

    const hierarchy = navManager.generateHierarchicalNavigation();

    expect(hierarchy[0].group).toBe('Test API');
    expect(hierarchy[0].pages).toHaveLength(2);

    const classGroup = hierarchy[0].pages.find(g => g.group === 'Classes');
    expect(classGroup.pages).toContain('class1.mdx');
  });

  it('should merge with existing docs.json', async () => {
    const tempPath = './temp-docs.json';

    // Create existing docs.json
    fs.writeFileSync(tempPath, JSON.stringify({
      navigation: [
        { group: 'Existing Group', pages: ['existing.mdx'] }
      ]
    }));

    const navManager = new NavigationManager({
      docsJsonPath: tempPath,
      groupName: 'New Group'
    });

    navManager.addNavigationItem({ page: 'new.mdx' });
    await navManager.generateNavigation();

    const result = JSON.parse(fs.readFileSync(tempPath, 'utf-8'));

    expect(result.navigation).toHaveLength(2);
    expect(result.navigation[0].group).toBe('Existing Group');
    expect(result.navigation[1].group).toBe('New Group');

    fs.unlinkSync(tempPath);
  });
});
```

## Known Issues

### 🔴 Critical

**None identified**

### 🟡 Major

1. **No docs.json Schema Validation** (NavigationManager.ts:151-154)
   - **Issue**: Only validates JSON syntax, not Mintlify schema compliance
   - **Impact**: Could generate invalid docs.json structure
   - **Fix**: Add schema validation:
   ```typescript
   import Ajv from 'ajv';
   const ajv = new Ajv();
   const schema = require('../schemas/mintlify-docs.schema.json');

   if (!ajv.validate(schema, docsJson)) {
     throw new ValidationError('Invalid docs.json structure', {
       data: { errors: ajv.errors }
     });
   }
   ```

2. **No Backup Before Overwrite** (NavigationManager.ts:181)
   - **Issue**: Overwrites docs.json without creating backup
   - **Impact**: Data loss if generation fails or produces bad output
   - **Fix**: Create backup before writing:
   ```typescript
   if (FileSystem.exists(validatedDocsJsonPath)) {
     const backupPath = `${validatedDocsJsonPath}.backup`;
     FileSystem.copyFile(validatedDocsJsonPath, backupPath);
   }

   try {
     FileSystem.writeFile(validatedDocsJsonPath, jsonString);
     // Success - delete backup
     FileSystem.deleteFile(backupPath);
   } catch (error) {
     // Restore from backup
     FileSystem.copyFile(backupPath, validatedDocsJsonPath);
     throw error;
   }
   ```

3. **Silent Error Handling** (NavigationManager.ts:155-158)
   - **Issue**: Catches all read errors silently, provides no feedback
   - **Impact**: Could hide permission issues, corruption, etc.
   - **Fix**: Log specific errors:
   ```typescript
   } catch (error) {
     if (FileSystem.exists(validatedDocsJsonPath)) {
       console.warn(`⚠️ Could not read existing docs.json: ${error.message}`);
       console.log('   Starting with empty docs.json structure...');
     } else {
       console.log('   Creating new docs.json file...');
     }
   }
   ```

4. **Hardcoded Max Size** (NavigationManager.ts:165)
   - **Issue**: Magic number 10MB for max JSON size
   - **Impact**: Arbitrary limit might be too small or too large
   - **Fix**: Make configurable:
   ```typescript
   interface NavigationManagerOptions {
     maxDocsJsonSize?: number;  // Add option (default 10MB)
   }
   ```

### 🟢 Minor

5. **Limited Path Normalization** (NavigationManager.ts:112)
   - **Issue**: Only normalizes backslashes, not other edge cases
   - **Impact**: Could have issues on non-Windows platforms
   - **Fix**: Use path.posix for consistent forward slashes:
   ```typescript
   const normalizedPath = relativePath.split(path.sep).join(path.posix.sep);
   ```

6. **Type Safety Issue** (NavigationManager.ts:243)
   - **Issue**: Using `any` type for docsJson parameter
   - **Impact**: No type checking for docs.json structure
   - **Fix**: Define interface:
   ```typescript
   interface DocsJsonStructure {
     navigation?: NavigationItem[] | { tabs: Array<{ tab: string; groups: any[] }> };
   }

   private _updateDocsJsonNavigation(docsJson: DocsJsonStructure): void
   ```

7. **No Icon Customization** (NavigationManager.ts:67-75)
   - **Issue**: Icon mapping is hardcoded static property
   - **Impact**: Cannot customize icons without modifying source
   - **Enhancement**: Make icons configurable:
   ```typescript
   interface NavigationManagerOptions {
     customIcons?: Record<ApiItemKind, { displayName: string; icon: string }>;
   }
   ```

8. **No Duplicate Validation** (NavigationManager.ts:90-92)
   - **Issue**: Only checks page + group, not other scenarios
   - **Impact**: Could have duplicate entries with different apiKind
   - **Enhancement**: More thorough duplicate detection:
   ```typescript
   const exists = this._navigationItems.some(existing =>
     existing.page === item.page &&
     existing.group === item.group &&
     existing.apiKind === item.apiKind
   );
   ```

9. **Map Iteration Order Assumption** (NavigationManager.ts:353-366)
   - **Issue**: Creates Map, then sorts afterwards (inefficient)
   - **Impact**: Minor performance overhead
   - **Optimization**: Use sorted insertion or skip Map:
   ```typescript
   const groups: Array<{ displayName: string; pages: string[] }> = [];
   // ... build array directly, keep sorted
   ```

## Performance Characteristics

### Time Complexity

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| addNavigationItem | O(n) | Duplicate check scans all items |
| addApiItem | O(n) | Calls addNavigationItem |
| generateHierarchicalNavigation | O(n log n) | Sorting pages and groups |
| generateNavigation | O(n log n + f) | n = items, f = file I/O |

### Memory Usage

- **Navigation items**: O(n) where n = number of API items
- **docs.json**: O(m) where m = total documentation size
- **Temporary maps**: O(k) where k = number of categories

### Optimization Opportunities

1. **Use Set for Duplicate Detection**: O(1) lookup instead of O(n)
2. **Stream docs.json Writing**: For very large files
3. **Cache Category Lookups**: Avoid repeated CATEGORY_INFO searches
4. **Batch addNavigationItem**: Add multiple items at once

## Dependencies

### External Dependencies
- `@rushstack/node-core-library` - FileSystem utilities
- `@microsoft/api-extractor-model` - ApiItemKind enum

### Internal Dependencies
- `../utils/SecurityUtils` - JSON validation
- `../errors/DocumentationError` - Error handling

## Related Modules

- **`documenters/MarkdownDocumenter`** - Primary consumer of NavigationManager
- **`cli/MarkdownAction`** - Configures navigation options
- **`schemas/`** - Could provide docs.json schema validation

## References

- [Mintlify Navigation Documentation](https://mintlify.com/docs/navigation)
- [Mintlify docs.json Schema](https://mintlify.com/docs/docs-json)
- [Lucide Icons](https://lucide.dev/) - Icon set used by Mintlify

---

## Quick Reference

### Creating Navigation Manager

```typescript
const navManager = new NavigationManager({
  docsJsonPath: './docs/docs.json',
  tabName: 'API Reference',
  groupName: 'Core API',
  enableMenu: true,
  outputFolder: './docs/api'
});
```

### Adding Items

```typescript
// Manual
navManager.addNavigationItem({
  page: 'api/MyClass.mdx',
  apiKind: ApiItemKind.Class
});

// Automatic
navManager.addApiItem(apiItem, 'MyClass.mdx');
```

### Generating Navigation

```typescript
// Generate hierarchical structure
const hierarchy = navManager.generateHierarchicalNavigation();

// Write to docs.json
await navManager.generateNavigation();

// Get statistics
const stats = navManager.getStats();
console.log(`Total items: ${stats.totalItems}`);
```

### Supported API Kinds

Top-level items automatically included:
- `ApiItemKind.Class`
- `ApiItemKind.Interface`
- `ApiItemKind.Enum`
- `ApiItemKind.Namespace`
- `ApiItemKind.Function`
- `ApiItemKind.TypeAlias`
- `ApiItemKind.Variable`

### Icon Mapping

| Kind | Group Name | Icon |
|------|------------|------|
| Class | Classes | `box` |
| Interface | Interfaces | `plug` |
| Function | Functions | `function` |
| TypeAlias | Types | `file-code` |
| Variable | Variables | `variable` |
| Enum | Enums | `list` |
| Namespace | Namespaces | `folder` |
