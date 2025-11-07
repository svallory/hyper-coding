# Built-in Template Directory

This directory contains **legacy built-in templates** from the original Hygen project. These templates provide a bootstrapping mechanism for creating new generators and template repositories.

## Overview

The templates in this directory serve as "meta-templates" - they generate other templates. This is a self-referential system inherited from Hygen that allows Hypergen to bootstrap new generator projects and template structures.

### Purpose

- **Bootstrap new template repositories**: Create the initial structure for a template repository
- **Generate new generators**: Create new generator templates within an existing project
- **Self-documentation**: Provide examples of how Hygen/Hypergen templates work
- **Legacy compatibility**: Maintain backward compatibility with Hygen's `init` command

## Directory Structure

```
src/templates/
├── init/
│   ├── repo/              # Templates for initializing a new template repository
│   │   └── new-repo.ejs.t # Creates the initial repository structure
│   └── self/              # Templates for creating new generators within the repository
│       ├── new-generator.ejs.t                  # Basic generator template
│       ├── new-generator-with-prompt.ejs.t      # Generator with interactive prompts
│       ├── new-generator-with-prompt.prompt.ejs.t # Prompt configuration file
│       ├── new-generator-help.ejs.t             # Help text template
│       └── new-repo.ejs.t                       # Repository template (recursive)
```

## Template Files

### init/repo/new-repo.ejs.t

**Purpose**: Initializes a new template repository structure.

**Frontmatter**:
```yaml
---
setup: <%= name %>
force: true  # Safe to overwrite as people often init into existing folders
---
```

**Usage**: This template creates the basic directory structure for a new Hygen/Hypergen template repository. The `setup` attribute creates a directory with the given name.

### init/self/new-generator.ejs.t

**Purpose**: Creates a basic generator without prompts.

**Generates**: A simple "hello world" style generator template at `_templates/generator/new/hello.ejs.t`

**Template Output Structure**:
```
_templates/
└── [generator-name]/
    └── [action-name]/
        └── hello.ejs.t
```

**Example**: Creates a starter template that generates a simple JavaScript file with a hello message.

### init/self/new-generator-with-prompt.ejs.t

**Purpose**: Creates a generator that uses interactive prompts to gather user input.

**Generates**: Similar to `new-generator.ejs.t` but designed to work with prompt configuration.

**Use Case**: When you need to create generators that ask users questions before generating files.

### init/self/new-generator-with-prompt.prompt.ejs.t

**Purpose**: Creates a prompt configuration file for interactive generators.

**Generates**: A `prompt.js` file at `_templates/generator/with-prompt/prompt.js`

**Template Output**:
```javascript
module.exports = [
  {
    type: 'input',
    name: 'message',
    message: "What's your message?"
  }
]
```

**Integration**: Uses [Enquirer](https://github.com/enquirer/enquirer) for interactive prompts.

### init/self/new-generator-help.ejs.t

**Purpose**: Creates a help/documentation template for generators.

**Generates**: A help message template showing available generator commands.

**Frontmatter Output**:
```yaml
---
message: |
  hygen {bold generator new} --name [NAME] --action [ACTION]
  hygen {bold generator with-prompt} --name [NAME] --action [ACTION]
---
```

### init/self/new-repo.ejs.t

**Purpose**: Meta-template that creates the repository initialization template itself.

**Recursive Nature**: This template generates the `init/repo/new-repo.ejs.t` template, making the system self-bootstrapping.

## How It Works

### Template Naming Convention

All files use the `.ejs.t` extension:
- `.ejs` - Indicates EJS (Embedded JavaScript) templating
- `.t` - Indicates this is a template file (Hygen convention)

### Frontmatter

Each template has YAML frontmatter that controls file generation:

```yaml
---
to: path/to/output/file.ext     # Where to write the generated file
setup: directory-name            # Create a directory
force: true                      # Overwrite existing files
---
```

### Double Escaping

Templates that generate other templates use double percentage signs (`%%`) to escape EJS delimiters:

```ejs
---
to: _templates/<%%= name %%>/<%%= action || 'new' %%>/hello.ejs.t
---
```

This ensures that:
1. First pass: Hypergen renders `<%%= name %%>` as `<%= name %>`
2. Second pass: The generated template uses `<%= name %>` as a variable placeholder

## Current Status

⚠️ **Legacy System - Limited Active Use**

These templates are part of Hypergen's Hygen legacy compatibility layer. The modern Hypergen V8 system provides new scaffolding capabilities through:

- `src/cli/scaffolding.ts` - Modern generator scaffolding system
- TypeScript-based action decorators
- YAML-based `template.yml` configuration
- Advanced generator initialization via `hypergen init generator`

### Migration Path

Modern Hypergen usage **does not require** these legacy templates. Instead:

```bash
# Old Hygen way (uses these templates)
hygen init self

# New Hypergen way (uses scaffolding.ts)
hypergen init generator --name=my-widget --framework=react
hypergen init workspace --withExamples=true
```

## Integration Points

### Not Actively Referenced

Unlike typical source code, these templates are **not imported or referenced** in the TypeScript codebase. Instead:

1. They exist as **filesystem resources**
2. Loaded dynamically at runtime when `init` commands are invoked
3. Discovered through the template resolution system in `config-resolver.ts`
4. Processed by the EJS rendering engine in `render.ts`

### Discovery Mechanism

When a user runs `hypergen init repo` or `hypergen init self`:

1. **Argument Parsing** (`params.ts`): Determines generator and action
2. **Template Resolution** (`config-resolver.ts`): Locates templates directories
3. **Template Store** (`TemplateStore.ts`): Indexes available templates
4. **Rendering** (`render.ts`): Processes EJS templates with context
5. **Execution** (`execute.ts`): Writes generated files to disk

### Example Flow

```bash
$ hypergen init self
```

1. Parsed as: `generator=init`, `action=self`
2. Searches: `src/templates/init/self/*.ejs.t`
3. Finds: All template files in `init/self/`
4. Renders: Each template with provided variables
5. Outputs: New generator structure in `_templates/`

## Usage Examples

### Initialize a New Template Repository

```bash
# Create a new template repository named "my-templates"
hypergen init repo --name=my-templates
```

**Result**: Creates `my-templates/` directory with basic structure.

### Create a New Generator

```bash
# Create a basic generator
hypergen init self

# Creates:
# _templates/generator/new/hello.ejs.t
# _templates/generator/with-prompt/hello.ejs.t
# _templates/generator/with-prompt/prompt.js
# _templates/generator/help/index.ejs.t
```

### Understand the System

These templates are excellent **learning resources** for understanding:
- How EJS templates work
- How frontmatter controls file generation
- How generators can create other generators
- How to escape template syntax for meta-templating

## Design Patterns

### Meta-Template Pattern

Templates that generate templates use double-escaping:

```ejs
---
to: _templates/<%%= name %%>/<%%= action || 'new' %%>/hello.ejs.t
---
---
to: app/hello.js
---
const hello = `Hello <%= name %>!`
```

The outer template creates an inner template that will later be processed.

### Self-Referential System

The `init/self/new-repo.ejs.t` template generates the `init/repo/new-repo.ejs.t` template, creating a self-bootstrapping system where Hypergen can recreate its own initialization templates.

### Frontmatter-Only Templates

Some templates (like `new-generator-help.ejs.t`) contain only frontmatter with no body. They're used for:
- Displaying messages
- Creating directories
- Configuring behavior without generating file content

## Contributing

### When to Modify These Templates

**Rarely**. These templates are legacy artifacts. Modifications should only be made for:

1. **Critical bug fixes** affecting backward compatibility
2. **Security issues** in generated code
3. **Documentation improvements** in generated comments

### When to Use Modern Alternatives

For new features, enhance the modern scaffolding system instead:

- `src/cli/scaffolding.ts` - Generator initialization logic
- `src/cli/cli.ts` - CLI command handlers
- Modern template examples in `examples/` directory

### Testing Changes

If you modify these templates:

1. Test with metaverse fixtures: `bun test tests/fixtures/metaverse/`
2. Verify `init` commands: `hypergen init self`, `hypergen init repo`
3. Check double-escaping: Ensure generated templates have correct syntax
4. Validate output: Generated templates should be valid and executable

## Related Files

### Core System

- `src/config-resolver.ts` - Template directory resolution
- `src/render.ts` - EJS template rendering engine
- `src/execute.ts` - File operation execution
- `src/TemplateStore.ts` - Template indexing and lookup
- `src/params.ts` - Argument parsing (see lines 24-26 for init examples)

### Modern Alternatives

- `src/cli/scaffolding.ts` - Modern generator scaffolding
- `src/cli/cli.ts` - CLI command handlers (see `handleInitCommand`)
- `src/actions/` - Decorator-based action system

### Tests

- `tests/fixtures/metaverse/hygen-templates/_templates/init/` - Test fixtures
- `tests/scaffolding.test.ts` - Modern scaffolding tests

## Historical Context

### Origin

These templates come from **Hygen**, the original code generator that Hypergen is based on. They represent Hygen's clever solution to the "bootstrap problem" - how to create a generator system that can generate its own generators.

### Evolution

1. **Hygen (2017-2022)**: Original implementation with these exact templates
2. **Hypergen Fork**: Inherited these templates for compatibility
3. **Hypergen V8**: Introduced modern scaffolding system alongside legacy templates
4. **Current**: Legacy templates maintained for backward compatibility

### References

- Original Hygen: https://github.com/jondot/hygen
- Hygen documentation: http://www.hygen.io/
- Migration notes in `docs/` directory

## Future Considerations

### Deprecation Timeline

These templates are **not planned for removal** as they:
- Provide valuable backward compatibility
- Serve as learning resources
- Are small and low-maintenance
- Don't interfere with modern systems

### Recommendations

**For new projects**: Use modern Hypergen V8 features:
```bash
hypergen init generator --name=my-gen --framework=react
hypergen init workspace --withExamples=true
```

**For Hygen migration**: These templates ensure smooth transition:
```bash
# Works exactly like Hygen
hypergen init self
```

**For learning**: Study these templates to understand:
- Meta-templating concepts
- EJS template syntax
- Hypergen's template system architecture

## Summary

The `src/templates/` directory contains **legacy meta-templates** that enable Hypergen to bootstrap new generators and template repositories. While still functional and maintained for backward compatibility, modern Hypergen development should prefer the V8 scaffolding system (`src/cli/scaffolding.ts`) for new generator creation.

These templates serve as:
- ✅ **Compatibility layer** with Hygen
- ✅ **Learning resources** for template syntax
- ✅ **Historical artifacts** showing the system's evolution
- ⚠️ **Not primary development path** for new features

For team members working on Hypergen:
- **Use modern scaffolding** for new features
- **Maintain these templates** for compatibility
- **Reference them** when learning template mechanics
- **Test against them** when modifying core rendering engine