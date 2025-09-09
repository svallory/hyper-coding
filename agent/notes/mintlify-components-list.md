# Mintlify Components Reference

This document lists all available Mintlify components for use in documentation, based on the latest research from Mintlify's official documentation.

## Core Content Components

### 1. **Accordion & AccordionGroup**
- **Purpose**: Collapsible content sections
- **Props**: `title` (required), `description`, `defaultOpen`, `icon`, `iconType`
- **Use Case**: FAQ sections, expandable content

### 2. **Card**
- **Purpose**: Navigation cards with links and visual elements
- **Props**: `title` (required), `color`, `href`, `horizontal`, `img`, `cta`, `arrow`, `icon`
- **Use Case**: Feature highlights, navigation grids

### 3. **Columns**
- **Purpose**: Layout component for arranging content in columns
- **Props**: `cols` (default: 2)
- **Use Case**: Arranging Card components in grids

### 4. **Frame**
- **Purpose**: Container for images with optional captions
- **Props**: `caption`
- **Use Case**: Image galleries, screenshots with context

## Navigation & Structure Components

### 5. **Tabs & Tab**
- **Purpose**: Tabbed content interface
- **Props**: 
  - Tab: `title` (required), `icon`, `iconType`
- **Use Case**: Platform-specific content, alternative approaches

### 6. **Steps & Step**
- **Purpose**: Sequential procedural content
- **Props**: 
  - Steps: `children` (required), `titleSize`
  - Step: `children` (required), `title`, `stepNumber`, `titleSize`, `icon`, `iconType`
- **Use Case**: Tutorials, setup guides

### 7. **Panel**
- **Purpose**: Customizes the right side panel
- **Special**: Replaces default table of contents
- **Use Case**: Custom navigation, pinned information

## API Documentation Components

### 8. **ParamField**
- **Purpose**: Document API parameters
- **Props**: `path`, `type`, `required`, `deprecated`, `default`, `initialValue`, `placeholder`, `children`
- **Use Case**: API endpoint documentation, SDK parameters

### 9. **ResponseField**
- **Purpose**: Document API responses
- **Props**: `name` (required), `type` (required), `default`, `required`, `deprecated`, `pre`, `post`
- **Use Case**: API response documentation, object properties

### 10. **RequestExample & ResponseExample**
- **Purpose**: Code examples in sidebar
- **Special**: Must be inside Panel if Panel is used
- **Use Case**: API examples, code snippets

## Interactive Components

### 11. **Expandable**
- **Purpose**: Collapsible nested content
- **Props**: `title`, `defaultOpen`
- **Use Case**: Nested object properties, hierarchical information

### 12. **Tooltip**
- **Purpose**: Hover information
- **Props**: `tip`
- **Use Case**: Additional context, definitions

### 13. **Icon**
- **Purpose**: Display icons
- **Props**: `icon`, `color`, `size`
- **Supports**: Font Awesome, Lucide icons, custom SVGs

## Content Enhancement Components

### 14. **Update**
- **Purpose**: Changelog entries
- **Props**: `label` (required), `tags`, `description`
- **Use Case**: Version updates, release notes

### 15. **CodeGroup**
- **Purpose**: Multi-language code examples
- **Use Case**: Same concept in multiple programming languages

### 16. **Table**
- **Purpose**: Structured data display
- **Use Case**: Specifications, comparisons

## Message Components

### 17. **Info**
- **Purpose**: Informational messages
- **Use Case**: Important notes, tips

### 18. **Tip**
- **Purpose**: Helpful hints
- **Use Case**: Shortcuts, best practices

### 19. **Warning**
- **Purpose**: Cautionary messages
- **Use Case**: Important warnings, deprecations

### 20. **Note**
- **Purpose**: General notes
- **Use Case**: Additional context, reminders

## Component Selection Guidelines

Based on the research, here are the recommended usage patterns:

- **Use Steps** for procedures and sequential instructions
- **Use Tabs** for platform-specific content or alternative approaches  
- **Use CodeGroup** when showing the same concept in multiple programming languages
- **Use Accordions** for progressive disclosure of information
- **Use RequestExample/ResponseExample** specifically for API endpoint documentation
- **Use ParamField** for API parameters, **ResponseField** for API responses
- **Use Expandable** for nested object properties or hierarchical information

## Performance Considerations

For React components:
- Optimize dependency arrays in useEffect
- Use useMemo/useCallback for expensive operations
- Break large components into smaller ones
- Consider lazy loading for complex components
- Components render client-side (SEO and initial load implications)

## Integration Notes

- React components must be in `/snippets/` folder
- Components support both light and dark modes
- Icons support Font Awesome, Lucide, and custom SVGs
- All components support markdown content where applicable