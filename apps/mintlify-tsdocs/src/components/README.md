# Components Module

**React components for interactive documentation features**

## Overview

The components module provides React components that are distributed with mintlify-tsdocs and automatically installed into users' `docs/snippets/` directories. These components enhance Mintlify documentation with interactive, client-side features that static markdown cannot provide.

## Architecture

### Distribution Strategy

Components follow a **Copy Distribution** pattern:
1. Components are bundled with the package (`src/components/`)
2. During documentation generation, they're copied to `docs/snippets/tsdocs/`
3. Mintlify loads them from the snippets directory
4. Components run client-side in the documentation site

**Why snippets/tsdocs/?**
- Mintlify requires components in the `docs/snippets/` folder per their [component documentation](https://mintlify.com/docs/customize/react-components)
- We use a `tsdocs/` subfolder to avoid conflicts with the user's own components
- Components cannot be imported directly from npm packages

### Technology Stack

- **React 18+** - Component framework
- **Tailwind CSS** - Styling (Mintlify default)
- **Dark Mode** - Built-in via Tailwind dark: classes

## Files

### `TypeTree.jsx`

Recursive, expandable component for documenting complex type structures.

**Purpose:**
Display nested object types, API parameters, return values, or any hierarchical data structure with expand/collapse functionality.

**Key Features:**
- ✅ Recursive rendering for unlimited nesting
- ✅ Auto-expands first 2 levels for better UX
- ✅ Visual badges: required, optional, deprecated
- ✅ Dark mode support
- ✅ Default value display
- ✅ Smooth animations (chevron rotation)

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `name` | `string` | required | Property/field name |
| `type` | `string` | required | Type annotation (e.g., "string", "object") |
| `description` | `string` | optional | Human-readable description |
| `required` | `boolean` | `false` | Whether field is required |
| `deprecated` | `boolean` | `false` | Whether field is deprecated |
| `properties` | `Array<Object>` | `[]` | Nested properties (recursive) |
| `defaultValue` | `string` | optional | Default value if any |
| `level` | `number` | `0` | Nesting level (internal use) |

**Usage Example:**

```jsx
<TypeTree
  name="config"
  type="object"
  description="Database configuration settings"
  required={true}
  properties={[
    {
      name: "host",
      type: "string",
      description: "Database host address",
      required: true
    },
    {
      name: "port",
      type: "number",
      description: "Database port",
      defaultValue: "5432"
    },
    {
      name: "ssl",
      type: "object",
      description: "SSL configuration",
      properties: [
        { name: "enabled", type: "boolean", required: true },
        { name: "cert", type: "string", description: "Certificate path" }
      ]
    }
  ]}
/>
```

**In MDX:**

```mdx
---
title: "API Configuration"
---

import { TypeTree } from '/snippets/tsdocs/TypeTree.jsx';

## Configuration Object

<TypeTree
  name="config"
  type="object"
  required={true}
  properties={[
    { name: "apiKey", type: "string", required: true },
    { name: "timeout", type: "number", defaultValue: "30000" }
  ]}
/>
```

**Rendered Output:**

```
📦 config: object [required]
  └─ Database configuration settings
  Default: { host: "localhost", port: 5432 }

  ▾ Properties:
    📄 host: string [required]
      └─ Database host address

    📄 port: number [optional]
      └─ Database port
      Default: 5432

    📦 ssl: object [optional]
      └─ SSL configuration

      ▸ Properties: (collapsed)
```

---

### `TypeTreeGroup.jsx`

Wrapper component for grouping multiple `TypeTree` components.

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | optional | Group heading |
| `children` | `ReactNode` | required | TypeTree components |

**Usage Example:**

```jsx
<TypeTreeGroup title="Function Parameters">
  <TypeTree name="id" type="string" required />
  <TypeTree name="options" type="object" properties={...} />
</TypeTreeGroup>
```

## Usage for Contributors

### Adding a New Component

To add a new React component:

1. **Create component file:**

```jsx
// src/components/CodeTabs.jsx
import React, { useState } from 'react';

/**
 * CodeTabs - Tabbed code examples
 *
 * @param {Object} props
 * @param {Array<{label: string, code: string, language: string}>} props.tabs
 */
export const CodeTabs = ({ tabs }) => {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="code-tabs">
      {/* Tab buttons */}
      <div className="flex gap-2 mb-2">
        {tabs.map((tab, idx) => (
          <button
            key={idx}
            onClick={() => setActiveTab(idx)}
            className={`px-3 py-1 rounded ${
              activeTab === idx
                ? 'bg-primary-500 text-white'
                : 'bg-gray-200 dark:bg-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Code content */}
      <pre className="language-{tabs[activeTab].language}">
        <code>{tabs[activeTab].code}</code>
      </pre>
    </div>
  );
};

export default CodeTabs;
```

2. **Add to component copy logic:**

```typescript
// src/documenters/MarkdownDocumenter.ts
private async _installMintlifyComponents(outputFolder: string): Promise<void> {
  const componentsToCopy = [
    'TypeTree.jsx',
    'CodeTabs.jsx'  // Add here
  ];

  // ... copy logic ...
}
```

3. **Update package.json:**

Ensure `src/components/` is included in the `files` array and build script.

4. **Document the component:**

Add usage examples to this README and create a documentation page.

### Component Design Guidelines

**1. Use Tailwind CSS**
```jsx
// ✅ Good: Tailwind classes
<div className="border-l-2 border-gray-200 dark:border-gray-700 pl-4">

// ❌ Avoid: Inline styles (unless necessary)
<div style={{ borderLeft: '2px solid gray', paddingLeft: '16px' }}>
```

**2. Support Dark Mode**
```jsx
// ✅ Good: Dark mode classes
<span className="text-gray-700 dark:text-gray-300">

// ❌ Avoid: Light mode only
<span className="text-gray-700">
```

**3. Make it Accessible**
```jsx
// ✅ Good: ARIA labels
<button
  onClick={toggle}
  aria-label={isOpen ? 'Collapse' : 'Expand'}
  aria-expanded={isOpen}
>

// ❌ Avoid: No accessibility
<button onClick={toggle}>
```

**4. Keep it Simple**
- Minimal state management
- No external dependencies (except React)
- Self-contained styling
- Clear prop types

**5. Document with JSDoc**
```jsx
/**
 * MyComponent - Brief description
 *
 * @param {Object} props - Component props
 * @param {string} props.title - The title text
 * @param {boolean} [props.active=false] - Whether active
 *
 * @example
 * <MyComponent title="Hello" active />
 */
export const MyComponent = ({ title, active = false }) => {
  // ...
};
```

### Testing Components

**Unit Testing:**

```jsx
// tests/components/TypeTree.test.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { TypeTree } from '../../src/components/TypeTree';

describe('TypeTree', () => {
  it('should render basic property', () => {
    render(
      <TypeTree
        name="username"
        type="string"
        description="User's name"
      />
    );

    expect(screen.getByText('username')).toBeInTheDocument();
    expect(screen.getByText('string')).toBeInTheDocument();
    expect(screen.getByText("User's name")).toBeInTheDocument();
  });

  it('should expand/collapse nested properties', () => {
    render(
      <TypeTree
        name="config"
        type="object"
        properties={[
          { name: "host", type: "string" }
        ]}
      />
    );

    const expandButton = screen.getByLabelText('Collapse'); // Auto-expanded
    fireEvent.click(expandButton);

    expect(screen.queryByText('host')).not.toBeInTheDocument();
  });

  it('should show required badge', () => {
    render(<TypeTree name="id" type="string" required />);
    expect(screen.getByText('required')).toBeInTheDocument();
  });

  it('should show deprecated badge', () => {
    render(<TypeTree name="oldField" type="string" deprecated />);
    expect(screen.getByText('deprecated')).toBeInTheDocument();
  });
});
```

**Visual Testing:**

Create a Storybook story or standalone preview page:

```jsx
// src/components/TypeTree.stories.jsx
export const SimpleProperty = {
  args: {
    name: "username",
    type: "string",
    required: true
  }
};

export const NestedObject = {
  args: {
    name: "config",
    type: "object",
    properties: [
      { name: "host", type: "string", required: true },
      { name: "port", type: "number", defaultValue: "5432" }
    ]
  }
};
```

### Styling Best Practices

**Color Palette:**
```jsx
// Text
text-gray-900 dark:text-gray-100  // Primary text
text-gray-700 dark:text-gray-300  // Secondary text
text-gray-600 dark:text-gray-400  // Tertiary text

// Backgrounds
bg-gray-100 dark:bg-gray-800      // Subtle backgrounds
bg-gray-200 dark:bg-gray-700      // Borders/dividers

// Semantic colors
text-red-700 dark:text-red-400    // Required/Error
text-orange-700 dark:text-orange-400  // Deprecated/Warning
text-green-700 dark:text-green-400    // Success
```

**Spacing:**
```jsx
// Use Tailwind's spacing scale
gap-2    // 0.5rem (8px)
gap-3    // 0.75rem (12px)
gap-4    // 1rem (16px)

pl-4     // padding-left: 1rem
my-2     // margin-y: 0.5rem
```

**Responsive Design:**
```jsx
// Mobile-first approach
<div className="flex flex-col md:flex-row gap-2">
  // Stacks on mobile, row on desktop
</div>
```

## Known Issues

### 🔴 Critical

**None identified**

### 🟡 Major

1. **No PropTypes Validation** (TypeTree.jsx)
   - **Issue**: No runtime prop validation
   - **Impact**: Silent failures or crashes with invalid props
   - **Fix**: Add PropTypes or TypeScript
   ```jsx
   import PropTypes from 'prop-types';

   TypeTree.propTypes = {
     name: PropTypes.string.isRequired,
     type: PropTypes.string.isRequired,
     description: PropTypes.string,
     required: PropTypes.bool,
     deprecated: PropTypes.bool,
     properties: PropTypes.arrayOf(PropTypes.object),
     defaultValue: PropTypes.any,
     level: PropTypes.number
   };
   ```

2. **Using Array Index as Key** (TypeTree.jsx:144)
   - **Issue**: `key={idx}` anti-pattern
   - **Impact**: React reconciliation issues when properties reorder
   - **Fix**: Use unique identifier
   ```jsx
   // ❌ Bad
   {properties.map((prop, idx) => <TypeTree key={idx} {...prop} />)}

   // ✅ Good
   {properties.map((prop) => <TypeTree key={`${prop.name}-${level}`} {...prop} />)}
   ```

3. **No Error Boundary** (TypeTree.jsx)
   - **Issue**: Component errors crash entire page
   - **Impact**: Poor user experience
   - **Fix**: Wrap in error boundary or add fallback
   ```jsx
   class TypeTreeErrorBoundary extends React.Component {
     state = { hasError: false };

     static getDerivedStateFromError(error) {
       return { hasError: true };
     }

     render() {
       if (this.state.hasError) {
         return <div className="text-red-600">Failed to render type tree</div>;
       }
       return this.props.children;
     }
   }
   ```

4. **No Tests** (Missing test file)
   - **Issue**: No test coverage for component
   - **Impact**: Regression risk
   - **Fix**: Create `tests/components/TypeTree.test.jsx`

### 🟢 Minor

5. **Mixed Styling Approach** (TypeTree.jsx:65)
   - **Issue**: Inline style mixed with Tailwind classes
   - **Impact**: Inconsistent styling approach
   - **Fix**: Use Tailwind utility or CSS variable
   ```jsx
   // ❌ Current
   style={{ marginLeft: level > 0 ? '0' : undefined }}

   // ✅ Better
   className={level > 0 ? 'ml-0' : ''}
   ```

6. **No Memoization** (TypeTree.jsx)
   - **Issue**: Component re-renders on every parent update
   - **Impact**: Performance with large type trees
   - **Fix**: Wrap with React.memo
   ```jsx
   export const TypeTree = React.memo(({ name, type, ... }) => {
     // Component implementation
   });
   ```

7. **Limited Accessibility** (TypeTree.jsx)
   - **Issue**: Only expand button has ARIA label
   - **Impact**: Screen readers may struggle with complex trees
   - **Fix**: Add ARIA attributes
   ```jsx
   <div
     role="tree"
     aria-label={`Type definition for ${name}`}
   >
     <div role="treeitem" aria-expanded={isOpen}>
       {/* Content */}
     </div>
   </div>
   ```

8. **No Loading State** (TypeTree.jsx)
   - **Issue**: No indication when properties are being loaded dynamically
   - **Impact**: User confusion with async data
   - **Mitigation**: Document that component expects fully-loaded data

## Performance Characteristics

### Render Performance

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Initial render | O(n) | n = total nodes in tree |
| Expand/collapse | O(1) | Only toggles state |
| Re-render | O(n) | No memoization |

### Memory Usage

- **Per node**: ~500 bytes (React fiber + DOM)
- **10-level tree**: ~5KB
- **100-node tree**: ~50KB

### Optimization Opportunities

1. **React.memo**: Prevent unnecessary re-renders
2. **useMemo for properties**: Cache processed props
3. **Virtualization**: For very large trees (1000+ nodes)
4. **Lazy loading**: Load nested properties on expand

## Dependencies

### External Dependencies
- `react` (v18+) - Component framework
- `react-dom` (v18+) - DOM rendering

### Peer Dependencies
- **Tailwind CSS** - Styling framework (provided by Mintlify)
- **Mintlify** - Documentation platform

### No Build Dependencies
Components are distributed as JSX source files, built by user's Mintlify setup.

## Related Modules

- **`documenters/MarkdownDocumenter`** - Copies components to docs/snippets
- **`templates/`** - May reference components in generated MDX

## References

- [Mintlify Custom Components](https://mintlify.com/docs/customize/react-components)
- [Mintlify Reusable Snippets](https://mintlify.com/docs/create/reusable-snippets)
- [React Component Best Practices](https://react.dev/learn/thinking-in-react)
- [Tailwind CSS Dark Mode](https://tailwindcss.com/docs/dark-mode)

---

## Quick Reference

### Using TypeTree in MDX

```mdx
---
title: "API Documentation"
---

import { TypeTree } from '/snippets/tsdocs/TypeTree.jsx';

## Request Body

<TypeTree
  name="body"
  type="object"
  required={true}
  properties={[
    { name: "userId", type: "string", required: true },
    { name: "metadata", type: "object", properties: [...] }
  ]}
/>
```

### Component Props Checklist

When creating a new component:

- ✅ JSDoc comments with `@param` and `@example`
- ✅ PropTypes or TypeScript definitions
- ✅ Default prop values
- ✅ Dark mode support (`dark:` classes)
- ✅ Accessibility (ARIA labels, keyboard navigation)
- ✅ Responsive design (mobile-first)
- ✅ Error handling (graceful degradation)
- ✅ Test coverage
- ✅ README documentation

### Common Patterns

**Expand/Collapse State:**
```jsx
const [isOpen, setIsOpen] = useState(false);
const toggle = () => setIsOpen(!isOpen);
```

**Dark Mode Styling:**
```jsx
<div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
```

**Conditional Rendering:**
```jsx
{hasContent && <div>{content}</div>}
{!hasContent && <p>No content available</p>}
```

**Recursive Components:**
```jsx
const RecursiveTree = ({ node, level = 0 }) => (
  <div style={{ paddingLeft: level * 20 }}>
    {node.children?.map(child => (
      <RecursiveTree key={child.id} node={child} level={level + 1} />
    ))}
  </div>
);
```
