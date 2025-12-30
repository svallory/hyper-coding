# Template Engine Comparison and Recommendation

**Date**: 2025-12-27
**Purpose**: Select a single template engine for Hypergen V8

## Executive Summary

After evaluating five template engines (EJS, LiquidJS, Eta, EdgeJS, and Nunjucks), **LiquidJS is the recommended choice** for Hypergen V8.

**Key Reasons**:
- ✅ Security-first design (safe for user-generated templates)
- ✅ Powerful and extensible with custom tags/filters
- ✅ Clean, readable syntax similar to handlebars
- ✅ Active maintenance and large community
- ✅ Already partially integrated in Hypergen
- ✅ Perfect balance of simplicity and power

## Comparison Matrix

| Feature | EJS | LiquidJS | Eta | EdgeJS | Nunjucks |
|---------|-----|----------|-----|--------|----------|
| **Performance** | Good | Excellent | **Fastest** | Good | Good |
| **Security** | ❌ Low | ✅ **High** | Medium | Medium | Medium |
| **Bundle Size** | 4.4KB | 28KB | **2.5KB** | Medium | 73KB |
| **Extensibility** | Limited | ✅ **Excellent** | Good | Good | Excellent |
| **TypeScript** | ❌ No | ✅ Yes | ✅ **Yes** | Partial | Partial |
| **Maintenance** | Active | ✅ **Very Active** | Active | Active | Moderate |
| **Learning Curve** | ✅ **Easy** | Easy | Easy | Medium | Medium |
| **Template Inheritance** | ❌ No | ✅ Yes | Limited | ✅ Yes | ✅ **Best** |
| **Async Support** | Limited | ✅ Yes | ✅ Yes | ✅ **Yes** | ✅ Yes |
| **Custom Tags** | ❌ No | ✅ **Yes** | Limited | ✅ Yes | ✅ Yes |
| **Community** | Large | ✅ **Large** | Growing | Smaller | Large |
| **AI Integration** | Poor | ✅ **Excellent** | Good | Good | Good |

## Detailed Analysis

### 1. EJS (Embedded JavaScript)

**Current Status**: Actively maintained, v3.1.10 (January 2025)

#### Strengths
- ✅ Extremely simple - pure JavaScript in templates
- ✅ Very low learning curve for JS developers
- ✅ Small bundle size (4.4KB gzipped)
- ✅ Large community and ecosystem
- ✅ Fast for simple templates

#### Weaknesses
- ❌ **Security risk** - evaluates arbitrary JavaScript code
- ❌ No built-in template inheritance
- ❌ Limited extensibility (no custom tags)
- ❌ Poor separation of logic and presentation
- ❌ No TypeScript support
- ❌ Not suitable for user-generated templates

#### Example
```ejs
<% if (user) { %>
  <h2><%= user.name %></h2>
  <% user.projects.forEach(function(project) { %>
    <p><%= project.name %></p>
  <% }); %>
<% } %>
```

**Verdict**: ❌ Too simplistic for modern code generation. Security concerns make it unsuitable for user templates.

---

### 2. LiquidJS

**Current Status**: Very actively maintained, v10.24.0 (December 2024)

#### Strengths
- ✅ **Security-first design** - sandboxed, safe for user templates
- ✅ Powerful custom tags and filters
- ✅ Template inheritance and includes
- ✅ Written in TypeScript
- ✅ Excellent async support
- ✅ Large, active community (Shopify backing)
- ✅ **Perfect for AI integration** - can add custom AI tags easily
- ✅ Clean, readable syntax
- ✅ Comprehensive documentation

#### Weaknesses
- ⚠️ Slightly larger bundle (28KB) - not an issue for Node.js
- ⚠️ Steeper learning curve than EJS

#### Example
```liquid
{% if user %}
  <h2>{{ user.name }}</h2>
  {% for project in user.projects %}
    <p>{{ project.name }}</p>
  {% endfor %}
{% endif %}

<!-- Custom tags -->
{% ai.implement description="user validation" context="validators/*.ts" %}
```

#### Why Perfect for Hypergen
```javascript
// Easy to extend with custom AI tags
liquid.registerTag('ai.implement', {
  parse(tagToken) {
    this.args = tagToken.args
  },
  render(context) {
    return `// AI_IMPLEMENT: ${this.args.description}`
  }
})

// Supports filters for code transformation
liquid.registerFilter('pascalCase', str =>
  str.replace(/(\w)(\w*)/g, (g0, g1, g2) =>
    g1.toUpperCase() + g2.toLowerCase()
  )
)
```

**Verdict**: ✅ **RECOMMENDED** - Perfect balance of power, security, and extensibility.

---

### 3. Eta (Embedded TypeScript)

**Current Status**: Very actively maintained, v4.4.1 (December 2024)

#### Strengths
- ✅ **Fastest template engine** - 3x faster than EJS
- ✅ **Smallest bundle** - only 2.5KB gzipped
- ✅ Written in TypeScript
- ✅ Deno and browser support
- ✅ Custom delimiters
- ✅ Plugin system
- ✅ Great performance

#### Weaknesses
- ❌ Limited template inheritance
- ❌ Security concerns (evaluates JavaScript like EJS)
- ❌ Smaller community than competitors
- ❌ Less feature-rich than LiquidJS/Nunjucks
- ❌ Limited extensibility compared to LiquidJS

#### Example
```eta
<% if (it.user) { %>
  <h2><%= it.user.name %></h2>
  <% it.user.projects.forEach(project => { %>
    <p><%= project.name %></p>
  <% }) %>
<% } %>
```

**Verdict**: ⚠️ Great performance but lacks security and advanced features needed for code generation.

**Sources**:
- [Eta Official Website](https://eta.js.org/)
- [I built a JS template engine 3x faster than EJS](https://dev.to/nebrelbug/i-built-a-js-template-engine-3x-faster-than-ejs-lj8)
- [Eta Performance Benchmarks](https://eta.js.org/docs/2.x.x/about/performance)
- [Introducing Eta v3](https://dev.to/bgub/introducing-eta-v3-8m9)

---

### 4. EdgeJS

**Current Status**: Actively maintained, v6.3.0 (October 2024)

#### Strengths
- ✅ Modern JavaScript-like syntax
- ✅ Excellent async/await support
- ✅ Component system
- ✅ Runtime compilation
- ✅ Good for AdonisJS users
- ✅ Clean, readable templates

#### Weaknesses
- ❌ Smaller community (primarily AdonisJS)
- ❌ Less extensible than LiquidJS
- ❌ Limited ecosystem
- ❌ Not TypeScript-first
- ❌ Less documentation than competitors

#### Example
```edge
@if(user)
  <h2>{{ user.name }}</h2>
  @each(project in user.projects)
    <p>{{ project.name }}</p>
  @end
@end

@!component('button', { text: 'Click me' })
```

**Verdict**: ⚠️ Good engine but smaller ecosystem. Better suited for AdonisJS projects.

**Sources**:
- [EdgeJS Documentation](https://edgejs.dev/docs/introduction)
- [EdgeJS GitHub](https://github.com/edge-js/edge)
- [AdonisJS EdgeJS Guide](https://docs.adonisjs.com/guides/views-and-templates/edgejs)

---

### 5. Nunjucks

**Current Status**: Moderately maintained, v3.2.4 (March 2023)

#### Strengths
- ✅ Powerful template inheritance (best in class)
- ✅ Comprehensive feature set
- ✅ Jinja2-compatible syntax
- ✅ Async rendering
- ✅ Custom filters and tags
- ✅ Large community

#### Weaknesses
- ❌ **Less active maintenance** (last update March 2023)
- ❌ Larger bundle size (73KB)
- ❌ Steeper learning curve
- ❌ Not TypeScript-first
- ❌ Overkill for most use cases

#### Example
```jinja2
{% if user %}
  <h2>{{ user.name }}</h2>
  {% for project in user.projects %}
    <p>{{ project.name }}</p>
  {% endfor %}
{% endif %}

{% extends "base.html" %}
{% block content %}
  Custom content here
{% endblock %}
```

**Verdict**: ⚠️ Powerful but declining maintenance. Too complex for our needs.

**Sources**:
- [Template Engines Comparison](https://npm-compare.com/ejs,handlebars,liquidjs,nunjucks,pug)
- [Liquid vs Nunjucks](https://stackshare.io/stackups/liquid-vs-nunjucks)
- [Node.js Template Engines Comparison](https://tutorial.techaltum.com/template-engine.html)

---

## Decision Matrix

### Use Case Scoring (1-5, 5 = best)

| Use Case | EJS | LiquidJS | Eta | EdgeJS | Nunjucks |
|----------|-----|----------|-----|--------|----------|
| Code Generation | 2 | **5** | 3 | 4 | 4 |
| AI Integration | 2 | **5** | 3 | 3 | 4 |
| Security | 1 | **5** | 2 | 3 | 3 |
| Extensibility | 2 | **5** | 3 | 4 | 5 |
| Maintainability | 3 | **5** | 4 | 3 | 3 |
| Performance | 4 | 4 | **5** | 4 | 3 |
| Developer UX | 5 | **5** | 4 | 4 | 3 |
| **Total** | **19** | **34** | 24 | 25 | 25 |

## LiquidJS: Deep Dive

### Why LiquidJS is Perfect for Hypergen

#### 1. Security-First Design
```javascript
// LiquidJS is sandboxed - safe for user templates
const template = '{{ user_input }}'
liquid.parseAndRender(template, { user_input: '<script>alert("xss")</script>' })
// Output: &lt;script&gt;alert("xss")&lt;/script&gt;

// EJS would execute arbitrary code
const template = '<%= eval("process.exit()") %>' // ❌ DANGEROUS
```

#### 2. Custom Tags for AI Integration
```javascript
// Easy to add AI-specific tags
liquid.registerTag('ai.implement', class {
  parse(tagToken) {
    this.description = tagToken.args.description
    this.context = tagToken.args.context
    this.constraints = tagToken.args.constraints
  }

  async render(context, emitter) {
    // Generate AI marker that will be processed later
    emitter.write(`// AI_IMPLEMENT: ${this.description}\n`)
    if (this.context) {
      emitter.write(`// Context: ${this.context}\n`)
    }
    if (this.constraints) {
      emitter.write(`// Constraints: ${this.constraints.join(', ')}\n`)
    }
  }
})

// Usage in templates
{% ai.implement
   description="validate user input"
   context="validators/*.ts"
   constraints=["use Zod", "handle all edge cases"] %}
```

#### 3. Powerful Filters
```javascript
liquid.registerFilter('pascalCase', str =>
  str.split(/[-_\s]/)
     .map(w => w.charAt(0).toUpperCase() + w.slice(1))
     .join('')
)

liquid.registerFilter('kebabCase', str =>
  str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
)

// In templates
{{ name | pascalCase }}Service
{{ name | kebabCase }}-component
```

#### 4. Template Composition
```liquid
<!-- base.liquid -->
<!DOCTYPE html>
<html>
  {% block content %}{% endblock %}
</html>

<!-- page.liquid -->
{% extends "base.liquid" %}
{% block content %}
  <h1>{{ title }}</h1>
{% endblock %}
```

#### 5. Async Support
```liquid
{% assign userData = "users/123" | fetch %}
{{ userData.name }}

<!-- Custom async filters -->
liquid.registerFilter('fetch', async (path) => {
  const response = await fetch(apiUrl + path)
  return await response.json()
})
```

### Migration from EJS to LiquidJS

#### Syntax Mapping

| EJS | LiquidJS |
|-----|----------|
| `<%= var %>` | `{{ var }}` |
| `<%- html %>` | `{{ html }}` (auto-escaped by default) |
| `<% if (cond) { %>` | `{% if cond %}` |
| `<% } %>` | `{% endif %}` |
| `<% for (let i in arr) { %>` | `{% for item in arr %}` |
| `<% } %>` | `{% endfor %}` |
| `<%- include('partial') %>` | `{% include 'partial' %}` |

#### Simple Example

**Before (EJS)**:
```ejs
---
to: src/components/<%= name %>.tsx
---
import React from 'react'

interface <%= name %>Props {
  children?: React.ReactNode
}

export const <%= name %>: React.FC<<%= name %>Props> = ({ children }) => {
  return <div className="<%= name.toLowerCase() %>">{children}</div>
}
```

**After (LiquidJS)**:
```liquid
---
to: src/components/{{ name | pascalCase }}.tsx
---
import React from 'react'

interface {{ name | pascalCase }}Props {
  children?: React.ReactNode
}

export const {{ name | pascalCase }}: React.FC<{{ name | pascalCase }}Props> = ({ children }) => {
  return <div className="{{ name | kebabCase }}">{children}</div>
}
```

## Implementation Plan

### Phase 1: Add LiquidJS Support (Week 1)
- [x] Already partially implemented
- [ ] Remove EJS engine completely
- [ ] Update all example templates to LiquidJS
- [ ] Add custom filters for code generation (pascalCase, camelCase, etc.)
- [ ] Add AI-specific tags

### Phase 2: Migrate Existing Templates (Week 2)
- [ ] Convert all `src/templates/` from EJS to LiquidJS
- [ ] Update tests to use LiquidJS syntax
- [ ] Update documentation

### Phase 3: Enhance (Week 3)
- [ ] Add advanced custom tags
- [ ] Optimize performance
- [ ] Add template validation
- [ ] Create comprehensive examples

## Configuration

```javascript
// hypergen.config.js
export default {
  templates: {
    engine: 'liquid', // Only option in V8
    directory: 'templates', // Changed from _templates

    // Custom filters
    filters: {
      pascalCase: str => /* ... */,
      camelCase: str => /* ... */,
      kebabCase: str => /* ... */
    },

    // Custom tags for AI integration
    tags: {
      'ai.implement': AiImplementTag,
      'ai.generate': AiGenerateTag
    }
  }
}
```

## Conclusion

**LiquidJS is the clear winner** for Hypergen V8:

1. ✅ **Security** - Safe for user-generated templates
2. ✅ **Power** - Rich feature set with custom tags/filters
3. ✅ **AI-Ready** - Perfect for adding AI-specific functionality
4. ✅ **Maintainable** - TypeScript, active development, great docs
5. ✅ **Community** - Large ecosystem, Shopify backing
6. ✅ **Developer UX** - Clean syntax, easy to learn

The slightly larger bundle size (28KB vs 2.5KB for Eta) is irrelevant for a Node.js CLI tool, and the security + extensibility benefits far outweigh any performance differences.

## Next Steps

1. ✅ Finalize decision on LiquidJS
2. Create migration guide for existing templates
3. Remove EJS engine and dependencies
4. Update all documentation
5. Add custom filters and tags for code generation
6. Implement AI-specific tags for V8 features
