# Phase 5: Deprecate Hypergen Package

## Deprecation Strategy

1. **Strip packages/hypergen to minimal package**
   - Keep only: `package.json`, `README.md` with migration notice
   - Remove: all source code, all commands, all tests
   - Add `postinstall` script that prints colored migration notice

2. **package.json postinstall script:**
```json
{
  "name": "hypergen",
  "version": "9.0.0",
  "description": "⚠️ DEPRECATED: This package has moved to @hypercli/cli",
  "scripts": {
    "postinstall": "node postinstall.js"
  }
}
```

3. **postinstall.js:**
```javascript
#!/usr/bin/env node
const chalk = require('chalk')

console.log('')
console.log(chalk.red.bold('⚠️  DEPRECATION NOTICE'))
console.log('')
console.log('The ' + chalk.cyan('hypergen') + ' package has been deprecated and split into:')
console.log('')
console.log('  • ' + chalk.green('@hypercli/cli') + ' - Main CLI (install this)')
console.log('  • ' + chalk.yellow('@hypercli/core') + ' - Core types and config')
console.log('  • ' + chalk.yellow('@hypercli/kit') + ' - Kit management')
console.log('  • ' + chalk.yellow('@hypercli/gen') + ' - Generation engine')
console.log('')
console.log('To migrate:')
console.log('')
console.log(chalk.cyan('  npm uninstall hypergen'))
console.log(chalk.green('  npm install -g @hypercli/cli'))
console.log('')
console.log('Or with bun:')
console.log('')
console.log(chalk.cyan('  bun remove hypergen'))
console.log(chalk.green('  bun add -g @hypercli/cli'))
console.log('')
console.log('The new CLI uses ' + chalk.green('hyper') + ' instead of ' + chalk.red('hypergen') + ':')
console.log('')
console.log('  ' + chalk.red('hypergen') + ' run nextjs crud list  →  ' + chalk.green('hyper') + ' run nextjs crud list')
console.log('')
console.log('For more info: https://github.com/hyperdev-io/cli')
console.log('')
```

4. **README.md:**
```markdown
# hypergen → @hypercli/cli

⚠️ **This package is deprecated.**

The `hypergen` package has been split into a multi-package architecture:

- **[@hypercli/cli](https://www.npmjs.com/package/@hypercli/cli)** - Main CLI (install this)
- **[@hypercli/core](https://www.npmjs.com/package/@hypercli/core)** - Core types and config
- **[@hypercli/kit](https://www.npmjs.com/package/@hypercli/kit)** - Kit management
- **[@hypercli/gen](https://www.npmjs.com/package/@hypercli/gen)** - Generation engine

## Migration

```bash
# Uninstall old package
npm uninstall -g hypergen

# Install new CLI
npm install -g @hypercli/cli

# Use new command name
hyper run nextjs crud list
```

The command name changed from `hypergen` to `hyper`.

## Why the change?

The monolithic 32K LOC package couldn't scale to support the HyperDev vision (5+ top-level commands). The new architecture enables:

- Independent evolution of commands as oclif plugins
- Clear separation of concerns
- Better contributor experience

## Links

- [New CLI](https://github.com/hyperdev-io/cli)
- [Migration Guide](https://hyperdev.io/docs/migrating-from-hypergen)
- [Documentation](https://hyperdev.io/docs)
```

5. **npm deprecate command:**
```bash
npm deprecate hypergen "This package has moved to @hypercli/cli. See https://github.com/hyperdev-io/cli"
```

## Publish as hypergen@9.0.0

Major version bump signals breaking change. All new packages start at 1.0.0.
