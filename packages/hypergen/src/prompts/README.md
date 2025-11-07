# Interactive Prompts Module

## Overview

The `prompts` module provides a comprehensive interactive prompting system for Hypergen's code generation workflow. It enables beautiful, user-friendly CLI prompts when template parameters and action arguments are missing or incomplete. This module uses **@clack/prompts** to deliver modern, accessible terminal UIs with support for text input, confirmations, single/multi-select dropdowns, and custom validation.

### Core Purpose

When users run Hypergen commands without providing all required parameters, the system automatically prompts them interactively instead of failing. This creates a guided, conversational experience for code generation while maintaining full programmatic control over the process.

## Key Files and Purposes

### `interactive-prompts.ts`

The main module containing all prompt-related functionality.

#### Exports

**Main Class: `InteractivePrompter`**
- Primary class for managing interactive parameter collection
- Handles prompt lifecycle, validation, and error management
- Supports customizable UI messages (intro/outro)
- Implements timeouts and cancellation handling

**Function: `performInteractivePrompting()`**
- Lower-level utility function for generic prompt execution
- Designed for flexible use cases beyond template parameter prompting
- Supports raw prompt configurations with custom validation

**Interfaces:**

- **`PromptOptions`** - Configuration for prompt behavior
  - `interactive`: Enable/disable interactive mode (default: true)
  - `skipOptional`: Skip optional parameters (default: false)
  - `timeout`: Timeout in milliseconds (default: 300000 / 5 minutes)
  - `intro`: Custom intro message
  - `outro`: Custom outro message

- **`PromptResult`** - Return value from prompting operations
  - `completed`: Whether user successfully completed prompts
  - `cancelled`: Whether user cancelled operation
  - `values`: Resolved parameter values
  - `errors`: Validation or processing errors

## Architecture and Design Patterns

### Class Structure: `InteractivePrompter`

```
InteractivePrompter
├── promptForParameters()         [Main Public API]
│   ├── getMissingParameters()    [Private]
│   ├── createPrompts()           [Private]
│   ├── createPromptForVariable() [Private]
│   ├── validateParameters()      [Private]
│   └── [Error handling & timeout management]
├── Input Type Handlers
│   ├── String inputs (text, pattern, length validation)
│   ├── Number inputs (numeric parsing, min/max)
│   ├── Boolean inputs (confirm prompts)
│   ├── Enum inputs (single/multi-select detection)
│   └── Array inputs (comma-separated parsing)
└── Static Utility Methods
    ├── confirm()                 [Simple y/n prompt]
    ├── text()                    [Text input helper]
    ├── select()                  [Single select helper]
    ├── multiselect()             [Multi-select helper]
    ├── createSpinner()           [Progress indicator]
    └── [Various logging methods] [note, log, error, warn, success, info]
```

### Design Patterns Used

1. **Single Responsibility**: Each validation method handles one type (string, number, enum, etc.)
2. **Private/Public Separation**: Complex internal logic hidden from consumers
3. **Composition**: Uses @clack/prompts library as the underlying UI engine
4. **Type Safety**: Full TypeScript support with strong typing throughout
5. **Error Handling**: Comprehensive try-catch with user-friendly error messages
6. **Cancellation Support**: Graceful handling of user-initiated cancellations
7. **Stateless Design**: No instance state between prompting calls

### Key Design Decisions

- **Multi-select Detection Heuristics**: Automatically detects multi-select enums based on:
  - Parameter name patterns (`methods`, `tags`, `features`, `options`)
  - Default value being an array
  - Avoids forcing users to specify multi-vs-single manually

- **Timeout Strategy**: Race between prompts and timeout promise ensures timeouts are enforced without hanging

- **Validation Layers**: Both input-level validation (during typing) and complete validation (after submission)

- **Parameter Filtering**: Missing parameter detection respects:
  - Required vs optional parameters
  - `skipOptional` flag for batch operations
  - Already-provided values
  - Default values

## How the Code Works

### Main Flow: Parameter Prompting

```
promptForParameters(variables, providedValues, options)
    ↓
1. Validate options and merge with defaults
    ↓
2. Check if interactive mode is enabled
    ↓
3. Identify missing parameters:
   - Skip parameters that are provided
   - Filter required vs optional based on skipOptional flag
    ↓
4. If missing parameters exist:
   a) Display intro message
   b) Create prompt definitions for each missing parameter
   c) Race prompts against timeout promise
   d) Handle cancellation (process.exit(0))
    ↓
5. Validate all resolved parameters:
   - Type checking
   - Pattern matching
   - Min/max constraints
   - Enum value validation
    ↓
6. Return PromptResult with:
   - completed status
   - cancelled flag
   - resolved values
   - any validation errors
    ↓
7. Display outro message
```

### Input Processing Pipeline

For each variable type:

1. **String Variables**
   - Use `p.text()` for input
   - Apply pattern regex validation
   - Check min/max length constraints
   - Show placeholder with default value

2. **Number Variables**
   - Use `p.text()` for input (numeric type in @clack)
   - Parse to number with `Number()`
   - Validate against min/max bounds
   - Show default as placeholder

3. **Boolean Variables**
   - Use `p.confirm()` for y/n dialog
   - Set initial value from default
   - Returns true/false directly

4. **Enum Variables** (Smart Single/Multi-select)
   - Detect multi-select when:
     - Default is array: `Array.isArray(variable.default)`
     - Parameter name matches patterns: `methods`, `tags`, `features`, `options`
   - **Multi-select**: `p.multiselect()` with array result
   - **Single-select**: `p.select()` with single value result
   - Both show enum-specific hints (GET → "Retrieve data", etc.)

5. **Array Variables**
   - Use `p.text()` with comma-separated input
   - Split and trim items
   - Parse back into array
   - Validate count against min/max

### Validation System

**Input-level validation** (during typing):
```typescript
validate: (value) => {
  if (required && !value) return 'This field is required'
  if (pattern && !regex.test(value)) return 'Must match pattern: ...'
  if (value.length < min) return 'Must be at least ... characters'
  return undefined // valid
}
```

**Complete validation** (after all prompts submitted):
```typescript
validateParameters(variables, values)
├── Check each value against variable definition
├── Type validation
├── Pattern/regex validation
├── Min/max bounds validation
├── Enum value verification
└── Return { valid: boolean; errors: string[] }
```

### Hint Generation

Variables display context hints to users:
- String: Pattern, length constraints, defaults
- Number: Min/max values, defaults
- Enum: Common hints for standard values:
  - HTTP methods: `GET` → "Retrieve data"
  - Frameworks: `react` → "React framework"
  - Sizes: `small` → "Small size variant"
  - Boolean: `true` → "Enable feature"

## How to Contribute/Work with This Code

### Adding New Parameter Types

1. **Extend `createPromptForVariable()` switch statement**:
   ```typescript
   case 'custom-type':
     return p.text({
       message,
       placeholder: variable.default?.toString(),
       validate: (value) => this.validateCustomInput(value, variable)
     })
   ```

2. **Add validation in `validateCustomInput()` method**
3. **Add validation in complete `validateParameters()` switch**
4. **Write tests in `tests/prompts.test.ts`**

### Customizing Prompts

**Via Options:**
```typescript
const prompter = new InteractivePrompter()
const result = await prompter.promptForParameters(
  variables,
  providedValues,
  {
    interactive: true,
    skipOptional: false,
    timeout: 60000,
    intro: 'Custom intro message',
    outro: 'Custom outro message'
  }
)
```

**Via Parameter Hints:**
- Add `description` field to variables for prompt message
- Use `pattern` for regex validation hints
- Set `default` for pre-filled values
- Define `min`/`max` for constraint hints

### Testing Prompts

```typescript
import { InteractivePrompter } from '../src/prompts/interactive-prompts'
import { TemplateVariable } from '../src/config/template-parser'

const prompter = new InteractivePrompter()
const variables: Record<string, TemplateVariable> = {
  name: { type: 'string', required: true }
}

// Test with interactive disabled
const result = await prompter.promptForParameters(
  variables,
  { name: 'MyComponent' }, // provided value
  { interactive: false } // disable prompts for testing
)
```

### Static Utility Methods

For simple one-off prompts:

```typescript
// Confirmation
const confirm = await InteractivePrompter.confirm('Continue?')

// Text input
const name = await InteractivePrompter.text('Enter name:', 'placeholder')

// Selection
const framework = await InteractivePrompter.select('Choose framework:', [
  { value: 'react', label: 'React' },
  { value: 'vue', label: 'Vue' }
])

// Multi-select
const features = await InteractivePrompter.multiselect('Select features:', [
  { value: 'auth', label: 'Authentication' },
  { value: 'logging', label: 'Logging' }
])

// Logging
InteractivePrompter.note('Important note', 'Title')
InteractivePrompter.success('Operation succeeded!')
InteractivePrompter.error('Something went wrong!')
```

## Dependencies and Module Relationships

### Direct Dependencies

- **@clack/prompts** `^0.11.0`
  - Modern, accessible CLI prompting library
  - Replaces older enquirer/inquirer solutions
  - Provides text, confirm, select, multiselect primitives
  - Type-safe with good TypeScript support

- **../config/template-parser.ts**
  - `TemplateVariable` interface: Defines parameter metadata
  - `TemplateParser` class: Validates variable values
  - Used for converting parameters to prompts

- **../errors/hypergen-errors.ts**
  - `ErrorHandler` and `ErrorCode` for error handling
  - Not currently used in prompts module but available

- **timers/promises** (Node.js built-in)
  - `setTimeout` from promises for timeout implementation
  - Enables race condition pattern for timeout enforcement

### Consumer Modules

**Modules that depend on this:**

1. **src/actions/parameter-resolver.ts**
   - Imports `InteractivePrompter` and `PromptOptions`
   - Uses `promptForParameters()` to resolve action parameters
   - Converts `ActionParameter` to `TemplateVariable` format
   - Main integration point for parameter collection

2. **src/recipe-engine/recipe-engine.ts**
   - Imports `performInteractivePrompting()`
   - Uses for prompting missing recipe variables
   - Handles prompt type mapping for recipe system
   - Lower-level prompting for V8 recipe steps

3. **src/cli/cli.ts**
   - Indirect consumer via parameter resolver
   - Part of execution pipeline for actions and recipes

### Related Type Systems

- **`TemplateVariable`** (from template-parser)
  ```typescript
  {
    type: 'string' | 'number' | 'boolean' | 'enum' | 'array' | ...
    required?: boolean
    default?: any
    description?: string
    pattern?: string
    values?: string[] // for enums
    min?: number
    max?: number
  }
  ```

- **`ActionParameter`** (from actions/types)
  - Similar to TemplateVariable but action-specific
  - Converted to TemplateVariable via `convertParameterToVariable()`

## Important Implementation Details

### Timeout Handling

Uses JavaScript Promise race pattern:
```typescript
const timeoutPromise = opts.timeout 
  ? setTimeout(opts.timeout).then(() => { throw new Error('Prompt timeout') }) 
  : new Promise(() => {}) // Never resolves

const promptsPromise = this.createPrompts(missingParams, variables)
await Promise.race([promptsPromise, timeoutPromise])
```

**Why this approach:**
- Doesn't hang indefinitely
- Allows graceful error handling with try-catch
- Timeout is enforced regardless of @clack/prompts behavior

### Cancellation Handling

Uses @clack/prompts cancellation detection:
```typescript
if (p.isCancel(promptResults)) {
  p.cancel('Operation cancelled')
  result.cancelled = true
  return result // Don't throw, return cancelled state
}
```

**Special handling in static methods:**
- Static helpers like `confirm()` call `process.exit(0)` on cancel
- Instance method `promptForParameters()` returns cancelled flag

### Parameter Precedence

Strictly enforced order:
1. **Explicitly provided values** (highest priority) - must be valid
2. **Default values** - only applied if --defaults flag used
3. **Interactive prompts** - for remaining missing values
4. Validation happens at each stage

### Multi-select Detection Logic

Auto-detects when enum should be multi-select:
```typescript
const isMultiSelect = 
  Array.isArray(variable.default) ||  // Explicit array default
  name.toLowerCase().includes('methods') ||
  name.toLowerCase().includes('tags') ||
  name.toLowerCase().includes('features') ||
  name.toLowerCase().includes('options')
```

This provides good UX without requiring explicit configuration.

### Enum Value Hints

Pre-defined hints for common enum values:
```typescript
const hints: Record<string, string> = {
  'GET': 'Retrieve data',
  'POST': 'Create new resource',
  'react': 'React framework',
  'vue': 'Vue.js framework',
  // ... etc
}
```

Falls back to undefined if no hint found.

## Performance Considerations

- **Lazy initialization**: No heavy operations until prompts are needed
- **Stateless design**: No memory accumulation across calls
- **Timeout default**: 5 minutes balances between interactive use and batch operations
- **Early exit**: Cancellation immediately exits without waiting for remaining operations
- **String parsing**: Validation-on-type instead of deferred validation

## Security Considerations

- **No code execution**: User input is never evaluated or executed
- **Type coercion**: Input is strictly typed via validators
- **Pattern validation**: Regex patterns prevent injection-like attacks
- **Defaults only from config**: Defaults come from template config, not external input
- **Process.exit on cancel**: Ensures clean termination without hanging

## Future Enhancement Opportunities

1. **File/Directory Pickers**: Special handling for file/directory type variables
2. **Conditional Prompts**: Skip prompts based on previous answers
3. **Custom Validators**: Allow template authors to define custom validation functions
4. **Progress Indication**: Show progress for long-running template generation
5. **Keyboard Shortcuts**: Custom keybindings for power users
6. **History/Suggestions**: Suggest previous values or common patterns
7. **Batch Mode**: Non-interactive mode with strict validation
8. **Prompt Caching**: Remember user choices across sessions
9. **Accessibility**: Enhanced screen reader support beyond @clack/prompts defaults

## TODO

-   [ ] **Interactive Prompter (`interactive-prompts.ts`)**:
    *   Enhance `file` and `directory` prompt types with file/directory pickers.
    *   Implement custom validators for template authors.
    *   Implement progress indication for long-running template generation.
    *   Implement keyboard shortcuts for power users.
    *   Implement prompt caching to remember user choices across sessions.
    *   Implement enhanced screen reader support.