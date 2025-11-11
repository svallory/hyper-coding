# @hyper-coding/cli

HyperDev CLI - A unified command-line interface for HyperDev tools

## Installation

```bash
bun add -g @hyper-coding/cli
```

## Usage

```bash
hyper [COMMAND]
```

## Commands

### `hyper version`

Display version information

```bash
hyper version
hyper version --verbose  # Show detailed version info
```

### `hyper gen`

Generate code from templates using Hypergen

```bash
hyper gen component MyComponent
hyper gen --help
```

### `hyper help`

Display help information

```bash
hyper help
hyper help gen
```

## Development

### Build

```bash
bun run build
```

### Test

```bash
bun run test
```

## License

MIT
