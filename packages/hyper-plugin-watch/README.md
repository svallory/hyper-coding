# @hyperdev/plugin-watch

> Oclif plugin for the `hyper watch` command - The always-on agent whisperer

## Overview

`@hyperdev/plugin-watch` provides monitoring and knowledge capture capabilities for the HyperDev Toolkit. It enables real-time monitoring of agent activity, task progress, and system health while capturing everything agents learn in a local versioned vector database.

## Features

- **📊 Real-time Monitoring**: Watch file changes, agent activity, and system health
- **🧠 Knowledge Capture**: Automatically capture and store knowledge from code interactions
- **💾 Local Storage**: All data stored locally in a versioned vector database
- **🔍 Semantic Search**: Query captured knowledge using semantic search
- **📈 Status Tracking**: Monitor service health and statistics

## Installation

```bash
# Install as part of the hyper CLI
bun add @hyperdev/plugin-watch

# Or install standalone for development
cd packages/hyper-plugin-watch
bun install
```

## Commands

### `hyper watch`

Start the watch service to monitor file changes and capture knowledge.

```bash
# Monitor current directory
hyper watch

# Monitor specific path
hyper watch --path ./my-project

# Use custom database location
hyper watch --db-path ./my-knowledge-base

# Enable verbose logging
hyper watch --verbose

# Set custom polling interval
hyper watch --interval 10

# Watch specific file patterns
hyper watch --patterns "**/*.{ts,tsx,js,jsx}"
```

**Options:**
- `-p, --path <path>` - Path to monitor (default: current directory)
- `-d, --db-path <path>` - Path to local vector database (default: `./.hyper/knowledge`)
- `-v, --verbose` - Enable verbose logging
- `-i, --interval <seconds>` - Polling interval for status updates (default: 5)
- `-f, --patterns <patterns>` - File patterns to watch (default: `**/*.{ts,js,json,md,yml,yaml}`)

### `hyper watch status`

Display current watch service status and statistics.

```bash
# Show status
hyper watch status

# Show status as JSON
hyper watch status --json

# Use custom database path
hyper watch status --db-path ./my-knowledge-base
```

**Options:**
- `-d, --db-path <path>` - Path to local vector database
- `--json` - Output status as JSON

### `hyper watch query`

Query the local knowledge base using semantic search.

```bash
# Query knowledge base
hyper watch query "How does authentication work?"

# Limit results
hyper watch query "database schema" --limit 10

# Set similarity threshold
hyper watch query "API endpoints" --threshold 0.8

# Output as JSON
hyper watch query "testing" --json
```

**Arguments:**
- `query` - Search query for the knowledge base (required)

**Options:**
- `-d, --db-path <path>` - Path to local vector database
- `-l, --limit <number>` - Maximum number of results (default: 5)
- `-t, --threshold <float>` - Similarity threshold 0-1 (default: 0.7)
- `--json` - Output results as JSON

## Development

```bash
# Install dependencies
bun install

# Build the plugin
bun run build

# Type check
bun run typecheck

# Lint
bun run lint

# Clean build artifacts
bun run clean
```

## Architecture

### Services

- **WatchService**: Main orchestration service that monitors files and coordinates knowledge capture
- **KnowledgeStore**: Manages the local vector database for storing and querying knowledge

### Knowledge Capture

The plugin automatically captures knowledge from:
- File additions
- File modifications
- Code changes
- Configuration updates

Each captured piece of knowledge includes:
- Source file path
- Full content
- Timestamp
- Metadata (file type, change type, etc.)
- Vector embedding for semantic search

### Storage

All data is stored locally in JSON format with a simple vector embedding system. In production environments, this can be replaced with a proper vector database like:
- Pinecone
- Weaviate
- Qdrant
- Milvus

## Integration with Hyper CLI

This plugin is designed to be used with the main `hyper` CLI. When installed, it adds the `watch` command and subcommands to the CLI automatically through oclif's plugin system.

## License

MIT
