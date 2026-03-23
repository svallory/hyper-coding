# hyper recipe

Recipes are the core unit of code generation in Hyper. A recipe is a YAML workflow that describes what files to create, what templates to render, and what prompts to ask the user. Recipes live inside kits and can be run directly or composed into cookbooks.

## Usage

`hyper recipe <command>`

## Quick Start

```sh
# List all recipes available from installed kits
hyper recipe list

# Run a recipe by path
hyper recipe run my-recipe.yml --name=Button

# Validate a recipe without running it
hyper recipe validate my-recipe.yml
```

## Shorthand Syntax

When a kit is installed, you can run its recipes without the `recipe run` prefix:

```sh
# These are equivalent
hyper recipe run nextjs/crud --entity=Post
hyper nextjs crud --entity=Post
```

Run `hyper recipe <command> --help` for details on any subcommand.
