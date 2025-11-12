# Templates Module

**Liquid template system for generating MDX documentation**

## Overview

The templates module manages the template engine system for converting API documentation data into formatted MDX output. It uses LiquidJS as the template engine, supports template inheritance via layouts and blocks, handles template overrides, and provides a rich data model with semantic variable names for intuitive template authoring.

## Architecture

### Component Structure

```
Template System
├── TemplateEngine (Interface)
│   └── LiquidTemplateEngine (Implementation)
│
├── TemplateManager (Abstract)
│   └── LiquidTemplateManager (Liquid-specific)
│
├── TemplateDataConverter
│   └── Converts ApiItem → ITemplateData
│
└── TemplateMerger
    └── Merges user + default templates
```

### Key Concepts

**Template Variables (Refactored):**
- ✅ **Semantic naming**: `members`, `properties`, `methods` (not `tables.members`)
- ✅ **Intuitive structure**: Direct property access
- ✅ **Type-safe**: Defined in `ITemplateData` interface

**Template Inheritance:**
- ✅ **Layout system**: `{% layout "layout" %}` tag
- ✅ **Blocks**: `{% block content %} ... {% endblock %}`
- ✅ **Variable scope**: Child templates inherit parent scope automatically

**Template Discovery:**
- ✅ **Default templates**: Bundled with package (`src/templates/defaults/`)
- ✅ **User templates**: Optional custom templates
- ✅ **Template merging**: User templates override defaults in temp directory

## Files

### `TemplateEngine.ts` ⭐⭐⭐⭐⭐

Core template engine interface and data model.

**ITemplateData Interface** (Refactored Structure):

```typescript
export interface ITemplateData {
  // Core API item info
  apiItem: {
    name: string;
    kind: ApiItemKind;
    displayName: string;
    description: string;
    // ...
  };

  // Page metadata
  page: {
    title: string;
    description: string;
    icon?: string;
    breadcrumb: Array<{ name: string; path?: string }>;
  };

  // Semantic variables (REFACTORED from tables.*)
  constructors?: ITableRow[];        // Not tables.constructors
  properties?: ITableRow[];          // Not tables.properties
  methods?: ITableRow[];             // Not tables.methods
  events?: ITableRow[];              // Not tables.events
  parameters?: ITableRow[];          // Not tables.parameters
  returnType?: IReturnData;          // Singular, not array
  members?: ITableRow[];             // Enum members
  classes?: ITableRow[];             // Namespace classes
  interfaces?: ITableRow[];          // Namespace interfaces
  functions?: ITableRow[];           // Namespace functions
  // ... etc

  // Additional metadata
  examples?: string[];
  heritageTypes?: Array<{ name: string; path?: string }>;
}

interface ITableRow {
  title: string;
  titlePath?: string;
  modifiers?: string;
  type?: string;
  typePath?: string;
  defaultValue?: string;
  description?: string;
}
```

**Engine Interface:**

```typescript
interface ITemplateEngine {
  render(templateName: string, data: ITemplateData): Promise<string>;
}
```

---

### `LiquidTemplateEngine.ts` ⭐⭐⭐⭐⭐

LiquidJS template engine implementation.

**Key Features:**
- ✅ LiquidJS v10.24.0 integration
- ✅ Layout and block support (`{% layout %}`, `{% block %}`)
- ✅ Dynamic partials enabled (required for layouts)
- ✅ Template sanitization for security
- ✅ Post-processing (whitespace cleanup)

**Configuration:**

```typescript
new Liquid({
  root: templateDir,                // Template directory
  cache: cache,                     // Template caching
  extname: '.liquid',               // File extension
  strictVariables: false,           // Allow optional properties
  strictFilters: false,             // Lenient filter errors
  dynamicPartials: true,            // Required for layout tag
  globals: {}
});
```

**Important Notes:**

1. **Dynamic Partials Security:**
   - `dynamicPartials: true` is required for `{% layout %}` tag
   - Safe because template data comes from API Extractor (trusted)
   - Templates are either bundled defaults or user-provided (already trusted)

2. **Strict Variables:**
   - Disabled (`false`) to support optional properties
   - Templates can check `{% if property %}` without errors

3. **Rendering Method:**
   - Uses `renderFile()` (not `parseAndRender()`) for layout support

**Usage:**

```typescript
const engine = new LiquidTemplateEngine({
  templateDir: './templates',
  cache: cacheInstance,
  strict: false
});

const output = await engine.render('class', templateData);
```

---

### `TemplateDataConverter.ts` ⭐⭐⭐⭐⭐

Converts API Extractor model to template-friendly data structure.

**Responsibilities:**
- Convert `ApiItem` → `ITemplateData`
- Extract and organize API members
- Generate table rows for properties, methods, etc.
- Handle inheritance and type hierarchies
- Create breadcrumbs and metadata

**Key Methods:**

| Method | Purpose |
|--------|---------|
| `convertApiItem(apiItem)` | Main conversion entry point |
| `_addClassData()` | Add class-specific data |
| `_addInterfaceData()` | Add interface-specific data |
| `_addEnumData()` | Add enum-specific data |
| `_addFunctionData()` | Add function-specific data |
| `_createTableRows(apiItems)` | Convert items to table rows |
| `_createParameterRows(params)` | Convert parameters to rows |

**Refactored Structure:**

```typescript
// OLD (before refactoring):
data.tables = {
  members: this._createTableData(members),
  properties: this._createTableData(properties)
};

// NEW (after refactoring):
data.members = this._createTableRows(members);
data.properties = this._createTableRows(properties);
```

**Usage:**

```typescript
const converter = new TemplateDataConverter(
  apiModel,
  getLinkFilename
);

const templateData = converter.convertApiItem(apiClass);
// Returns ITemplateData with semantic properties
```

---

### `LiquidTemplateManager.ts` ⭐⭐⭐⭐⭐

Manages Liquid templates with override support and layout system.

**Key Features:**
- ✅ Template override system
- ✅ Fallback to default templates
- ✅ Layout/block inheritance support
- ✅ Template caching
- ✅ Error handling with fallbacks

**Template Resolution Priority:**

1. **Individual override**: `overrides/class.liquid`
2. **Standard merged**: `temp/class.liquid` (user + defaults)
3. **Default template**: `defaults/class.liquid`

**Critical Fix (Prototype Pollution):**

```typescript
// ❌ WRONG: Accesses inherited properties
if (this._overrides[templateName]) { ... }

// ✅ CORRECT: Only checks own properties
if (Object.prototype.hasOwnProperty.call(this._overrides, templateName)) { ... }
```

**Usage:**

```typescript
const manager = new LiquidTemplateManager({
  templateDir: './templates',
  overrideDir: './custom-templates',
  cache: cacheInstance
});

const output = await manager.render('class', templateData);
```

---

### `TemplateMerger.ts` ⭐⭐⭐⭐

Merges user templates with default templates in temporary directory.

**Process:**

1. Copy all default templates to temp directory
2. Copy user templates to temp directory (overwriting defaults)
3. Return temp directory path
4. Templates use `{% layout "layout" %}` for inheritance

**Why Merge?**

- User templates can extend default templates
- `{% layout "layout" %}` needs to find `layout.liquid`
- Merging ensures all templates are in one directory
- Temp directory is cleaned up automatically

**Usage:**

```typescript
const merger = new TemplateMerger();

const mergedDir = await merger.mergeTemplates(
  defaultTemplateDir,
  userTemplateDir
);

// Use merged directory for rendering
const engine = new LiquidTemplateEngine({ templateDir: mergedDir });
```

---

### `TemplateManager.ts` (Abstract)

Base template manager class (not used directly).

**Provides:**
- Abstract template management interface
- Common template resolution logic
- Error handling patterns

---

### `index.ts`

Barrel export file for the templates module.

## Usage for Contributors

### Template Authoring

**Create a Custom Template:**

```liquid
---
title: "{{ page.title }}"
description: "{{ page.description }}"
---

{% layout "layout" %}

{% block content %}
## {{ apiItem.displayName }}

{% if properties and properties.size > 0 %}
### Properties

{% for property in properties %}
#### {{ property.title }}

**Type:** `{{ property.type }}`

{{ property.description }}

{% endfor %}
{% endif %}
{% endblock %}
```

**Use Semantic Variables:**

```liquid
{# ✅ CORRECT: Direct semantic access #}
{% for method in methods %}
  {{ method.title }}
{% endfor %}

{# ❌ WRONG: Old tables structure (deprecated) #}
{% for method in tables.methods.rows %}
  {{ method.title }}
{% endfor %}
```

**Available Variables:**

```liquid
{{ apiItem.name }}           {# API item name #}
{{ apiItem.kind }}           {# "Class", "Interface", etc. #}
{{ apiItem.displayName }}    {# Display name #}
{{ page.title }}             {# Page title #}
{{ page.description }}       {# Page description #}

{# Semantic collections #}
{{ constructors }}           {# Array of constructor rows #}
{{ properties }}             {# Array of property rows #}
{{ methods }}                {# Array of method rows #}
{{ members }}                {# Array of enum members #}
{{ parameters }}             {# Array of parameter rows #}
{{ returnType }}             {# Return type object (singular) #}
{{ examples }}               {# Array of example strings #}
{{ heritageTypes }}          {# Inheritance info #}
```

### Template Layouts

**Base Layout (`layout.liquid`):**

```liquid
---
title: "{{ page.title }}"
description: "{{ page.description }}"
---

{% block breadcrumb %}
{# Breadcrumb navigation #}
{% endblock %}

# {{ apiItem.displayName }}

{% block warnings %}
{# Deprecation warnings #}
{% endblock %}

{% block content %}
{# Main content (filled by child templates) #}
{% endblock %}

{% block remarks %}
{# Additional remarks #}
{% endblock %}
```

**Child Template:**

```liquid
{% layout "layout" %}

{% block content %}
## My Custom Content

{{ apiItem.description }}
{% endblock %}
```

### Converting API Data to Template Data

```typescript
import { TemplateDataConverter } from '../templates';

const converter = new TemplateDataConverter(
  apiModel,
  (apiItem) => `${apiItem.displayName}.mdx`
);

// Convert API item
const templateData = converter.convertApiItem(apiClass);

// Use in template
const output = await templateEngine.render('class', templateData);
```

### Testing Templates

```typescript
import { LiquidTemplateEngine } from '../templates';

describe('Templates', () => {
  it('should render class template', async () => {
    const engine = new LiquidTemplateEngine({
      templateDir: './test-templates'
    });

    const data: ITemplateData = {
      apiItem: { name: 'MyClass', displayName: 'MyClass', kind: ApiItemKind.Class },
      page: { title: 'MyClass', description: 'Test class' },
      properties: [
        { title: 'prop1', type: 'string', description: 'A property' }
      ]
    };

    const output = await engine.render('class', data);

    expect(output).toContain('MyClass');
    expect(output).toContain('prop1');
  });
});
```

## Known Issues

### 🔴 Critical

**None identified** (prototype pollution issue was fixed)

### 🟡 Major

1. **Temp Directory Not Cleaned Up** (TemplateMerger.ts)
   - **Issue**: Merged templates remain in temp directory
   - **Impact**: Disk space leak over time
   - **Fix**: Add cleanup method:
   ```typescript
   class TemplateMerger {
     private _tempDirs: Set<string> = new Set();

     mergeTemplates(...): string {
       const tempDir = createTempDir();
       this._tempDirs.add(tempDir);
       // ... merge logic ...
       return tempDir;
     }

     cleanup(): void {
       for (const dir of this._tempDirs) {
         fs.rmSync(dir, { recursive: true });
       }
       this._tempDirs.clear();
     }
   }
   ```

2. **No Template Validation** (LiquidTemplateEngine.ts)
   - **Issue**: Invalid Liquid syntax not caught until render
   - **Impact**: Runtime errors during generation
   - **Enhancement**: Add template validation:
   ```typescript
   validateTemplate(templatePath: string): ValidationResult {
     try {
       this._liquid.parseFileSync(templatePath);
       return { valid: true };
     } catch (error) {
       return { valid: false, errors: [error.message] };
     }
   }
   ```

3. **Sanitization Overhead** (LiquidTemplateEngine.ts)
   - **Issue**: Sanitizes all template data even though it's from trusted API Extractor
   - **Impact**: Performance overhead
   - **Optimization**: Skip sanitization for known-safe data:
   ```typescript
   if (options.trustData) {
     return sanitizedData;  // Skip sanitization
   }
   ```

### 🟢 Minor

4. **Hardcoded Cache Size** (LiquidTemplateManager.ts)
   - **Issue**: Template cache size not configurable
   - **Enhancement**: Add cache size option
   - **Impact**: Minor - default size likely sufficient

5. **No Template Hot Reload** (LiquidTemplateEngine.ts)
   - **Issue**: Changes to templates require restart
   - **Enhancement**: Add file watching for development
   - **Use Case**: Faster template iteration during development

6. **Limited Error Messages** (LiquidTemplateManager.ts)
   - **Issue**: Template rendering errors don't show which variable failed
   - **Enhancement**: Add context to error messages:
   ```typescript
   throw new TemplateError(
     `Failed to render property "${property.name}" in template "${templateName}"`,
     { cause: error, template: templateName, context: { property } }
   );
   ```

7. **No Template Linting**
   - **Enhancement**: Add template linter to catch common mistakes:
     - Undefined variables
     - Deprecated syntax
     - Performance anti-patterns

## Performance Characteristics

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Template compilation | O(n) | n = template size, cached |
| Template rendering | O(n + m) | n = template size, m = data size |
| Template merging | O(f) | f = number of template files |
| Data conversion | O(i) | i = number of API items |

**Caching:**
- Templates are compiled once and cached
- Cache persists across renders
- LRU eviction when cache is full

**Memory:**
- Template cache: ~100KB for 50 templates
- Temp directory: ~500KB for merged templates

## Dependencies

### External Dependencies
- `liquidjs` (v10.24.0) - Template engine

### Internal Dependencies
- `../cache/` - Template caching (CacheManager)
- `../utils/IndentedWriter` - Not directly used but related
- `../nodes/` - Custom node types in template data
- `@microsoft/api-extractor-model` - API item types

## Related Modules

- **`documenters/`** - Primary consumer of template system
- **`markdown/`** - Markdown emitter for complex content
- **`navigation/`** - Generates navigation metadata for templates
- **`cli/InitTemplatesAction`** - Copies templates for users

## References

- [LiquidJS Documentation](https://liquidjs.com/)
- [Liquid Template Language](https://shopify.github.io/liquid/)
- [LiquidJS Layout Tag](https://liquidjs.com/tags/layout.html)
- [Mintlify Frontmatter](https://mintlify.com/docs/content/page)

---

## Quick Reference

### Template Structure

```liquid
---
title: "{{ page.title }}"
description: "{{ page.description }}"
---

{% layout "layout" %}

{% block content %}
# {{ apiItem.displayName }}

{% if properties %}
## Properties
{% for prop in properties %}
- **{{ prop.title }}**: {{ prop.type }}
{% endfor %}
{% endif %}
{% endblock %}
```

### Available Template Data

```typescript
{
  apiItem: { name, kind, displayName, description },
  page: { title, description, icon, breadcrumb },

  // Semantic variables (direct access)
  constructors: [...],
  properties: [...],
  methods: [...],
  events: [...],
  parameters: [...],
  returnType: { type, description },
  members: [...],      // Enum members
  classes: [...],      // Namespace classes
  interfaces: [...],   // Namespace interfaces
  functions: [...],    // Namespace functions

  examples: [...],
  heritageTypes: [{ name, path }]
}
```

### Common Patterns

**Conditional Content:**
```liquid
{% if properties and properties.size > 0 %}
  {# Render properties #}
{% endif %}
```

**Iteration:**
```liquid
{% for method in methods %}
  {{ method.title }}({{ method.parameters }})
{% endfor %}
```

**Links:**
```liquid
{% if property.titlePath %}
  [{{ property.title }}]({{ property.titlePath }})
{% else %}
  {{ property.title }}
{% endif %}
```
