# CodeMod Tool Documentation

The CodeMod Tool is a powerful component of Hypergen V8's Recipe Step System that provides AST-based code transformations and modifications. It supports both TypeScript/JavaScript AST manipulations using the TypeScript compiler API and text-based transformations for other file types.

## Overview

The CodeMod Tool enables developers to:
- Perform safe, automated code transformations across multiple files
- Apply AST-based changes to TypeScript/JavaScript files
- Execute text-based replacements for any file type
- Create backup files for safety and rollback capabilities
- Process files in batches using glob patterns
- Validate transformations and handle errors gracefully

## Supported CodeMod Types

### AST Transformations (TypeScript/JavaScript)

#### `add-import`
Adds import statements to TypeScript/JavaScript files.

**Parameters:**
- `import` (required): Name of the import
- `from` (required): Module to import from
- `importType` (optional): Type of import - `default`, `named`, `namespace`, `side-effect` (default: `named`)
- `alias` (optional): Alias for the import

**Examples:**
```yaml
# Default import
parameters:
  import: "React"
  from: "react"
  importType: "default"

# Named import
parameters:
  import: "useState"
  from: "react"
  importType: "named"

# Named import with alias
parameters:
  import: "Component"
  from: "react"
  importType: "named"
  alias: "ReactComponent"

# Namespace import
parameters:
  import: "React"
  from: "react"
  importType: "namespace"

# Side-effect import
parameters:
  from: "./styles.css"
  importType: "side-effect"
```

#### `add-export`
Adds export statements to TypeScript/JavaScript files.

**Parameters:**
- `export` (required): Name of the export
- `exportType` (optional): `default` or `named` (default: `named`)

**Examples:**
```yaml
# Named export
parameters:
  export: "MyComponent"
  exportType: "named"

# Default export
parameters:
  export: "App"
  exportType: "default"
```

#### `add-property`
Adds properties to classes or objects.

**Parameters:**
- `propertyName` (required): Name of the property
- `propertyValue` (required): Value of the property
- `className` OR `objectName` (required): Target class or object name
- `propertyType` (optional): Type annotation for the property

**Examples:**
```yaml
# Add property to class
parameters:
  className: "MyClass"
  propertyName: "apiVersion"
  propertyValue: "v2"
  propertyType: "string"

# Add property to object
parameters:
  objectName: "config"
  propertyName: "debug"
  propertyValue: "true"
```

#### `custom`
Execute custom transformation functions.

**Parameters:**
- `transformFunction` (required): Custom transformation function

**Example:**
```yaml
parameters:
  transformFunction: |
    function(sourceFile, context) {
      // Custom AST transformation logic
      return sourceFile;
    }
```

### Text Transformations (Any File Type)

#### `replace-text`
Performs text replacement using string or regex patterns.

**Parameters:**
- `find` (required): Text or regex pattern to find
- `replace` (required): Replacement text
- `global` (optional): Replace all occurrences (default: `false`)

**Examples:**
```yaml
# Simple text replacement
parameters:
  find: "old-api-v1"
  replace: "new-api-v2"

# Global replacement
parameters:
  find: "/api/v1/"
  replace: "/api/v2/"
  global: true

# Regex replacement (in YAML, use quotes)
parameters:
  find: "console\\.log\\([^)]*\\)"
  replace: "// console.log removed"
  global: true
```

## Recipe Configuration

### Basic Step Configuration

```yaml
steps:
  - name: "add-react-imports"
    tool: codemod
    codemod: add-import
    files:
      - "src/components/**/*.tsx"
      - "src/pages/**/*.tsx"
    parameters:
      import: "React"
      from: "react"
      importType: "default"
```

### Advanced Configuration

```yaml
steps:
  - name: "comprehensive-transformation"
    tool: codemod
    codemod: add-import
    files: ["src/**/*.ts", "src/**/*.tsx"]
    backup: true                    # Create backup files
    force: false                    # Don't force overwrite
    parser: "auto"                  # Auto-detect parser
    parameters:
      import: "React"
      from: "react"
      importType: "default"
    codemodConfig:
      transform:
        preserveFormatting: true    # Preserve original formatting
        includeComments: true       # Include comments in output
      validation:
        validateSyntax: true        # Validate syntax after transformation
        validateTypes: true         # Run TypeScript type checking
```

### Configuration Options

#### Step-Level Options

- **`files`** (required): Array of file patterns to transform
- **`backup`** (optional): Create backup files before transformation (default: `true`)
- **`force`** (optional): Force overwrite existing files (default: `false`)
- **`parser`** (optional): Parser to use - `typescript`, `javascript`, `json`, `auto` (default: `auto`)
- **`parameters`** (optional): CodeMod-specific parameters
- **`codemodConfig`** (optional): Advanced CodeMod configuration

#### CodeMod Configuration

```yaml
codemodConfig:
  transform:
    preserveFormatting: true      # Preserve original code formatting
    includeComments: true         # Include comments in transformed code
    rules: {}                     # Custom transformation rules
  validation:
    validateSyntax: true          # Validate syntax after transformation
    validateTypes: true           # Run TypeScript type checking
```

## File Patterns

The CodeMod Tool uses glob patterns to match files:

```yaml
files:
  - "src/**/*.ts"                 # All TypeScript files in src/
  - "src/**/*.tsx"                # All TypeScript React files in src/
  - "**/*.js"                     # All JavaScript files
  - "src/components/*.tsx"        # Only direct children in components/
  - "!**/*.test.ts"              # Exclude test files
  - "src/{utils,helpers}/*.ts"   # Files in utils/ or helpers/
```

## Error Handling

The CodeMod Tool provides comprehensive error handling:

### Validation Errors
- Invalid CodeMod type
- Missing required parameters
- Invalid file patterns
- Parser configuration errors

### Transformation Errors
- Syntax errors in source files
- AST parsing failures
- File permission issues
- Backup creation failures

### Error Recovery
- Automatic rollback from backup files
- Detailed error messages with suggestions
- Graceful handling of missing files
- Partial success reporting

## Safety Features

### Backup Files
```yaml
backup: true    # Creates .backup.<timestamp> files
```

### Dry Run Mode
```yaml
dryRun: true   # Preview changes without modifying files
```

### Validation
```yaml
codemodConfig:
  validation:
    validateSyntax: true    # Check syntax after transformation
    validateTypes: true     # Run TypeScript type checking
```

## Performance Optimization

### Caching
The CodeMod Tool implements several levels of caching:
- Template resolution caching
- TypeScript configuration caching
- Transformation function caching

### Batch Processing
Files are processed in batches for optimal performance:
- Parallel file reading where possible
- Efficient glob pattern matching
- Minimal memory footprint for large file sets

### Resource Management
- Automatic cleanup of temporary files
- Memory monitoring and optimization
- Resource pooling for TypeScript compiler

## Usage Examples

### Complete Recipe Example

```yaml
name: "modernize-codebase"
description: "Modernize React codebase with latest patterns"
variables:
  targetApiVersion: "v2"

steps:
  # Add React imports
  - name: "add-react-imports"
    tool: codemod
    codemod: add-import
    files: ["src/components/**/*.tsx"]
    parameters:
      import: "React"
      from: "react"
      importType: "default"

  # Update API endpoints
  - name: "update-api-endpoints"
    tool: codemod
    codemod: replace-text
    files: ["src/api/**/*.ts"]
    parameters:
      find: "/api/v1/"
      replace: "/api/{{ targetApiVersion }}/"
      global: true

  # Add TypeScript exports
  - name: "add-exports"
    tool: codemod
    codemod: add-export
    files: ["src/utils/index.ts"]
    parameters:
      export: "apiClient"
      exportType: "named"
```

### Integration with Other Tools

```yaml
steps:
  # Generate files with Template Tool
  - name: "generate-components"
    tool: template
    template: "react-component"
    
  # Apply transformations with CodeMod Tool
  - name: "add-imports"
    tool: codemod
    codemod: add-import
    files: ["{{ templateOutput }}/**/*.tsx"]
    dependsOn: ["generate-components"]
    parameters:
      import: "React"
      from: "react"
      
  # Execute custom logic with Action Tool
  - name: "custom-processing"
    tool: action
    action: "process-components"
    dependsOn: ["add-imports"]
```

## Best Practices

### File Organization
1. **Use specific patterns**: Target specific file types and directories
2. **Exclude test files**: Use `!**/*.test.*` patterns when appropriate
3. **Process in stages**: Break complex transformations into multiple steps

### Backup Strategy
1. **Always enable backups**: Set `backup: true` for important transformations
2. **Version control**: Ensure your code is committed before running transformations
3. **Test on small sets**: Test transformations on a few files first

### Performance
1. **Use specific patterns**: Avoid overly broad file patterns
2. **Enable caching**: Default caching settings are usually optimal
3. **Batch related changes**: Group related transformations together

### Error Handling
1. **Enable validation**: Use syntax and type validation when possible
2. **Handle partial failures**: Use `continueOnError` appropriately
3. **Monitor logs**: Check transformation logs for warnings

## Troubleshooting

### Common Issues

#### "No files found matching pattern"
- Check file paths and glob patterns
- Ensure working directory is correct
- Verify files exist at the specified locations

#### "Syntax errors in source file"
- Fix syntax errors before transformation
- Use text transformations for files with syntax issues
- Disable syntax validation if necessary

#### "Permission denied"
- Check file and directory permissions
- Ensure write access to target directories
- Run with appropriate user privileges

#### "Backup creation failed"
- Check available disk space
- Verify write permissions in target directory
- Consider disabling backup for read-only scenarios

### Performance Issues

#### "Transformation is slow"
- Use more specific file patterns
- Process files in smaller batches
- Enable caching (usually enabled by default)
- Consider parallel processing

#### "High memory usage"
- Process files in smaller batches
- Use streaming for large file sets
- Monitor and tune cache sizes

## API Reference

### CodeModTool Class

```typescript
class CodeModTool extends Tool<CodeModStep> {
  // Initialize the tool
  async initialize(): Promise<void>
  
  // Validate step configuration
  async validate(step: CodeModStep, context: StepContext): Promise<ToolValidationResult>
  
  // Execute the transformation
  async execute(step: CodeModStep, context: StepContext, options?: StepExecutionOptions): Promise<StepResult>
  
  // Clean up resources
  async cleanup(): Promise<void>
}
```

### CodeModParameters Interface

```typescript
interface CodeModParameters {
  // Add Import parameters
  import?: string
  from?: string
  importType?: 'default' | 'named' | 'namespace' | 'side-effect'
  alias?: string
  
  // Add Export parameters
  export?: string
  exportType?: 'default' | 'named'
  
  // Add Property parameters
  className?: string
  objectName?: string
  propertyName?: string
  propertyValue?: string
  propertyType?: string
  
  // Replace Text parameters
  find?: string | RegExp
  replace?: string
  global?: boolean
  
  // Custom transformation
  transformFunction?: string | ((sourceFile: ts.SourceFile, context: CodeModContext) => ts.SourceFile)
}
```

## Contributing

To extend the CodeMod Tool with new transformation types:

1. **Add transformation type**: Update the `CodeModType` union type
2. **Implement transformation**: Add the transformation logic to `CodeModTransformations`
3. **Add validation**: Update parameter validation for the new type
4. **Write tests**: Add comprehensive tests for the new transformation
5. **Update documentation**: Document the new transformation type and parameters

For more information about contributing, see the [CONTRIBUTING.md](../CONTRIBUTING.md) file.