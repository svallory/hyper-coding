# hyper gen

Execute a recipe to generate code. Discovers recipes from installed kits, resolves recipe paths, and runs the generation pipeline.

## Usage

`hyper gen <recipe> [options]`

## Examples

```sh
# Run a local recipe
hyper gen ./my-recipe

# Run a recipe from an installed kit
hyper gen @kit/starlight/create

# Pass variables inline
hyper gen create-component --name=Button

# Provide pre-computed AI answers
hyper gen ./my-recipe --answers ./ai-answers.json

# Shorthand: kit name + recipe path
hyper nextjs crud update Organization
```
