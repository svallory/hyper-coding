/**
 * Main command for executing recipes
 * Usage: hypergen run <recipe> [options]
 * Or shorthand: hypergen <kit> <recipe-path>
 */

import fs from 'node:fs'
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
  }

  static override args = {
    recipe: Args.string({
      description: 'Recipe to execute (path, package, or kit recipe)',
      required: true,
    }),
  }

  static override strict = false

  async run(): Promise<void> {
    const { args, flags, argv } = await this.parse(Run)
    const recipePath = args.recipe
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

    this.log(`Executing recipe: ${recipePath}`)

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
        const prompt = assembler.assemble(collector, {
          originalCommand,
          answersPath: './ai-answers.json',
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
    } catch (error) {
      collector.clear()
      this.error(`Failed to execute recipe: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
