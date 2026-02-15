# CLI DX Patterns - Quick Reference

Extracted from research of 9 modern CLIs. Copy-paste patterns for common scenarios.

---

## Command Structure

### Hierarchical Model (Recommended)
```bash
hypergen <noun> <verb> [args] [--flags]

# Examples:
hypergen kit install lodash-kit
hypergen kit list --all
hypergen recipe run todo-crud --environment=production
hypergen recipe validate --fix
hypergen cookbook list --json
```

### vs. Flat Model (Not Recommended)
```bash
hypergen install-kit lodash-kit
hypergen list-kits --all
hypergen run-recipe todo-crud
```

**Why hierarchical wins**:
- Scales naturally (can add 100s of commands)
- Commands self-organize into categories
- Easier to discover related commands
- Matches user mental models

---

## Error Messages

### Template Structure
```typescript
throw new CliError({
  message: 'What went wrong (one sentence)',
  code: 'ERROR_CODE',
  context: {
    received: userInput,
    expected: validInput,
  },
  suggestions: [
    'First thing to try',
    'Second thing to try',
  ],
  docsLink: 'https://docs/errors/ERROR_CODE'
})

// Output:
// ✗ Kit "my-kit" not found
//
// Available kits:
// → hypergen kit list
//
// Did you mean:
// → hypergen kit install
// → hypergen kit search my-kit
//
// Docs: https://docs/errors/KIT_NOT_FOUND
```

### Implementation Pattern
```typescript
class CliError extends Error {
  constructor(config: {
    message: string
    code: string
    context?: Record<string, any>
    suggestions?: string[]
    docsLink?: string
  }) {
    super(config.message)
    this.code = config.code
    this.context = config.context
    this.suggestions = config.suggestions || []
    this.docsLink = config.docsLink
  }

  format(): string {
    let output = `✗ ${this.message}\n`

    if (this.context) {
      output += `\nContext:\n`
      Object.entries(this.context).forEach(([key, value]) => {
        output += `  ${key}: ${value}\n`
      })
    }

    if (this.suggestions.length > 0) {
      output += `\nTry:\n`
      this.suggestions.forEach(s => {
        output += `  → ${s}\n`
      })
    }

    if (this.docsLink) {
      output += `\nDocs: ${this.docsLink}\n`
    }

    return output
  }
}
```

### Common Error Scenarios

#### Missing Required Argument
```
✗ Recipe name is required

Usage:
  hypergen recipe run <recipe-name> [options]

Examples:
  hypergen recipe run crud-generator
  hypergen recipe run todo-app --kit nextjs-kit

Docs: https://docs/recipe/run
```

#### Invalid Configuration
```
✗ Invalid configuration in .hypergen/config.json

Error:
  → Line 5: "environment" must be one of: development, staging, production

Fix:
  → hypergen config set environment production
  → Or edit .hypergen/config.json manually

Docs: https://docs/config/reference
```

#### Resource Not Found
```
✗ Kit "my-kit" not found (searched: npm, local, git)

Available kits:
  → nextjs-kit (↓ 12.3K)
  → react-kit (↓ 8.2K)
  → node-kit (↓ 6.1K)

Search more:
  → hypergen kit search my

Install:
  → hypergen kit install my-kit --from=github:user/repo
```

#### Authentication Error
```
✗ Not authenticated

You need to authenticate to use this feature.

Authenticate:
  → hypergen auth login
  → hypergen auth login --token=your_token

Status:
  → hypergen auth status

Docs: https://docs/auth/getting-started
```

#### Network Timeout (with retry)
```
⟳ Connecting to deployment service...
✗ Connection timeout after 30 seconds (attempt 3/3)

Your network might be slow or down.

Try:
  → hypergen recipe run todo-app --retry=5
  → hypergen recipe run todo-app --verbose (for details)
  → Check: https://status.hypergen.dev

Docs: https://docs/troubleshooting/network
```

---

## Help System

### Progressive Disclosure Pattern

#### Global Help
```bash
$ hypergen --help
Usage: hypergen [command] [options]

Commands:
  kit      Manage kits
  recipe   Execute recipes
  cookbook Explore cookbooks
  config   Manage configuration
  auth     Manage authentication
  help     Show help for command

Options:
  --help, -h       Show help
  --version, -v    Show version
  --debug          Enable debug output
  --json           JSON output format

Examples:
  hypergen kit install nextjs-kit
  hypergen recipe run crud --environment=prod
  hypergen config list

Learn more: hypergen --help <command>
```

#### Command Help
```bash
$ hypergen recipe --help
Usage: hypergen recipe [subcommand] [options]

Subcommands:
  run       Execute a recipe
  list      List available recipes
  validate  Validate a recipe
  info      Show recipe details

Options:
  --json              Output as JSON
  --verbose           Show detailed output
  --dry-run           Preview without executing

Examples:
  hypergen recipe run todo-app
  hypergen recipe run todo-app --kit=nextjs-kit
  hypergen recipe list --json

Learn more: hypergen recipe <subcommand> --help
```

#### Subcommand Help
```bash
$ hypergen recipe run --help
Usage: hypergen recipe run <recipe-name> [options]

Arguments:
  <recipe-name>        Name of recipe to run

Options:
  --kit=KIT            Specify kit (auto-detected if unspecified)
  --environment=ENV    Environment: development, staging, production
  --variables=JSON     Pass variables as JSON
  --dry-run            Preview without executing
  --verbose            Show detailed output
  --json               Output as JSON

Examples:
  hypergen recipe run todo-app
  hypergen recipe run todo-app --kit=nextjs-kit
  hypergen recipe run todo-app --environment=production
  hypergen recipe run crud --variables='{"name":"User"}'
  hypergen recipe run todo-app --dry-run

Docs: https://docs/recipe/run
Learn more: hypergen --help
```

### Implementation Pattern
```typescript
// In command handler
program
  .command('recipe run <name>')
  .description('Execute a recipe')
  .option('--kit <kit>', 'Specify kit')
  .option('--environment <env>', 'Environment')
  .option('--dry-run', 'Preview without executing')
  .option('--json', 'JSON output')
  .addHelpText('after', `
Examples:
  hypergen recipe run todo-app
  hypergen recipe run todo-app --kit=nextjs-kit
  hypergen recipe run crud --environment=production

Documentation:
  https://docs/recipe/run
  `)
  .action(async (name, options) => {
    // Command logic
  })
```

---

## Configuration Hierarchy

### Cascade Pattern
```typescript
// Precedence (highest to lowest):
const config = {
  ...defaults,
  ...userConfig,        // ~/.hypergen/config.json
  ...projectConfig,     // .hypergen/config.json
  ...envVars,          // HYPERGEN_* env vars
  ...cliFlags,         // --kit, --environment, etc.
}

// Implementation
import cosmiconfig from 'cosmiconfig'

const userExplorer = cosmiconfig('hypergen', {
  searchPlaces: ['~/.hypergen/config.json']
})

const projectExplorer = cosmiconfig('hypergen', {
  searchPlaces: ['.hypergen/config.json', '.hypergen.json']
})

async function loadConfig(cliFlags) {
  // Start with defaults
  let config = { ...DEFAULT_CONFIG }

  // Merge user config
  const userResult = await userExplorer.search()
  if (userResult?.config) {
    config = { ...config, ...userResult.config }
  }

  // Merge project config (overrides user)
  const projectResult = await projectExplorer.search()
  if (projectResult?.config) {
    config = { ...config, ...projectResult.config }
  }

  // Merge environment variables (override files)
  if (process.env.HYPERGEN_KIT) {
    config.kit = process.env.HYPERGEN_KIT
  }

  // Merge CLI flags (highest priority)
  if (cliFlags.kit) {
    config.kit = cliFlags.kit
  }

  return config
}
```

### Configuration File Format
```json
{
  "kit": "nextjs-kit",
  "environment": "development",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "variables": {
    "projectName": "my-app"
  },
  "extends": "~/.hypergen/default.json"
}
```

---

## Visual Feedback

### Spinner Pattern
```typescript
import ora from 'ora'

const spinner = ora('Loading configuration').start()

try {
  await loadConfig()
  spinner.succeed('Configuration loaded')
} catch (err) {
  spinner.fail(`Configuration error: ${err.message}`)
  throw err
}
```

### Progress Bar Pattern
```typescript
import cliProgress from 'cli-progress'

const bar = new cliProgress.SingleBar({
  format: '├─ {bar} {percentage}% || {value}/{total} files',
  hideCursor: true,
  stopOnComplete: true
})

bar.start(files.length, 0)

for (const file of files) {
  await processFile(file)
  bar.increment()
}

bar.stop()
console.log('✓ Done!')
```

### Color Output Pattern
```typescript
import chalk from 'chalk'

console.log(chalk.green('✓ Success!'))
console.log(chalk.red('✗ Error occurred'))
console.log(chalk.yellow('⚠ Warning'))
console.log(chalk.blue('ℹ Information'))
console.log(chalk.bold('Important'))
console.log(chalk.dim('Subtle hint'))

// Respect NO_COLOR
const noColor = process.env.NO_COLOR === '1'
if (noColor) {
  chalk.enable = false
}
```

### Combined Pattern
```typescript
import ora from 'ora'
import chalk from 'chalk'

async function executeRecipe(name, options) {
  const spinner = ora()

  try {
    spinner.start(chalk.blue('ℹ Loading recipe'))
    const recipe = await loadRecipe(name)
    spinner.succeed(chalk.green(`✓ Recipe loaded (${recipe.steps.length} steps)`))

    spinner.start(chalk.blue('ℹ Executing recipe'))
    const results = await runRecipe(recipe)
    spinner.succeed(chalk.green(`✓ Recipe completed`))

    // Summary
    console.log('')
    console.log(chalk.bold('Summary:'))
    console.log(`  ✓ ${results.success} steps completed`)
    console.log(`  ✗ ${results.failed} steps failed`)

  } catch (err) {
    spinner.fail(chalk.red(`✗ ${err.message}`))
    if (options.verbose) {
      console.log(chalk.dim(err.stack))
    }
    throw err
  }
}
```

---

## Context Detection

### Auto-Detection Pattern
```typescript
import findUp from 'find-up'
import path from 'path'

async function detectContext() {
  // Look for project markers (in order of priority)
  const markers = [
    '.hypergen/config.json',
    '.hypergen.json',
    'recipe.yml',
    'kit.yml',
    '.git'
  ]

  for (const marker of markers) {
    const found = await findUp(marker)
    if (found) {
      const projectRoot = path.dirname(found)
      return {
        projectRoot,
        hasConfig: marker.includes('config'),
        configFile: found
      }
    }
  }

  return {
    projectRoot: process.cwd(),
    hasConfig: false,
    configFile: null
  }
}

// Store context
async function saveContext(kit, environment) {
  const { projectRoot } = await detectContext()
  const contextFile = path.join(projectRoot, '.hypergen/context.json')

  await fs.mkdir(path.dirname(contextFile), { recursive: true })
  await fs.writeFile(contextFile, JSON.stringify({
    kit,
    environment,
    savedAt: new Date().toISOString()
  }, null, 2))
}
```

### Display Detected Context
```bash
$ hypergen recipe run todo-app

Detected context:
  Project root: /Users/name/my-app
  Kit: nextjs-kit
  Environment: development

To change:
  → hypergen config set kit react-kit
  → hypergen config set environment production

Executing...
```

---

## Interactive Prompts

### Basic Pattern
```typescript
import enquirer from 'enquirer'

async function getRequiredInputs(recipe, cliOptions) {
  const questions = []

  if (!cliOptions.kit) {
    questions.push({
      type: 'select',
      name: 'kit',
      message: 'Which kit?',
      choices: await listAvailableKits(),
      hint: 'Use arrow keys, type to filter'
    })
  }

  if (!cliOptions.environment) {
    questions.push({
      type: 'select',
      name: 'environment',
      message: 'Which environment?',
      choices: ['development', 'staging', 'production'],
      initial: 'development'
    })
  }

  // Only prompt if needed
  if (questions.length === 0) {
    return cliOptions
  }

  const answers = await enquirer.prompt(questions)
  return { ...cliOptions, ...answers }
}
```

### Smart Defaults Pattern
```typescript
// Use context to provide smart defaults
async function promptWithContext(recipe) {
  const { kit, environment } = await detectContext()

  const answers = await enquirer.prompt([
    {
      type: 'select',
      name: 'kit',
      message: 'Which kit?',
      choices: await listKits(),
      initial: kit || 0,  // Smart default from context
      hint: 'Press space to select, enter to confirm'
    }
  ])

  return answers
}
```

### Graceful Fallback
```typescript
// If prompting fails (CI environment), use defaults
async function getInputs(recipe, cliOptions) {
  const isCI = process.env.CI === 'true'

  if (isCI) {
    // In CI, fail if required info missing
    if (!cliOptions.kit) {
      throw new CliError({
        message: 'Kit is required (cannot prompt in CI)',
        code: 'MISSING_REQUIRED_INPUT',
        suggestions: [
          'hypergen recipe run todo-app --kit=nextjs-kit',
          'Set HYPERGEN_KIT=nextjs-kit'
        ]
      })
    }
    return cliOptions
  }

  // Interactive in terminal
  return getRequiredInputs(recipe, cliOptions)
}
```

---

## Retry Logic

### Exponential Backoff Pattern
```typescript
async function withRetry(fn, options = {}) {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoffMultiplier = 2,
    shouldRetry = () => true
  } = options

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === maxAttempts || !shouldRetry(err)) {
        throw err
      }

      const delay = delayMs * Math.pow(backoffMultiplier, attempt - 1)
      console.log(`Retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

// Usage
const recipe = await withRetry(
  () => fetchRecipe(name),
  {
    maxAttempts: 3,
    delayMs: 1000,
    shouldRetry: (err) => err.code !== 'NOT_FOUND'  // Don't retry 404s
  }
)
```

### Smart Retry Messaging
```typescript
try {
  await withRetry(loadRecipe)
} catch (err) {
  if (err.code === 'ECONNREFUSED') {
    throw new CliError({
      message: 'Could not connect to recipe service',
      suggestions: [
        'Check your internet connection',
        'Increase retry attempts: --retry=5',
        'Increase timeout: --timeout=60000'
      ]
    })
  }
  throw err
}
```

---

## Output Formats

### JSON Output Pattern
```typescript
// Add --json flag to command
program
  .command('recipe list')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const recipes = await listRecipes()

    if (options.json) {
      console.log(JSON.stringify(recipes, null, 2))
    } else {
      recipes.forEach(r => {
        console.log(`  ${r.name} (${r.steps.length} steps)`)
      })
    }
  })
```

### Piping-Safe Output
```typescript
function shouldFormatOutput() {
  return process.stdout.isTTY !== false
}

if (shouldFormatOutput()) {
  // Use colors, spinners, formatted output
  console.log(chalk.green('✓ Success'))
} else {
  // Plain text for piping
  console.log('SUCCESS')
}
```

### CSV Output Pattern
```typescript
import { stringify } from 'csv-stringify'

async function listRecipesAsCSV() {
  const recipes = await listRecipes()
  const output = stringify(
    recipes.map(r => ({
      name: r.name,
      kit: r.kit,
      steps: r.steps.length,
      updated: r.updated
    })),
    { header: true }
  )
  console.log(output)
}
```

---

## Testing Error Handling

### Test Template
```typescript
describe('CLI Errors', () => {
  it('should show helpful error when kit not found', async () => {
    const { stdout } = await exec('hypergen kit install unknown-kit')

    expect(stdout).toContain('Kit "unknown-kit" not found')
    expect(stdout).toContain('Available kits:')
    expect(stdout).toContain('hypergen kit list')
    expect(stdout).toContain('hypergen kit search')
  })

  it('should suggest context when config missing', async () => {
    // Remove config
    await fs.remove('.hypergen/config.json')

    const { stdout } = await exec('hypergen recipe run todo')

    expect(stdout).toContain('Configuration required')
    expect(stdout).toContain('hypergen config set')
  })
})
```

---

## Common Mistakes to Avoid

### ✗ Don't
```typescript
// Silent failures
if (!found) return

// Generic errors
throw new Error('Error')

// Output clutter on success
console.log('Config loaded')
console.log('Auth token set')
console.log('Project initialized')
console.log('Success!')

// Colors when piped
console.log(chalk.green('Done'))  // Breaks piped output
```

### ✓ Do
```typescript
// Explicit error handling
if (!found) {
  throw new CliError({
    message: 'Configuration file not found',
    suggestions: ['Run: hypergen init']
  })
}

// Specific errors
throw new CliError({
  message: 'Failed to authenticate',
  code: 'AUTH_FAILED'
})

// Minimal success output
console.log('✓ Ready to run recipes')  // One line summary

// Conditional colors
const msg = shouldFormat() ? chalk.green('Done') : 'Done'
console.log(msg)
```

---

## Resources

- oclif: Framework for building CLIs in TypeScript
- chalk: Colors for terminal output
- ora: Spinners for terminal
- enquirer: Interactive prompts
- commander: Command routing (simpler alternative to oclif)
- cli-table3: ASCII tables
- cli-spinners: Spinner animations
- boxen: Draw boxes in terminal

