/**
 * Main command for executing recipes
 * Usage: hypergen run <recipe> [options]
 * Or shorthand: hypergen <kit> <recipe-path>
 */

import fs from 'node:fs'
import path from 'node:path'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../lib/base-command.js'
import { AiCollector } from '../ai/ai-collector.js'
import { PromptAssembler } from '../ai/prompt-assembler.js'

export default class Run extends BaseCommand<typeof Run> {
  static override description = 'Execute a recipe to generate code'

  static override examples = [
    '<%= config.bin %> run ./my-recipe',
    '<%= config.bin %> run @hyper-kits/starlight/create',
    '<%= config.bin %> run create-component --name=Button',
    '<%= config.bin %> run ./my-recipe --answers ./ai-answers.json',
    '<%= config.bin %> run crud edit-page --model=Organization',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    dry: Flags.boolean({
      description: 'Show what would be generated without writing files',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing files',
      default: false,
    }),
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip confirmation prompts',
      default: false,
    }),
    answers: Flags.file({
      description: 'Path to AI answers JSON file (2-pass generation)',
    }),
    'prompt-template': Flags.file({
      description: 'Path to a custom Jig template for the AI prompt document',
    }),
  }

  static override args = {
    recipe: Args.string({
      description: 'Recipe to execute (path, package, or cookbook/recipe)',
      required: true,
    }),
  }

  static override strict = false

  async run(): Promise<void> {
    const { args, flags, argv } = await this.parse(Run)

    // Resolve recipe path - handle cookbook/recipe syntax
    const recipePath = await this.resolveRecipePath(args.recipe, argv as string[], flags.cwd)
    const params = this.parseParameters(argv as string[])

    // Load AI answers if provided (Pass 2)
    let answers: Record<string, any> | undefined
    if (flags.answers) {
      try {
        const content = fs.readFileSync(flags.answers, 'utf-8')
        answers = JSON.parse(content)
      } catch (error) {
        this.error(`Failed to load answers file: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Initialize AiCollector for Pass 1 if no answers provided
    const collector = AiCollector.getInstance()
    collector.clear()
    if (!answers) {
      collector.collectMode = true
    }

    if (answers) {
      this.log(`Executing recipe: ${recipePath}`)
    }

    if (flags.dry) {
      this.log('(dry run - no files will be written)')
    }

    try {
      const result = await this.recipeEngine.executeRecipe(
        { type: 'file', path: recipePath },
        {
          variables: params,
          workingDir: flags.cwd,
          dryRun: flags.dry,
          force: flags.force,
          answers,
        }
      )

      // Check if Pass 1 collected any AI entries
      if (collector.collectMode && collector.hasEntries()) {
        const assembler = new PromptAssembler()
        const originalCommand = ['hypergen', 'run', recipePath, ...process.argv.slice(3).filter(a => a !== '--answers' && !a.endsWith('.json'))].join(' ')
        const promptTemplatePath = flags['prompt-template'] || this.hypergenConfig?.ai?.promptTemplate
        const prompt = assembler.assemble(collector, {
          originalCommand,
          answersPath: './ai-answers.json',
          promptTemplate: promptTemplatePath,
        })

        // Write prompt to stdout
        process.stdout.write(prompt)
        collector.clear()
        this.exit(2)
        return
      }

      collector.clear()

      if (result.success) {
        this.log(`\n✓ Recipe completed successfully`)
        this.log(`  Steps completed: ${result.metadata.completedSteps}`)
        if (result.filesCreated.length > 0) {
          this.log(`  Files created: ${result.filesCreated.length}`)
        }
        if (result.filesModified.length > 0) {
          this.log(`  Files modified: ${result.filesModified.length}`)
        }
      } else {
        const errorMsg = result.errors.length > 0 ? result.errors.join(', ') : 'Unknown error'
        this.error(`Recipe failed: ${errorMsg}`)
      }
    } catch (error: any) {
      collector.clear()
      // Re-throw oclif exit errors (from this.exit())
      if (error?.code === 'EEXIT') throw error
      this.error(`Failed to execute recipe: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Resolve recipe path from cookbook/recipe syntax or direct path
   * Supports:
   * - Direct paths: ./my-recipe, /absolute/path/recipe.yml
   * - Cookbook syntax: cookbook recipe (e.g., crud edit-page)
   * - Package syntax: @scope/package/recipe
   */
  private async resolveRecipePath(recipeName: string, argv: string[], cwd: string): Promise<string> {
    // If it's a file path (starts with ./ or / or ends with .yml/.yaml), return as-is
    if (
      recipeName.startsWith('./') ||
      recipeName.startsWith('../') ||
      recipeName.startsWith('/') ||
      recipeName.endsWith('.yml') ||
      recipeName.endsWith('.yaml')
    ) {
      return recipeName
    }

    // Check if next arg (after recipe) is another string that doesn't start with --
    // This would indicate cookbook/recipe syntax: hypergen run crud edit-page
    const recipeIndex = argv.indexOf(recipeName)
    const nextArg = argv[recipeIndex + 1]
    const isRecipeSubpath = nextArg && !nextArg.startsWith('--')

    if (isRecipeSubpath) {
      // Cookbook/recipe syntax - need to discover cookbook location
      const cookbookName = recipeName
      const recipeName2 = nextArg

      // Use config to find cookbook directories
      const searchDirs = this.hypergenConfig?.discovery?.directories || ['.hypergen/cookbooks', 'cookbooks']

      for (const dir of searchDirs) {
        const fullDir = path.resolve(cwd, dir)
        const cookbookPath = path.join(fullDir, cookbookName)

        // Check if cookbook directory exists
        if (fs.existsSync(cookbookPath)) {
          // Try to find the recipe
          const recipePath = path.join(cookbookPath, recipeName2, 'recipe.yml')
          if (fs.existsSync(recipePath)) {
            return recipePath
          }

          // Try without subdirectory (recipe.yml directly in cookbook)
          const directRecipePath = path.join(cookbookPath, 'recipe.yml')
          if (fs.existsSync(directRecipePath)) {
            return directRecipePath
          }
        }
      }

      // If we couldn't find it, throw error
      this.error(
        `Recipe not found: ${cookbookName}/${recipeName2}\n` +
        `Searched in: ${searchDirs.join(', ')}`
      )
    }

    // Otherwise, treat as a simple recipe name - look in discovery directories
    const searchDirs = this.hypergenConfig?.discovery?.directories || ['.hypergen/cookbooks', 'cookbooks', 'recipes']

    for (const dir of searchDirs) {
      const fullDir = path.resolve(cwd, dir)

      // Try recipe.yml in a subdirectory
      const recipePath = path.join(fullDir, recipeName, 'recipe.yml')
      if (fs.existsSync(recipePath)) {
        return recipePath
      }

      // Try direct recipe file
      const directPath = path.join(fullDir, `${recipeName}.yml`)
      if (fs.existsSync(directPath)) {
        return directPath
      }
    }

    // If still not found, return as-is and let RecipeEngine handle it
    return recipeName
  }
}
