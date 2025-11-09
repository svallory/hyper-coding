# Init Templates - Meta-Template System

This directory contains the **legacy meta-template system** inherited from Hygen. These templates generate other templates, creating a self-bootstrapping mechanism for initializing new generators and template repositories.

## Overview

The `init` templates serve as "generators for generators" - they create the scaffolding needed to build new template-based code generators within Hypergen. This is a foundational pattern that enables Hypergen to be self-documenting and self-replicating.

### What This Module Does

- **Bootstraps Template Repositories**: Creates initial directory structure for new template projects
- **Generates Generator Templates**: Creates new generator templates within existing projects
- **Self-Documentation**: Provides working examples of template syntax and patterns
- **Legacy Compatibility**: Maintains backward compatibility with Hygen's `init` command
- **Meta-Templating**: Demonstrates how templates can generate other templates using double-escaping

## Directory Structure

```
init/
├── README.md           # This file
├── repo/               # Repository initialization templates
│   └── new-repo.ejs.t  # Creates new template repository structure
└── self/               # Generator creation templates
    ├── new-generator.ejs.t                  # Basic generator (no prompts)
    ├── new-generator-with-prompt.ejs.t      # Generator with user prompts
    ├── new-generator-with-prompt.prompt.ejs.t  # Prompt configuration
    ├── new-generator-help.ejs.t             # Help/usage documentation
    └── new-repo.ejs.t                       # Recursive repository template
```

## Key Files and Their Purposes

### `repo/new-repo.ejs.t`

**Purpose**: Initializes a brand new template repository from scratch.

**Usage**:

```bash
hypergen init repo --name=my-templates
```

**Frontmatter**:

```yaml
---
setup: <%= name %>   # Creates a directory with the given name
force: true          # Safe to overwrite (init typically used on existing folders)
---
```

**What It Does**:

- Creates a directory named after the `name` parameter
- Sets up the basic structure for a template repository
- Intended for creating standalone template packages

### `self/new-generator.ejs.t`

**Purpose**: Generates a simple generator template without interactive prompts.

**Usage**:

```bash
hypergen init self
```

**Output**: Creates `_templates/generator/new/hello.ejs.t`

**Generated Template Structure**:

```
_templates/
└── generator/
    └── new/
        └── hello.ejs.t
```

**Generated Template Content**:

```ejs
---
to: _templates/<%%= name %%>/<%%= action || 'new' %%>/hello.ejs.t
---
---
to: app/hello.js
---
const hello = `
Hello!
This is your first hygen template.

Learn what it can do here:

https://github.com/jondot/hygen
`

console.log(hello)
```

**Note**: Uses double-escaping (`%%`) for variables that should be evaluated when the generated template runs, not during generation.

### `self/new-generator-with-prompt.ejs.t`

**Purpose**: Creates a generator that asks users questions before generating files.

**Usage**:

```bash
hypergen init self
```

**Output**: Creates `_templates/generator/with-prompt/hello.ejs.t`

**Difference from `new-generator.ejs.t`**: Designed to work alongside `prompt.js` files for interactive input gathering.

### `self/new-generator-with-prompt.prompt.ejs.t`

**Purpose**: Creates a prompt configuration file for interactive generators.

**Output**: Creates `_templates/generator/with-prompt/prompt.js`

**Generated Prompt Configuration**:

```javascript
// see types of prompts:
// https://github.com/enquirer/enquirer/tree/master/examples
//
module.exports = [
  {
    type: 'input',
    name: 'message',
    message: 'What\'s your message?',
  },
];
```

**Integration**: Uses [Enquirer](https://github.com/enquirer/enquirer) for interactive prompts in the terminal.

### `self/new-generator-help.ejs.t`

**Purpose**: Generates help text showing how to use the generator system.

**Output**: Creates `_templates/generator/help/index.ejs.t`

**Generated Content**:

```yaml
---
message: |
  hygen {bold generator new} --name [NAME] --action [ACTION]
  hygen {bold generator with-prompt} --name [NAME] --action [ACTION]
---
```

**Use Case**: Provides self-documentation when users run `hypergen generator help`.

### `self/new-repo.ejs.t`

**Purpose**: Meta-template that creates the repository initialization template.

**Output**: Creates `_templates/init/repo/new-repo.ejs.t`

**Recursive Nature**: This is where the system becomes self-referential - it generates the very template used to initialize repositories, making Hypergen capable of recreating its own scaffolding system.

## Architecture and Design Patterns

### Meta-Template Pattern

Templates in this directory are **meta-templates** - they generate other templates. This requires special handling of template syntax.

**Double-Escaping**:

```ejs
<%%= variable %%>  // Renders as: <%= variable %>
```

**Why This Matters**:

1. **First Pass** (during `init`): Hypergen renders `<%%= name %%>` → becomes `<%= name %>` in output
2. **Second Pass** (when using generated template): User's data fills `<%= name %>` → becomes actual value

**Example Flow**:

```bash
# User runs init
$ hypergen init self

# Hypergen processes new-generator.ejs.t
# Double-escaped <%%= name %%> becomes <%= name %>
# Writes: _templates/generator/new/hello.ejs.t

# Later, user runs the generated template
$ hypergen generator new --name=MyComponent

# Hypergen processes hello.ejs.t
# <%= name %> becomes "MyComponent"
# Writes: app/MyComponent.js
```

### Self-Bootstrapping System

The `self/new-repo.ejs.t` creates `init/repo/new-repo.ejs.t`, which means:

- Hypergen can recreate its own initialization system
- The tool is self-documenting by example
- Template structure is preserved across generated repositories

### Frontmatter-Driven Generation

Templates use YAML frontmatter to control file generation behavior:

**File Creation**:

```yaml
---
to: path/to/output/file.ext
---
```

**Directory Creation**:

```yaml
---
setup: directory-name
---
```

**Force Overwrite**:

```yaml
---
force: true
---
```

**Message Display**:

```yaml
---
message: |
  Multi-line
  help text
---
```

### Template Naming Convention

Files use `.ejs.t` extension:

- `.ejs` → EJS (Embedded JavaScript) templating engine
- `.t` → Template file marker (Hygen convention)

## How the Code Works

### High-Level Flow

```
┌─────────────────────────────────────────────────────┐
│ User runs: hypergen init self                       │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│ 1. params.ts: Parse arguments                       │
│    - generator = "init"                             │
│    - action = "self"                                │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│ 2. config-resolver.ts: Find templates directories   │
│    - Check HYPERGEN_TMPLS env var                   │
│    - Look for .hypergen.js config                   │
│    - Search for recipes/ folder                     │
│    - Fall back to built-in templates                │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│ 3. TemplateStore.ts: Index templates                │
│    - Scan src/templates/init/self/*.ejs.t           │
│    - Build hash-indexed template store              │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│ 4. render.ts: Process each template                 │
│    - Parse YAML frontmatter                         │
│    - Render EJS with context variables              │
│    - Handle double-escaping (%%→%)                  │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│ 5. execute.ts: Write files to disk                  │
│    - Create directories (if setup attribute)        │
│    - Write template files (if to attribute)         │
│    - Display messages (if message attribute)        │
└─────────────────────────────────────────────────────┘
```

### Template Discovery

Templates are discovered through filesystem scanning:

1. **Configuration Resolution**: `config-resolver.ts` determines template search paths
2. **Directory Scanning**: `TemplateStore.ts` indexes all `.ejs.t` files
3. **Lazy Loading**: Templates loaded on-demand for performance
4. **Hash Indexing**: Fast lookup by generator/action names

### Argument Resolution

Special handling in `params.ts` (lines 10-41) for flexible argument parsing:

```typescript
// Supports multiple invocation patterns:
hypergen init repo MyName        // generator=init, action=repo, name=MyName
hypergen init repo               // generator=init, action=repo
hypergen init MyName             // generator=init, action=_default, name=MyName
```

### Context Variables

Templates receive a context object with helpers:

```javascript
{
  name: "...",          // User-provided name
  action: "...",        // Action name
  generator: "...",     // Generator name
  // Plus inflection helpers, change-case, etc.
}
```

## How to Contribute/Work with This Code

### When to Modify These Templates

**RARELY**. These are legacy artifacts. Only modify for:

1. **Critical Bug Fixes**: Breaking issues affecting backward compatibility
2. **Security Issues**: Vulnerabilities in generated code
3. **Documentation Updates**: Improving inline comments/references

### When to Use Modern Alternatives

For new features, use the modern scaffolding system:

**Modern Hypergen V8 Approach**:

```bash
# Use the modern scaffolding system
hypergen init generator --name=my-widget --framework=react
hypergen init workspace --withExamples=true
```

**Implementation**: See `src/cli/scaffolding.ts` (1019 lines of modern scaffolding logic)

### Testing Changes

If you modify these templates:

1. **Unit Tests**:
   ```bash
   bun test tests/metaverse.spec.ts
   ```

2. **Integration Tests**:
   ```bash
   # Test basic init
   hypergen init self

   # Test repo init
   hypergen init repo --name=test-repo
   ```

3. **Validate Output**:
   - Check generated files have correct syntax
   - Verify double-escaping preserved: `<%%= var %%>` → `<%= var %>`
   - Ensure generated templates are executable

4. **Metaverse Tests**:
   ```bash
   bun test -- metaverse
   ```

   Validates against test fixtures in `tests/fixtures/metaverse/hygen-templates/_templates/init/`

### Adding New Init Templates

**Not Recommended**. Instead:

1. Extend `src/cli/scaffolding.ts` with new generator types
2. Add framework-specific templates to the modern system
3. Use the action decorator system for new generators

If you must add a new init template:

1. Create `.ejs.t` file in `repo/` or `self/`
2. Use double-escaping for nested templates: `<%%=` not `<%=`
3. Add frontmatter with `to:` or `setup:` directives
4. Test with `hypergen init self` or `hypergen init repo`
5. Update this README

## Dependencies and Relationships

### Direct Dependencies

**Rendering Engine**:

- `src/render.ts` - EJS template processor
- EJS library for template evaluation

**Configuration**:

- `src/config-resolver.ts` - Template path resolution
- `src/config.ts` - Config file discovery

**Template Management**:

- `src/TemplateStore.ts` - Template indexing and caching
- `src/generators.ts` - Generator loading logic

**Execution**:

- `src/execute.ts` - File operations (write, setup dirs)
- `src/ops/` - File operation primitives

**Argument Parsing**:

- `src/params.ts` - CLI argument resolution
- `src/prompt.js` - Interactive prompt integration

### External Libraries

- **EJS**: Embedded JavaScript templating
- **Enquirer**: Interactive prompt library (for generated prompts)
- **fs-extra**: Enhanced filesystem operations

### Related Modules

**Modern Alternatives**:

- `src/cli/scaffolding.ts` - Modern generator initialization (lines 23-1019)
- `src/actions/` - TypeScript decorator-based action system

**Configuration System**:

- `src/config/` - Advanced configuration management
- `src/config/types.ts` - Type definitions

**Template Engines**:

- `src/template-engines/` - Pluggable template engine system

### Integration Points

**Not Directly Imported**: These templates exist as filesystem resources, not TypeScript modules.

**Loaded At Runtime**:

- Discovered by filesystem scanning
- Processed by EJS rendering engine
- Indexed in TemplateStore

**CLI Entry Points**:

```bash
hypergen init self       # → init/self/*.ejs.t
hypergen init repo       # → init/repo/*.ejs.t
```

## Important Implementation Details

### Double-Escaping Mechanics

**Problem**: How to create templates that generate templates?

**Solution**: Double the EJS delimiters

```ejs
# In meta-template (this file):
<%%= name %%>

# Generated template (output file):
<%= name %>

# Final output (when user runs generated template):
MyActualValue
```

### Frontmatter Processing

Templates have two frontmatter blocks when generating templates:

```ejs
---
# Outer frontmatter (processed during init)
to: _templates/<%%= name %%>/<%%= action %%>/file.ejs.t
---
---
# Inner frontmatter (written to generated template)
to: app/<%= name %>.js
---
```

### Force Flag Usage

`force: true` is safe in init templates because:

- Init typically runs in new/empty directories
- Users expect initialization to create structure
- Overwriting existing files is intentional during setup

### Variable Escaping Levels

Three levels of escaping in meta-templates:

1. **Immediate Evaluation**: `<%= name %>` - Evaluated during init
2. **Deferred Evaluation**: `<%%= name %%>` - Written to generated template
3. **Escaped Deferred**: `<%%%= name %%%>` - For triple-nested meta-templates (rare)

### Template Resolution Order

When user runs `hypergen init self`:

1. Check `HYPERGEN_TMPLS` environment variable
2. Look for `.hypergen.js` config file `templatesOverride`
3. Check configured `templates` paths
4. Default to `recipes/` directory
5. Fall back to built-in `src/templates/` (these files)

## Usage Examples

### Initialize a Template Repository

```bash
# Create new template repository
hypergen init repo --name=my-awesome-templates

# Result: Creates directory structure
my-awesome-templates/
└── (basic repository scaffold)
```

### Generate Self-Bootstrapping Templates

```bash
# Run init self in your project
cd my-project
hypergen init self

# Result: Creates generator templates
_templates/
├── generator/
│   ├── new/
│   │   └── hello.ejs.t
│   ├── with-prompt/
│   │   ├── hello.ejs.t
│   │   └── prompt.js
│   └── help/
│       └── index.ejs.t
```

### Create a Custom Generator

```bash
# After running init self, create new generator
hypergen generator new --name=component --action=create

# Result: Creates component generator at
_templates/component/create/hello.ejs.t
```

### Understand Meta-Templating

Study the templates to learn:

```bash
# View the meta-template source
cat src/templates/init/self/new-generator.ejs.t

# Run it to see generated output
hypergen init self

# View what it generated
cat _templates/generator/new/hello.ejs.t

# Run the generated template
hypergen generator new --name=MyThing

# View the final output
cat app/hello.js
```

## Current Status

### Legacy Compatibility Layer

These templates are **maintained but not actively developed**:

- ✅ Fully functional and tested
- ✅ Backward compatible with Hygen
- ✅ Excellent learning resources
- ⚠️ Not the primary development path
- ⚠️ Modern alternatives preferred for new work

### Modern Alternative: Hypergen V8

Use the modern scaffolding system for new development:

```typescript
// src/cli/scaffolding.ts
class GeneratorScaffolding {
  async initGenerator(options: ScaffoldingOptions,): Promise<Result>;
  async initWorkspace(options: WorkspaceOptions,): Promise<Result>;
}
```

**Advantages**:

- TypeScript-based with full type safety
- Framework-aware (React, Vue, API, CLI, etc.)
- Generates tests and examples automatically
- Supports action decorators (V8 feature)
- More comprehensive scaffolding options

**Example**:

```bash
# Modern approach with many options
hypergen init generator \
  --name=my-widget \
  --framework=react \
  --type=both \
  --withTests=true \
  --withExamples=true \
  --category=ui
```

### Migration Path

**If you're using Hygen**: These templates ensure seamless migration

```bash
hygen init self    # Old way
hypergen init self # New way - identical behavior
```

**If you're starting fresh**: Use modern Hypergen

```bash
hypergen init generator --name=my-gen --framework=react
```

## Historical Context

### Origin: Hygen (2017-2022)

These templates come from [Hygen](https://github.com/jondot/hygen), a code generator created by Dotan Nahum.

**Hygen's Innovation**: Self-bootstrapping meta-template system

- Generators that generate generators
- Simple, file-based approach
- EJS templating with frontmatter
- Minimal configuration

### Hypergen Fork

Hypergen forked from Hygen to add:

- TypeScript-first architecture
- Enhanced scalability for large generator sets
- Action decorator system (V8)
- Multi-template directory support
- Modern scaffolding system

### Maintained for Compatibility

These init templates are preserved:

- Enable smooth Hygen-to-Hypergen migration
- Provide learning resources for template syntax
- Serve as fallback bootstrapping mechanism
- Document the system's evolution

## Future Considerations

### No Planned Deprecation

These templates will remain:

- Small footprint (6 files, ~100 lines)
- Low maintenance burden
- High educational value
- Critical for backward compatibility

### Recommendations by Use Case

**Learning Template Mechanics**:

```bash
# Study these templates to understand meta-templating
cat src/templates/init/self/*.ejs.t
```

**Migrating from Hygen**:

```bash
# Use these for familiar Hygen workflow
hypergen init self
hypergen init repo --name=templates
```

**New Hypergen Projects**:

```bash
# Use modern V8 scaffolding
hypergen init generator --name=component --framework=react
hypergen init workspace --withExamples=true
```

**Contributing to Hypergen**:

- Extend `src/cli/scaffolding.ts` for new generator types
- Add framework templates to modern system
- Use action decorators for new features
- Leave init templates unchanged unless critical

## Summary

The `src/templates/init/` directory contains **legacy meta-templates** that enable Hypergen's self-bootstrapping capability. While fully functional and maintained for backward compatibility, modern Hypergen development should prefer the V8 scaffolding system in `src/cli/scaffolding.ts`.

### Key Takeaways for Team Members

✅ **Understand**: These templates demonstrate meta-templating patterns
✅ **Maintain**: Keep them working for backward compatibility\
✅ **Learn From**: Study them to grasp template mechanics
✅ **Don't Extend**: Use modern scaffolding for new features
✅ **Test Against**: Validate core engine changes with these templates

### Quick Reference

| Use Case              | Command                                     | System |
| --------------------- | ------------------------------------------- | ------ |
| Learn meta-templating | Study `init/self/*.ejs.t`                   | Legacy |
| Hygen compatibility   | `hypergen init self`                        | Legacy |
| New React generator   | `hypergen init generator --framework=react` | Modern |
| Full workspace setup  | `hypergen init workspace --withExamples`    | Modern |
| Extend scaffolding    | Edit `src/cli/scaffolding.ts`               | Modern |

## Related Documentation

- **Parent Directory**: `src/templates/README.md` - Overview of template system
- **Modern Scaffolding**: `src/cli/scaffolding.ts` - V8 generator initialization
- **Template Engine**: `src/render.ts` - EJS rendering implementation
- **Configuration**: `src/config-resolver.ts` - Template discovery logic
- **Hygen Docs**: http://www.hygen.io/ - Original project documentation
- **Migration Guide**: `docs/migration/from-hygen.md` - Hygen to Hypergen migration
