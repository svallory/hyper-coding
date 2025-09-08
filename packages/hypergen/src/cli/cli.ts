/**
 * Hypergen CLI Interface
 * 
 * Main CLI commands for Hypergen
 */

import type { RunnerConfig } from '../types.js'
import { ActionExecutor } from '../actions/index.js'
import { GeneratorDiscovery } from '../discovery/index.js'
import { TemplateURLManager } from '../config/url-resolution/index.js'
import { DefaultActionUtils, ConsoleActionLogger } from '../actions/index.js'
import { TemplateParser } from '../config/template-parser.js'
import { GeneratorScaffolding } from './scaffolding.js'
import { ErrorHandler, HypergenError, ErrorCode } from '../errors/hypergen-errors.js'
import { HypergenConfigLoader, createConfigFile, getConfigInfo, type ResolvedConfig } from '../config/hypergen-config.js'
import { 
  RecipeEngine, 
  type RecipeExecutionOptions, 
  type RecipeEngineConfig,
  type RecipeSource,
  loadRecipe as loadRecipeEngine
} from '../recipe-engine/recipe-engine.js'
import { StepExecutor } from '../recipe-engine/step-executor.js'
import { getToolRegistry } from '../recipe-engine/tools/registry.js'
import Logger from '../logger.js'

export interface HypergenCliConfig extends RunnerConfig {
  discoveryOptions?: {
    sources?: string[]
    directories?: string[]
  }
}

export class HypergenCLI {
  private executor = new ActionExecutor()
  private discovery = new GeneratorDiscovery()
  private urlManager = new TemplateURLManager()
  private utils = new DefaultActionUtils()
  private logger = new ConsoleActionLogger()
  private scaffolding = new GeneratorScaffolding()
  private hypergenConfig?: ResolvedConfig
  private recipeEngine?: RecipeEngine
  private consoleLogger = new Logger(console.log)

  constructor(private config: HypergenCliConfig) {}

  /**
   * Initialize configuration
   */
  async initialize(): Promise<void> {
    try {
      this.hypergenConfig = await HypergenConfigLoader.loadConfig(
        undefined,
        this.config.cwd || process.cwd()
      )
    } catch (error) {
      // Configuration is optional, continue without it
      console.warn('Warning: Could not load configuration file')
    }

    // Initialize recipe engine with configuration
    const recipeConfig: RecipeEngineConfig = {
      workingDir: this.config.cwd || process.cwd(),
      enableDebugLogging: process.env.DEBUG?.includes('hypergen') || false
    }

    this.recipeEngine = new RecipeEngine(recipeConfig)
  }

  /**
   * Parse and execute commands
   */
  async execute(argv: string[]): Promise<{ success: boolean; message?: string }> {
    const [command, ...args] = argv

    switch (command) {
      case 'action':
        return this.executeAction(args)
      
      case 'discover':
        return this.discoverGenerators(args)
      
      case 'list':
        return this.listActions(args)
      
      case 'info':
        return this.showActionInfo(args)
      
      case 'url':
        return this.handleUrlCommand(args)
      
      case 'template':
        return this.handleTemplateCommand(args)
      
      case 'recipe':
        return this.handleRecipeCommand(args)
      
      case 'step':
        return this.handleStepCommand(args)
      
      case 'init':
        return this.handleInitCommand(args)
      
      case 'system':
        return this.handleSystemCommand(args)
      
      case 'config':
        return this.handleConfigCommand(args)
      
      default:
        return {
          success: false,
          message: `Unknown command: ${command}. Use 'hypergen --help' for available commands.`
        }
    }
  }

  /**
   * Execute an action by name
   * Usage: hypergen action <action-name> [parameters...] [options]
   * 
   * Options:
   *   --defaults  Use default values when possible instead of prompting
   *   --dryRun    Run entire generator process without writing files
   *   --force     Force overwrite any existing files at the destination
   */
  private async executeAction(args: string[]): Promise<{ success: boolean; message?: string }> {
    if (args.length === 0) {
      const error = ErrorHandler.createError(
        ErrorCode.ACTION_INVALID_PARAMETERS,
        'Action name required',
        {},
        [
          {
            title: 'Provide action name',
            description: 'Specify the action you want to execute',
            command: 'hypergen action <action-name> [parameters...]'
          },
          {
            title: 'Use defaults',
            description: 'Use default values when possible instead of prompting',
            command: 'hypergen action <action-name> --defaults'
          },
          {
            title: 'Dry run',
            description: 'Run generator without actually writing files',
            command: 'hypergen action <action-name> --dryRun'
          },
          {
            title: 'Force overwrite',
            description: 'Force overwrite existing files',
            command: 'hypergen action <action-name> --force'
          },
          {
            title: 'List available actions',
            description: 'See all available actions',
            command: 'hypergen list'
          }
        ]
      )
      return {
        success: false,
        message: ErrorHandler.formatError(error)
      }
    }

    const [actionName, ...paramArgs] = args
    
    // Parse flags
    const flags = this.parseFlags(paramArgs)
    const useDefaults = flags.has('defaults')
    const dryRun = flags.has('dryRun')
    const force = flags.has('force')
    
    // Parse parameters (including those with --)
    const parameters = this.parseParameters(paramArgs)

    try {
      // Check if actionName is actually a recipe file (ends with .yml or .yaml)
      if (actionName.endsWith('.yml') || actionName.endsWith('.yaml')) {
        // This is a recipe file - use the new V8 Recipe System
        if (!this.recipeEngine) {
          await this.initialize()
        }

        const options: RecipeExecutionOptions = {
          variables: parameters,
          workingDir: this.config.cwd || process.cwd(),
          dryRun,
          force,
          skipPrompts: useDefaults,
          logger: this.consoleLogger
        }

        const result = await this.recipeEngine!.executeRecipe(actionName, options)
        
        if (result.success) {
          let message = dryRun 
            ? `🔍 [DRY RUN] Recipe '${result.recipe.name}' would complete successfully`
            : `✅ Recipe '${result.recipe.name}' completed successfully`
          
          if (result.filesCreated.length > 0) {
            message += dryRun 
              ? `\nFiles would be created: ${result.filesCreated.join(', ')}`
              : `\nFiles created: ${result.filesCreated.join(', ')}`
          }
          
          return { success: true, message }
        } else {
          return {
            success: false,
            message: `❌ Recipe execution failed: ${result.errors.join(', ')}`
          }
        }
      }

      // Check if action exists, if not try auto-discovery
      let actionInfo = this.executor.getActionInfo(actionName)
      if (!actionInfo.exists) {
        // Try auto-discovery
        await this.discovery.discoverAll()
        await this.discovery.registerDiscoveredActions()
        actionInfo = this.executor.getActionInfo(actionName)
        
        // If still not found, check if it might be a recipe file
        if (!actionInfo.exists) {
          // Try to find a recipe file with this name
          const possibleRecipePaths = [
            `${actionName}.yml`,
            `${actionName}.yaml`,
            `_recipes/${actionName}.yml`,
            `_recipes/${actionName}.yaml`
          ]
          
          for (const recipePath of possibleRecipePaths) {
            try {
              const fs = await import('fs')
              const path = await import('path')
              const fullPath = path.resolve(this.config.cwd || process.cwd(), recipePath)
              
              if (fs.existsSync(fullPath)) {
                // Found a recipe file - use V8 system
                if (!this.recipeEngine) {
                  await this.initialize()
                }

                const options: RecipeExecutionOptions = {
                  variables: parameters,
                  workingDir: this.config.cwd || process.cwd(),
                  dryRun,
                  force,
                  skipPrompts: useDefaults,
                  logger: this.consoleLogger
                }

                const result = await this.recipeEngine!.executeRecipe(fullPath, options)
                
                if (result.success) {
                  let message = dryRun 
                    ? `🔍 [DRY RUN] Recipe '${result.recipe.name}' would complete successfully (found at ${recipePath})`
                    : `✅ Recipe '${result.recipe.name}' completed successfully (found at ${recipePath})`
                  
                  if (result.filesCreated.length > 0) {
                    message += dryRun 
                      ? `\nFiles would be created: ${result.filesCreated.join(', ')}`
                      : `\nFiles created: ${result.filesCreated.join(', ')}`
                  }
                  
                  return { success: true, message }
                } else {
                  return {
                    success: false,
                    message: `❌ Recipe execution failed: ${result.errors.join(', ')}`
                  }
                }
              }
            } catch (error) {
              // Continue searching
            }
          }
          
          // Not found as action or recipe
          const error = ErrorHandler.createActionNotFoundError(actionName)
          return {
            success: false,
            message: ErrorHandler.formatError(error) + '\n\nTip: If this is a recipe, use: hypergen recipe execute <recipe.yml>'
          }
        }
      }

      const executionContext = {
        projectRoot: this.config.cwd || process.cwd(),
        logger: this.logger,
        utils: this.utils
      }

      // Execute with interactive parameter resolution
      const result = await this.executor.executeInteractively(
        actionName, 
        parameters, 
        executionContext, 
        {
          useDefaults,
          dryRun,
          force,
          skipOptional: false,
          timeout: 300000 // 5 minutes
        }
      )

      if (result.success) {
        let message = dryRun 
          ? `🔍 [DRY RUN] Action '${actionName}' would complete successfully`
          : `✅ Action '${actionName}' completed successfully`
        
        if (result.message) {
          message += `\n${result.message}`
        }
        
        if (result.filesCreated?.length) {
          message += dryRun 
            ? `\nFiles would be created: ${result.filesCreated.join(', ')}`
            : `\nFiles created: ${result.filesCreated.join(', ')}`
        }
        
        if (result.filesModified?.length) {
          message += dryRun 
            ? `\nFiles would be modified: ${result.filesModified.join(', ')}`
            : `\nFiles modified: ${result.filesModified.join(', ')}`
        }
        
        if (result.filesDeleted?.length) {
          message += dryRun 
            ? `\nFiles would be deleted: ${result.filesDeleted.join(', ')}`
            : `\nFiles deleted: ${result.filesDeleted.join(', ')}`
        }
        
        return { success: true, message }
      } else {
        const error = ErrorHandler.createError(
          ErrorCode.ACTION_EXECUTION_FAILED,
          result.message || 'Action execution failed',
          { action: actionName },
          [
            {
              title: 'Check action parameters',
              description: 'Verify all required parameters are provided',
              command: `hypergen info ${actionName}`
            },
            {
              title: 'Check file permissions',
              description: 'Ensure you have write permissions to the target directory'
            }
          ]
        )
        return {
          success: false,
          message: ErrorHandler.formatError(error)
        }
      }
    } catch (error: any) {
      if (error instanceof HypergenError) {
        return {
          success: false,
          message: ErrorHandler.formatError(error)
        }
      }
      
      const hypergenError = ErrorHandler.createError(
        ErrorCode.ACTION_EXECUTION_FAILED,
        error.message || 'Action execution failed',
        { action: actionName }
      )
      return {
        success: false,
        message: ErrorHandler.formatError(hypergenError)
      }
    }
  }

  /**
   * Discover generators from all sources
   * Usage: hypergen discover [sources...]
   */
  private async discoverGenerators(args: string[]): Promise<{ success: boolean; message?: string }> {
    const sources = args.length > 0 ? args : undefined
    
    if (sources) {
      this.discovery = new GeneratorDiscovery({
        enabledSources: sources as any[]
      })
    }

    try {
      const generators = await this.discovery.discoverAll()
      
      // Register the discovered actions so they're available for execution
      await this.discovery.registerDiscoveredActions()
      
      let message = `🔍 Discovery complete: found ${generators.length} generators\n`
      
      if (generators.length > 0) {
        message += '\nGenerators found:\n'
        
        for (const generator of generators) {
          message += `  📦 ${generator.name} (${generator.source})\n`
          message += `     Path: ${generator.path}\n`
          message += `     Actions: ${generator.actions.length > 0 ? generator.actions.join(', ') : 'none'}\n`
          
          if (generator.metadata?.description) {
            message += `     Description: ${generator.metadata.description}\n`
          }
          
          message += '\n'
        }
      } else {
        message += '\nNo generators found. Try:\n'
        message += '  • Adding generators to recipes/ directory\n'
        message += '  • Installing generator packages with npm\n'
        message += '  • Using --sources to specify discovery sources\n'
      }
      
      return { success: true, message }
    } catch (error: any) {
      return {
        success: false,
        message: `❌ Discovery failed: ${error.message}`
      }
    }
  }

  /**
   * List available actions
   * Usage: hypergen list [category]
   */
  private async listActions(args: string[]): Promise<{ success: boolean; message?: string }> {
    const [category] = args

    try {
      // Auto-discover if no actions are available
      let actions = this.executor.getAvailableActionNames()
      if (actions.length === 0) {
        await this.discovery.discoverAll()
        await this.discovery.registerDiscoveredActions()
        actions = this.executor.getAvailableActionNames()
      }

      if (category) {
        actions = this.executor.getActionsByCategory(category)
        
        if (actions.length === 0) {
          return {
            success: false,
            message: `No actions found in category '${category}'. Available categories: ${this.executor.getCategories().join(', ')}`
          }
        }
      }

      if (actions.length === 0) {
        return {
          success: true,
          message: '📝 No actions available. Check that you have generators in recipes/ or run: hypergen discover'
        }
      }

      let message = category 
        ? `📝 Actions in category '${category}':\n`
        : `📝 Available actions:\n`

      for (const actionName of actions) {
        const info = this.executor.getActionInfo(actionName)
        message += `  • ${actionName}`
        
        if (info.metadata?.description) {
          message += ` - ${info.metadata.description}`
        }
        
        if (info.requiredParameters?.length) {
          message += ` (requires: ${info.requiredParameters.join(', ')})`
        }
        
        message += '\n'
      }

      if (!category) {
        const categories = this.executor.getCategories()
        if (categories.length > 0) {
          message += `\n📂 Categories: ${categories.join(', ')}\n`
          message += 'Use "hypergen list <category>" to filter by category\n'
        }
      }

      return { success: true, message }
    } catch (error: any) {
      return {
        success: false,
        message: `❌ Failed to list actions: ${error.message}`
      }
    }
  }

  /**
   * Show detailed action information
   * Usage: hypergen info <action-name>
   */
  private async showActionInfo(args: string[]): Promise<{ success: boolean; message?: string }> {
    if (args.length === 0) {
      return {
        success: false,
        message: 'Action name required. Usage: hypergen info <action-name>'
      }
    }

    const [actionName] = args
    let info = this.executor.getActionInfo(actionName)

    // Auto-discover if action not found
    if (!info.exists) {
      await this.discovery.discoverAll()
      await this.discovery.registerDiscoveredActions()
      info = this.executor.getActionInfo(actionName)
    }

    if (!info.exists) {
      return {
        success: false,
        message: `❌ Action '${actionName}' not found. Use 'hypergen list' to see available actions.`
      }
    }

    let message = `📋 Action: ${actionName}\n`
    
    if (info.metadata?.description) {
      message += `Description: ${info.metadata.description}\n`
    }
    
    if (info.metadata?.category) {
      message += `Category: ${info.metadata.category}\n`
    }
    
    if (info.metadata?.tags?.length) {
      message += `Tags: ${info.metadata.tags.join(', ')}\n`
    }

    if (info.parameterCount && info.parameterCount > 0) {
      message += `\nParameters (${info.parameterCount}):\n`
      
      for (const param of info.metadata.parameters || []) {
        message += `  • ${param.name} (${param.type})`
        
        if (param.required) {
          message += ' *required*'
        }
        
        if (param.default !== undefined) {
          message += ` [default: ${param.default}]`
        }
        
        if (param.description) {
          message += ` - ${param.description}`
        }
        
        message += '\n'
      }
    } else {
      message += '\nNo parameters required\n'
    }

    if (info.metadata?.examples?.length) {
      message += '\nExamples:\n'
      
      for (const example of info.metadata.examples) {
        message += `  ${example.title}:\n`
        message += `    hypergen action ${actionName}`
        
        for (const [key, value] of Object.entries(example.parameters)) {
          message += ` --${key}=${value}`
        }
        
        message += '\n'
        
        if (example.description) {
          message += `    ${example.description}\n`
        }
        
        message += '\n'
      }
    }

    return { success: true, message }
  }

  /**
   * Handle init commands
   * Usage: hypergen init <type> [options...]
   */
  private async handleInitCommand(args: string[]): Promise<{ success: boolean; message?: string }> {
    const [type, ...initArgs] = args

    switch (type) {
      case 'generator':
        return this.initGenerator(initArgs)
      
      case 'workspace':
        return this.initWorkspace(initArgs)
      
      default:
        return {
          success: false,
          message: 'Init type required. Available: generator, workspace'
        }
    }
  }

  /**
   * Handle template-related commands
   * Usage: hypergen template <subcommand> [args...]
   */
  private async handleTemplateCommand(args: string[]): Promise<{ success: boolean; message?: string }> {
    const [subcommand, ...subArgs] = args

    switch (subcommand) {
      case 'validate':
        return this.validateTemplate(subArgs)
      
      case 'info':
        return this.showTemplateInfo(subArgs)
      
      case 'list':
        return this.listTemplates(subArgs)
      
      case 'examples':
        return this.showTemplateExamples(subArgs)
      
      default:
        return {
          success: false,
          message: 'Template subcommand required. Available: validate, info, list, examples'
        }
    }
  }

  /**
   * Handle URL-related commands
   * Usage: hypergen url <subcommand> [args...]
   */
  private async handleUrlCommand(args: string[]): Promise<{ success: boolean; message?: string }> {
    const [subcommand, ...subArgs] = args

    switch (subcommand) {
      case 'resolve':
        return this.resolveUrl(subArgs)
      
      case 'cache':
        return this.manageCache(subArgs)
      
      default:
        return {
          success: false,
          message: 'URL subcommand required. Available: resolve, cache'
        }
    }
  }

  /**
   * Handle system commands
   * Usage: hypergen system <subcommand> [args...]
   */
  private async handleSystemCommand(args: string[]): Promise<{ success: boolean; message?: string }> {
    const [subcommand, ...subArgs] = args

    switch (subcommand) {
      case 'help':
        return this.showSystemHelp()
      
      case 'status':
        return this.showSystemStatus()
      
      case 'version':
        return this.showVersion()
      
      default:
        return {
          success: false,
          message: 'System subcommand required. Available: help, status, version'
        }
    }
  }

  /**
   * Handle configuration commands
   * Usage: hypergen config <subcommand> [args...]
   */
  private async handleConfigCommand(args: string[]): Promise<{ success: boolean; message?: string }> {
    const [subcommand, ...subArgs] = args

    switch (subcommand) {
      case 'init':
        return this.initConfig(subArgs)
      
      case 'show':
        return this.showConfig()
      
      case 'validate':
        return this.validateConfig(subArgs)
      
      case 'info':
        return this.showConfigInfo()
      
      default:
        return {
          success: false,
          message: 'Config subcommand required. Available: init, show, validate, info'
        }
    }
  }

  /**
   * Handle recipe commands
   * Usage: hypergen recipe <subcommand> [args...]
   */
  private async handleRecipeCommand(args: string[]): Promise<{ success: boolean; message?: string }> {
    const [subcommand, ...subArgs] = args

    switch (subcommand) {
      case 'execute':
        return this.executeRecipe(subArgs)
      
      case 'validate':
        return this.validateRecipe(subArgs)
      
      case 'info':
        return this.showRecipeInfo(subArgs)
      
      case 'list':
        return this.listRecipes(subArgs)
      
      default:
        return {
          success: false,
          message: 'Recipe subcommand required. Available: execute, validate, info, list'
        }
    }
  }

  /**
   * Handle step commands  
   * Usage: hypergen step <subcommand> [args...]
   */
  private async handleStepCommand(args: string[]): Promise<{ success: boolean; message?: string }> {
    const [subcommand, ...subArgs] = args

    switch (subcommand) {
      case 'list':
        return this.listRecipeSteps(subArgs)
      
      case 'execute':
        return this.executeRecipeStep(subArgs)
      
      default:
        return {
          success: false,
          message: 'Step subcommand required. Available: list, execute'
        }
    }
  }

  /**
   * Resolve a template URL
   */
  private async resolveUrl(args: string[]): Promise<{ success: boolean; message?: string }> {
    if (args.length === 0) {
      return {
        success: false,
        message: 'URL required. Usage: hypergen url resolve <url>'
      }
    }

    const [url] = args

    try {
      const resolved = await this.urlManager.resolveURL(url)
      
      return {
        success: true,
        message: `🔗 URL resolved:\n  URL: ${url}\n  Path: ${resolved.basePath}\n  Type: ${resolved.metadata.type}`
      }
    } catch (error: any) {
      return {
        success: false,
        message: `❌ Failed to resolve URL: ${error.message}`
      }
    }
  }

  /**
   * Manage URL cache
   */
  private async manageCache(args: string[]): Promise<{ success: boolean; message?: string }> {
    const [action] = args

    switch (action) {
      case 'clear':
        await this.urlManager.clearCache()
        return { success: true, message: '🗑️  Cache cleared' }
      
      case 'info':
        const info = await this.urlManager.getCacheInfo()
        return {
          success: true,
          message: `💾 Cache info:\n  Entries: ${info.entryCount}\n  Size: ${info.totalSize} bytes`
        }
      
      default:
        return {
          success: false,
          message: 'Cache action required. Available: clear, info'
        }
    }
  }

  /**
   * Show system help
   */
  private async showSystemHelp(): Promise<{ success: boolean; message?: string }> {
    const message = `
🚀 Hypergen Commands

Action Management:
  hypergen action <name> [params...]    Execute an action
  hypergen list [category]              List available actions
  hypergen info <action-name>           Show action details

Recipe System (V8):
  hypergen recipe execute <recipe>      Execute a recipe with all steps
  hypergen recipe validate <recipe>     Validate recipe configuration
  hypergen recipe info <recipe>         Show recipe details and steps
  hypergen recipe list [directory]      List available recipes

Step Management (V8):
  hypergen step list <recipe>           List steps in a recipe
  hypergen step execute <recipe> <step> Execute a single step

Generator Discovery:
  hypergen discover [sources...]        Discover generators
  hypergen discover local               Discover local generators only
  hypergen discover npm                 Discover npm generators only

Template Management:
  hypergen template validate <path>     Validate template.yml file
  hypergen template info <path>         Show template information
  hypergen template list [directory]   List templates in directory
  hypergen template examples <path>     Show template examples

Generator Scaffolding:
  hypergen init generator [options]     Create a new generator
  hypergen init workspace [options]     Initialize a generator workspace

Configuration:
  hypergen config init [--format=js]    Create configuration file
  hypergen config show                  Show current configuration
  hypergen config validate [path]       Validate configuration file
  hypergen config info                  Show configuration information

URL Templates:
  hypergen url resolve <url>            Resolve template URL
  hypergen url cache clear              Clear template cache
  hypergen url cache info               Show cache information

System:
  hypergen system help                  Show this help
  hypergen system status                Show system status
  hypergen system version               Show version information

Recipe Examples (V8):
  hypergen recipe execute my-component.yml --name=Button --typescript=true
  hypergen recipe execute api-endpoint.yml --dryRun --name=UserAPI
  hypergen recipe validate _recipes/my-recipe.yml
  hypergen recipe info _recipes/react-component.yml
  hypergen step list my-recipe.yml
  hypergen step execute my-recipe.yml generate-component --name=Button

Examples:
  hypergen discover                     Find all generators
  hypergen list component               List component actions
  hypergen action create-component --name=Button --type=tsx
  hypergen recipe validate recipes/react-component/recipe.yml
  hypergen recipe list recipes     List all recipes
  hypergen init generator --name=my-widget --framework=react
  hypergen init workspace --withExamples=true
  hypergen config init --format=js      Create JavaScript config file
  hypergen config show                  View current configuration
  hypergen url resolve github:user/repo/templates

Flags:
  --dryRun                             Run without making file changes
  --force                              Force overwrite existing files
  --skipPrompts                        Use defaults, skip interactive prompts
  --continueOnError                    Continue execution after step failures
`

    return { success: true, message }
  }

  /**
   * Show system status
   */
  private async showSystemStatus(): Promise<{ success: boolean; message?: string }> {
    try {
      const generators = await this.discovery.discoverAll()
      const actions = this.executor.getAvailableActionNames()
      const categories = this.executor.getCategories()
      const cacheInfo = await this.urlManager.getCacheInfo()

      const message = `
📊 Hypergen Status

Generators: ${generators.length}
  • Local: ${generators.filter(g => g.source === 'local').length}
  • NPM: ${generators.filter(g => g.source === 'npm').length}
  • Workspace: ${generators.filter(g => g.source === 'workspace').length}

Actions: ${actions.length}
Categories: ${categories.length}

URL Cache:
  • Entries: ${cacheInfo.entryCount}
  • Size: ${cacheInfo.totalSize} bytes

Project: ${this.config.cwd || process.cwd()}
`

      return { success: true, message }
    } catch (error: any) {
      return {
        success: false,
        message: `❌ Failed to get status: ${error.message}`
      }
    }
  }

  /**
   * Show version information
   */
  private async showVersion(): Promise<{ success: boolean; message?: string }> {
    // Read version from package.json
    try {
      const packageJson = await import('../../package.json', { assert: { type: 'json' } })
      const message = `
🚀 Hypergen ${packageJson.default.version}

The modern, scalable code generator
Built with TypeScript and powered by decorators

Website: https://hypergen.dev
Repository: ${packageJson.default.repository?.url || 'https://github.com/svallory/hypergen'}
`
      return { success: true, message }
    } catch (error: any) {
      return {
        success: true,
        message: '🚀 Hypergen (version unknown)\n\nThe modern, scalable code generator'
      }
    }
  }

  /**
   * Validate a template.yml file
   */
  private async validateTemplate(args: string[]): Promise<{ success: boolean; message?: string }> {
    const [templatePath] = args
    
    if (!templatePath) {
      const error = ErrorHandler.createError(
        ErrorCode.TEMPLATE_INVALID_SYNTAX,
        'Template path required',
        {},
        [
          {
            title: 'Provide template path',
            description: 'Specify the path to the template.yml file',
            command: 'hypergen template validate <path>'
          },
          {
            title: 'List available templates',
            description: 'See all available templates',
            command: 'hypergen template list'
          }
        ]
      )
      return {
        success: false,
        message: ErrorHandler.formatError(error)
      }
    }

    try {
      const result = await TemplateParser.parseTemplateFile(templatePath)
      
      if (result.isValid) {
        let message = `✅ Template validation successful: ${result.config.name}\n`
        message += `Description: ${result.config.description || 'No description'}\n`
        message += `Version: ${result.config.version || 'No version'}\n`
        message += `Variables: ${Object.keys(result.config.variables).length}\n`
        message += `Examples: ${result.config.examples?.length || 0}\n`
        
        if (result.warnings.length > 0) {
          message += `\n⚠️  Warnings:\n`
          result.warnings.forEach(warning => {
            message += `  • ${warning}\n`
          })
        }
        
        return { success: true, message }
      } else {
        const error = ErrorHandler.createError(
          ErrorCode.TEMPLATE_INVALID_SYNTAX,
          'Template validation failed',
          { file: templatePath },
          [
            {
              title: 'Fix template errors',
              description: 'Review and fix the validation errors listed above'
            },
            {
              title: 'Check template syntax',
              description: 'Verify the YAML syntax is correct',
              url: 'https://hypergen.dev/docs/template-syntax'
            },
            {
              title: 'See template examples',
              description: 'Look at working template examples',
              command: 'hypergen recipe list examples/recipes'
            }
          ]
        )
        
        let message = ErrorHandler.formatError(error) + '\n\n'
        message += 'Validation errors:\n'
        result.errors.forEach(error => {
          message += `  • ${error}\n`
        })
        
        if (result.warnings.length > 0) {
          message += `\nWarnings:\n`
          result.warnings.forEach(warning => {
            message += `  • ${warning}\n`
          })
        }
        
        return { success: false, message }
      }
    } catch (error: any) {
      const hypergenError = ErrorHandler.createError(
        ErrorCode.TEMPLATE_NOT_FOUND,
        error.message || 'Failed to validate template',
        { file: templatePath }
      )
      return {
        success: false,
        message: ErrorHandler.formatError(hypergenError)
      }
    }
  }

  /**
   * Show template information
   */
  private async showTemplateInfo(args: string[]): Promise<{ success: boolean; message?: string }> {
    const [templatePath] = args
    
    if (!templatePath) {
      return {
        success: false,
        message: 'Template path required. Usage: hypergen template info <path>'
      }
    }

    try {
      const result = await TemplateParser.parseTemplateFile(templatePath)
      
      if (!result.isValid) {
        return {
          success: false,
          message: `❌ Template file is invalid. Use 'hypergen template validate' to see errors.`
        }
      }
      
      const config = result.config
      let message = `📋 Template: ${config.name}\n`
      
      if (config.description) {
        message += `Description: ${config.description}\n`
      }
      
      if (config.version) {
        message += `Version: ${config.version}\n`
      }
      
      if (config.author) {
        message += `Author: ${config.author}\n`
      }
      
      if (config.category) {
        message += `Category: ${config.category}\n`
      }
      
      if (config.tags?.length) {
        message += `Tags: ${config.tags.join(', ')}\n`
      }
      
      message += `\nVariables (${Object.keys(config.variables).length}):\n`
      
      for (const [varName, varConfig] of Object.entries(config.variables)) {
        message += `  • ${varName} (${varConfig.type})`
        
        if (varConfig.required) {
          message += ' *required*'
        }
        
        if (varConfig.default !== undefined) {
          message += ` [default: ${varConfig.default}]`
        }
        
        if (varConfig.description) {
          message += ` - ${varConfig.description}`
        }
        
        message += '\n'
      }
      
      if (config.examples?.length) {
        message += `\nExamples (${config.examples.length}):\n`
        
        for (const example of config.examples) {
          message += `  • ${example.title}\n`
          
          if (example.description) {
            message += `    ${example.description}\n`
          }
          
          message += `    Variables: ${Object.keys(example.variables).join(', ')}\n`
        }
      }
      
      return { success: true, message }
    } catch (error: any) {
      return {
        success: false,
        message: `❌ Failed to read template: ${error.message}`
      }
    }
  }

  /**
   * List templates in directory
   */
  private async listTemplates(args: string[]): Promise<{ success: boolean; message?: string }> {
    const [directory] = args
    const templatesDir = directory || 'recipes'

    try {
      const templates = await TemplateParser.parseTemplateDirectory(templatesDir)
      
      if (templates.length === 0) {
        return {
          success: true,
          message: `📝 No templates found in ${templatesDir}`
        }
      }
      
      let message = `📝 Templates found in ${templatesDir} (${templates.length}):\n`
      
      for (const template of templates) {
        message += `  • ${template.config.name || 'Unknown'}`
        
        if (template.config.description) {
          message += ` - ${template.config.description}`
        }
        
        if (!template.isValid) {
          message += ` ❌ (invalid)`
        }
        
        message += '\n'
      }
      
      const invalidCount = templates.filter(t => !t.isValid).length
      if (invalidCount > 0) {
        message += `\n⚠️  ${invalidCount} template(s) have validation errors. Use 'hypergen template validate' to check.`
      }
      
      return { success: true, message }
    } catch (error: any) {
      return {
        success: false,
        message: `❌ Failed to list templates: ${error.message}`
      }
    }
  }

  /**
   * Show template examples
   */
  private async showTemplateExamples(args: string[]): Promise<{ success: boolean; message?: string }> {
    const [templatePath] = args
    
    if (!templatePath) {
      return {
        success: false,
        message: 'Template path required. Usage: hypergen template examples <path>'
      }
    }

    try {
      const result = await TemplateParser.parseTemplateFile(templatePath)
      
      if (!result.isValid) {
        return {
          success: false,
          message: `❌ Template file is invalid. Use 'hypergen template validate' to see errors.`
        }
      }
      
      const config = result.config
      
      if (!config.examples?.length) {
        return {
          success: true,
          message: `📝 No examples found for template: ${config.name}`
        }
      }
      
      let message = `📝 Examples for template: ${config.name}\n`
      
      for (const [index, example] of config.examples.entries()) {
        message += `\n${index + 1}. ${example.title}\n`
        
        if (example.description) {
          message += `   ${example.description}\n`
        }
        
        message += `   hypergen action ${config.name}`
        
        for (const [key, value] of Object.entries(example.variables)) {
          message += ` --${key}=${JSON.stringify(value)}`
        }
        
        message += '\n'
      }
      
      return { success: true, message }
    } catch (error: any) {
      return {
        success: false,
        message: `❌ Failed to show examples: ${error.message}`
      }
    }
  }

  /**
   * Initialize a new generator
   */
  private async initGenerator(args: string[]): Promise<{ success: boolean; message?: string }> {
    const parameters = this.parseParameters(args)
    
    if (!parameters.name) {
      const error = ErrorHandler.createError(
        ErrorCode.GENERATOR_INVALID_STRUCTURE,
        'Generator name required',
        {},
        [
          {
            title: 'Provide generator name',
            description: 'Specify a name for your generator',
            command: 'hypergen init generator --name=my-generator'
          },
          {
            title: 'See more options',
            description: 'View all available options for generator creation',
            command: 'hypergen init generator --help'
          }
        ]
      )
      return {
        success: false,
        message: ErrorHandler.formatError(error)
      }
    }

    // Validate generator name
    if (!/^[a-zA-Z][a-zA-Z0-9-_]*$/.test(parameters.name)) {
      const error = ErrorHandler.createParameterError(
        'name',
        parameters.name,
        'alphanumeric with dashes and underscores, starting with a letter'
      )
      return {
        success: false,
        message: ErrorHandler.formatError(error)
      }
    }

    try {
      const options = {
        name: parameters.name,
        description: parameters.description || `Generator for ${parameters.name}`,
        category: parameters.category || 'custom',
        author: parameters.author || 'Unknown',
        directory: parameters.directory || 'recipes',
        type: parameters.type || 'both',
        framework: parameters.framework || 'generic',
        withExamples: parameters.withExamples !== false,
        withTests: parameters.withTests !== false
      }

      // Validate framework
      const validFrameworks = ['react', 'vue', 'node', 'cli', 'api', 'generic']
      if (!validFrameworks.includes(options.framework)) {
        const error = ErrorHandler.createParameterError(
          'framework',
          options.framework,
          `one of: ${validFrameworks.join(', ')}`
        )
        return {
          success: false,
          message: ErrorHandler.formatError(error)
        }
      }

      // Validate type
      const validTypes = ['action', 'template', 'both']
      if (!validTypes.includes(options.type)) {
        const error = ErrorHandler.createParameterError(
          'type',
          options.type,
          `one of: ${validTypes.join(', ')}`
        )
        return {
          success: false,
          message: ErrorHandler.formatError(error)
        }
      }

      const result = await this.scaffolding.initGenerator(options)
      
      if (result.success) {
        let message = `✅ Generator '${parameters.name}' created successfully\n`
        message += `Location: ${options.directory}/${options.name}\n`
        message += `Files created: ${result.filesCreated?.length || 0}\n`
        
        if (result.filesCreated) {
          message += `\nFiles:\n`
          result.filesCreated.forEach(file => {
            message += `  • ${file}\n`
          })
        }
        
        message += `\nNext steps:\n`
        message += `  1. Edit the generator files to customize behavior\n`
        message += `  2. Test with: hypergen template validate ${options.directory}/${options.name}/template.yml\n`
        message += `  3. Run with: hypergen action ${options.name} --name=example\n`
        
        return { success: true, message }
      } else {
        const error = ErrorHandler.createError(
          ErrorCode.GENERATOR_INVALID_STRUCTURE,
          result.message || 'Failed to create generator',
          { action: 'init-generator' }
        )
        return {
          success: false,
          message: ErrorHandler.formatError(error)
        }
      }
    } catch (error: any) {
      if (error instanceof HypergenError) {
        return {
          success: false,
          message: ErrorHandler.formatError(error)
        }
      }
      
      const hypergenError = ErrorHandler.createError(
        ErrorCode.GENERATOR_INVALID_STRUCTURE,
        error.message || 'Failed to create generator',
        { action: 'init-generator' }
      )
      return {
        success: false,
        message: ErrorHandler.formatError(hypergenError)
      }
    }
  }

  /**
   * Initialize a new workspace
   */
  private async initWorkspace(args: string[]): Promise<{ success: boolean; message?: string }> {
    const parameters = this.parseParameters(args)
    
    try {
      const options = {
        directory: parameters.directory || 'recipes',
        withExamples: parameters.withExamples !== false
      }

      const result = await this.scaffolding.initWorkspace(options)
      
      if (result.success) {
        let message = `✅ Workspace initialized successfully\n`
        message += `Location: ${options.directory}\n`
        message += `Files created: ${result.filesCreated?.length || 0}\n`
        
        if (options.withExamples) {
          message += `\nExample generators created:\n`
          message += `  • component - React component generator\n`
          message += `  • api-route - API route generator\n`
          message += `  • util-function - Utility function generator\n`
        }
        
        message += `\nNext steps:\n`
        message += `  1. Explore the example generators\n`
        message += `  2. Create your own: hypergen init generator --name=my-generator\n`
        message += `  3. List available generators: hypergen discover\n`
        message += `  4. Run generators: hypergen action <generator-name> --name=example\n`
        
        return { success: true, message }
      } else {
        return result
      }
    } catch (error: any) {
      return {
        success: false,
        message: `❌ Failed to initialize workspace: ${error.message}`
      }
    }
  }

  /**
   * Initialize configuration file
   */
  private async initConfig(args: string[]): Promise<{ success: boolean; message?: string }> {
    const parameters = this.parseParameters(args)
    const format = parameters.format === 'json' ? 'json' : 'js'
    const projectRoot = this.config.cwd || process.cwd()

    try {
      const configPath = await createConfigFile(projectRoot, format)
      
      return {
        success: true,
        message: `✅ Configuration file created: ${configPath}\n\nNext steps:\n  1. Edit the configuration file to match your needs\n  2. Validate: hypergen config validate\n  3. View info: hypergen config info`
      }
    } catch (error: any) {
      if (error instanceof HypergenError) {
        return {
          success: false,
          message: ErrorHandler.formatError(error)
        }
      }
      
      return {
        success: false,
        message: `❌ Failed to create configuration file: ${error.message}`
      }
    }
  }

  /**
   * Show current configuration
   */
  private async showConfig(): Promise<{ success: boolean; message?: string }> {
    try {
      if (!this.hypergenConfig) {
        await this.initialize()
      }
      
      if (!this.hypergenConfig) {
        return {
          success: true,
          message: `📝 No configuration file found. Using defaults.\n\nTo create a configuration file:\n  hypergen config init`
        }
      }
      
      const config = this.hypergenConfig
      let message = `📝 Configuration (${config.configPath}):\n\n`
      
      message += `Templates: ${config.templates.join(', ')}\n`
      message += `Environment: ${config.environment}\n`
      message += `Engine: ${config.engine.type}\n`
      message += `Conflict Strategy: ${config.output.conflictStrategy}\n`
      message += `Cache Enabled: ${config.cache.enabled}\n`
      message += `Validation: ${config.validation.strict ? 'strict' : 'relaxed'}\n`
      
      if (config.discovery.sources.length > 0) {
        message += `Discovery Sources: ${config.discovery.sources.join(', ')}\n`
      }
      
      if (config.plugins.length > 0) {
        message += `Plugins: ${config.plugins.join(', ')}\n`
      }
      
      if (Object.keys(config.loadedHelpers).length > 0) {
        message += `Helpers: ${Object.keys(config.loadedHelpers).join(', ')}\n`
      }
      
      return { success: true, message }
    } catch (error: any) {
      return {
        success: false,
        message: `❌ Failed to show configuration: ${error.message}`
      }
    }
  }

  /**
   * Validate configuration
   */
  private async validateConfig(args: string[]): Promise<{ success: boolean; message?: string }> {
    const [configPath] = args
    const projectRoot = this.config.cwd || process.cwd()

    try {
      const config = await HypergenConfigLoader.loadConfig(configPath, projectRoot)
      const validation = HypergenConfigLoader.validateConfig(config)
      
      if (validation.valid) {
        return {
          success: true,
          message: `✅ Configuration is valid\n\nConfiguration loaded from: ${config.configPath}\nEnvironment: ${config.environment}\nTemplates: ${config.templates.length} directories\nPlugins: ${config.plugins.length} loaded`
        }
      } else {
        return {
          success: false,
          message: `❌ Configuration validation failed:\n\n${validation.errors.map(error => `  • ${error}`).join('\n')}`
        }
      }
    } catch (error: any) {
      if (error instanceof HypergenError) {
        return {
          success: false,
          message: ErrorHandler.formatError(error)
        }
      }
      
      return {
        success: false,
        message: `❌ Failed to validate configuration: ${error.message}`
      }
    }
  }

  /**
   * Show configuration information
   */
  private async showConfigInfo(): Promise<{ success: boolean; message?: string }> {
    try {
      if (!this.hypergenConfig) {
        await this.initialize()
      }
      
      if (!this.hypergenConfig) {
        return {
          success: true,
          message: `📋 No configuration file found\n\nDefault configuration is being used.\nTo create a configuration file: hypergen config init`
        }
      }
      
      const info = getConfigInfo(this.hypergenConfig)
      
      let message = `📋 Configuration Information\n\n`
      message += `Source: ${info.source}\n`
      message += `Environment: ${info.environment}\n`
      message += `Templates: ${info.templates.length} directories\n`
      
      if (info.templates.length > 0) {
        message += `  ${info.templates.map(t => `• ${t}`).join('\n  ')}\n`
      }
      
      message += `Cache: ${info.cacheEnabled ? 'enabled' : 'disabled'}\n`
      message += `Plugins: ${info.pluginCount} loaded\n`
      message += `Helpers: ${info.helperCount} loaded\n`
      
      return { success: true, message }
    } catch (error: any) {
      return {
        success: false,
        message: `❌ Failed to get configuration info: ${error.message}`
      }
    }
  }

  /**
   * Execute a recipe
   * Usage: hypergen recipe execute <recipe> [options...]
   */
  private async executeRecipe(args: string[]): Promise<{ success: boolean; message?: string }> {
    if (args.length === 0) {
      const error = ErrorHandler.createError(
        ErrorCode.ACTION_INVALID_PARAMETERS,
        'Recipe path required',
        {},
        [
          {
            title: 'Provide recipe path',
            description: 'Specify the path to the recipe file to execute',
            command: 'hypergen recipe execute <recipe.yml> --var1=value1 --var2=value2'
          },
          {
            title: 'List available recipes',
            description: 'See all available recipes',
            command: 'hypergen recipe list'
          },
          {
            title: 'Dry run a recipe',
            description: 'Test recipe execution without making changes',
            command: 'hypergen recipe execute <recipe.yml> --dryRun'
          }
        ]
      )
      return {
        success: false,
        message: ErrorHandler.formatError(error)
      }
    }

    const [recipePath, ...paramArgs] = args
    
    if (!this.recipeEngine) {
      await this.initialize()
    }

    try {
      // Parse flags and parameters
      const flags = this.parseFlags(paramArgs)
      const parameters = this.parseParameters(paramArgs)
      
      const dryRun = flags.has('dryRun')
      const force = flags.has('force') 
      const skipPrompts = flags.has('skipPrompts')
      const continueOnError = flags.has('continueOnError')

      const options: RecipeExecutionOptions = {
        variables: parameters,
        workingDir: this.config.cwd || process.cwd(),
        dryRun,
        force,
        continueOnError,
        skipPrompts,
        logger: this.consoleLogger,
        onProgress: (progress) => {
          console.log(`📈 ${progress.step}: ${progress.phase} (${progress.percentage}%)`)
        },
        onStepComplete: (result) => {
          const status = result.status === 'completed' ? '✅' : 
                        result.status === 'failed' ? '❌' :
                        result.status === 'skipped' ? '⏭️' : '⏸️'
          console.log(`${status} Step: ${result.stepName} (${result.duration}ms)`)
        }
      }

      const result = await this.recipeEngine!.executeRecipe(recipePath, options)

      if (result.success) {
        let message = dryRun 
          ? `🔍 [DRY RUN] Recipe '${result.recipe.name}' would complete successfully`
          : `✅ Recipe '${result.recipe.name}' completed successfully`
        
        message += `\n\nExecution Summary:`
        message += `\n  Duration: ${result.duration}ms`
        message += `\n  Steps completed: ${result.metadata.completedSteps}/${result.metadata.totalSteps}`
        
        if (result.metadata.failedSteps > 0) {
          message += `\n  Failed steps: ${result.metadata.failedSteps}`
        }
        
        if (result.metadata.skippedSteps > 0) {
          message += `\n  Skipped steps: ${result.metadata.skippedSteps}`
        }
        
        if (result.filesCreated.length > 0) {
          message += dryRun 
            ? `\n\nFiles would be created: ${result.filesCreated.join(', ')}`
            : `\n\nFiles created: ${result.filesCreated.join(', ')}`
        }
        
        if (result.filesModified.length > 0) {
          message += dryRun 
            ? `\nFiles would be modified: ${result.filesModified.join(', ')}`
            : `\nFiles modified: ${result.filesModified.join(', ')}`
        }
        
        if (result.filesDeleted.length > 0) {
          message += dryRun 
            ? `\nFiles would be deleted: ${result.filesDeleted.join(', ')}`
            : `\nFiles deleted: ${result.filesDeleted.join(', ')}`
        }

        if (result.warnings.length > 0) {
          message += `\n\nWarnings:\n${result.warnings.map(w => `  ⚠️ ${w}`).join('\n')}`
        }
        
        return { success: true, message }
      } else {
        let message = `❌ Recipe execution failed: ${result.recipe.name || 'Unknown'}`
        
        if (result.errors.length > 0) {
          message += `\n\nErrors:\n${result.errors.map(e => `  • ${e}`).join('\n')}`
        }
        
        if (result.metadata.completedSteps > 0) {
          message += `\n\nCompleted ${result.metadata.completedSteps}/${result.metadata.totalSteps} steps before failure`
        }
        
        return { success: false, message }
      }

    } catch (error: any) {
      if (error instanceof HypergenError) {
        return {
          success: false,
          message: ErrorHandler.formatError(error)
        }
      }
      
      return {
        success: false,
        message: `❌ Recipe execution failed: ${error.message || String(error)}`
      }
    }
  }

  /**
   * Validate a recipe
   * Usage: hypergen recipe validate <recipe>
   */
  private async validateRecipe(args: string[]): Promise<{ success: boolean; message?: string }> {
    if (args.length === 0) {
      const error = ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        'Recipe path required',
        {},
        [
          {
            title: 'Provide recipe path',
            description: 'Specify the path to the recipe file to validate',
            command: 'hypergen recipe validate <recipe.yml>'
          }
        ]
      )
      return {
        success: false,
        message: ErrorHandler.formatError(error)
      }
    }

    const [recipePath] = args
    
    if (!this.recipeEngine) {
      await this.initialize()
    }

    try {
      const loadResult = await this.recipeEngine!.loadRecipe(recipePath)
      const { recipe, validation } = loadResult

      if (validation.isValid) {
        let message = `✅ Recipe validation successful: ${recipe.name}\n`
        message += `Description: ${recipe.description || 'No description'}\n`
        message += `Version: ${recipe.version || 'No version'}\n`
        message += `Category: ${recipe.category || 'No category'}\n`
        message += `Variables: ${Object.keys(recipe.variables).length}\n`
        message += `Steps: ${recipe.steps.length}\n`
        message += `Examples: ${recipe.examples?.length || 0}\n`
        
        if (validation.warnings.length > 0) {
          message += `\n⚠️  Warnings:\n`
          validation.warnings.forEach(warning => {
            message += `  • ${warning.message}\n`
          })
        }
        
        return { success: true, message }
      } else {
        let message = `❌ Recipe validation failed: ${recipe.name || recipePath}\n\n`
        message += 'Validation errors:\n'
        validation.errors.forEach(error => {
          message += `  • ${error.message}\n`
        })
        
        if (validation.warnings.length > 0) {
          message += `\nWarnings:\n`
          validation.warnings.forEach(warning => {
            message += `  • ${warning.message}\n`
          })
        }
        
        return { success: false, message }
      }

    } catch (error: any) {
      if (error instanceof HypergenError) {
        return {
          success: false,
          message: ErrorHandler.formatError(error)
        }
      }
      
      return {
        success: false,
        message: `❌ Failed to validate recipe: ${error.message || String(error)}`
      }
    }
  }

  /**
   * Show recipe information
   * Usage: hypergen recipe info <recipe>
   */
  private async showRecipeInfo(args: string[]): Promise<{ success: boolean; message?: string }> {
    if (args.length === 0) {
      return {
        success: false,
        message: 'Recipe path required. Usage: hypergen recipe info <recipe>'
      }
    }

    const [recipePath] = args
    
    if (!this.recipeEngine) {
      await this.initialize()
    }

    try {
      const loadResult = await this.recipeEngine!.loadRecipe(recipePath)
      const { recipe, validation } = loadResult
      
      if (!validation.isValid) {
        return {
          success: false,
          message: `❌ Recipe file is invalid. Use 'hypergen recipe validate' to see errors.`
        }
      }
      
      let message = `📋 Recipe: ${recipe.name}\n`
      
      if (recipe.description) {
        message += `Description: ${recipe.description}\n`
      }
      
      if (recipe.version) {
        message += `Version: ${recipe.version}\n`
      }
      
      if (recipe.author) {
        message += `Author: ${recipe.author}\n`
      }
      
      if (recipe.category) {
        message += `Category: ${recipe.category}\n`
      }
      
      if (recipe.tags?.length) {
        message += `Tags: ${recipe.tags.join(', ')}\n`
      }
      
      message += `\nVariables (${Object.keys(recipe.variables).length}):\n`
      
      for (const [varName, varConfig] of Object.entries(recipe.variables)) {
        message += `  • ${varName} (${varConfig.type})`
        
        if (varConfig.required) {
          message += ' *required*'
        }
        
        if (varConfig.default !== undefined) {
          message += ` [default: ${varConfig.default}]`
        }
        
        if (varConfig.description) {
          message += ` - ${varConfig.description}`
        }
        
        message += '\n'
      }

      message += `\nSteps (${recipe.steps.length}):\n`
      for (const [index, step] of recipe.steps.entries()) {
        message += `  ${index + 1}. ${step.name} (${step.tool})`
        
        if (step.description) {
          message += ` - ${step.description}`
        }
        
        if (step.dependsOn?.length) {
          message += ` [depends on: ${step.dependsOn.join(', ')}]`
        }
        
        message += '\n'
      }
      
      if (recipe.examples?.length) {
        message += `\nExamples (${recipe.examples.length}):\n`
        
        for (const example of recipe.examples) {
          message += `  • ${example.title}\n`
          
          if (example.description) {
            message += `    ${example.description}\n`
          }
          
          message += `    Variables: ${Object.keys(example.variables).join(', ')}\n`
        }
      }
      
      return { success: true, message }
    } catch (error: any) {
      return {
        success: false,
        message: `❌ Failed to read recipe: ${error.message || String(error)}`
      }
    }
  }

  /**
   * List recipes in directory
   * Usage: hypergen recipe list [directory]
   */
  private async listRecipes(args: string[]): Promise<{ success: boolean; message?: string }> {
    const [directory] = args
    const recipesDir = directory || '_recipes'

    try {
      // Use fs to find recipe files
      const fs = await import('fs')
      const path = await import('path')
      
      const fullPath = path.resolve(this.config.cwd || process.cwd(), recipesDir)
      
      if (!fs.existsSync(fullPath)) {
        return {
          success: true,
          message: `📝 No recipes directory found: ${recipesDir}\n\nTo create recipes:\n  1. Create the ${recipesDir} directory\n  2. Add .yml or .yaml recipe files\n  3. Run this command again`
        }
      }

      // Simple recursive file search for .yml and .yaml files
      const recipeFiles: string[] = []
      const searchDir = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullEntryPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            searchDir(fullEntryPath)
          } else if (entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))) {
            recipeFiles.push(fullEntryPath)
          }
        }
      }
      searchDir(fullPath)
      
      if (recipeFiles.length === 0) {
        return {
          success: true,
          message: `📝 No recipe files found in ${recipesDir}`
        }
      }

      if (!this.recipeEngine) {
        await this.initialize()
      }
      
      let message = `📝 Recipes found in ${recipesDir} (${recipeFiles.length}):\n`
      
      for (const filePath of recipeFiles) {
        try {
          const loadResult = await this.recipeEngine!.loadRecipe(filePath)
          const { recipe, validation } = loadResult
          
          const relativePath = path.relative(this.config.cwd || process.cwd(), filePath)
          message += `  • ${recipe.name || 'Unknown'} (${relativePath})`
          
          if (recipe.description) {
            message += ` - ${recipe.description}`
          }
          
          if (!validation.isValid) {
            message += ` ❌ (invalid)`
          }
          
          message += '\n'
        } catch (error) {
          const relativePath = path.relative(this.config.cwd || process.cwd(), filePath)
          message += `  • Error loading ${relativePath} ❌\n`
        }
      }
      
      return { success: true, message }
    } catch (error: any) {
      return {
        success: false,
        message: `❌ Failed to list recipes: ${error.message || String(error)}`
      }
    }
  }

  /**
   * List steps in a recipe
   * Usage: hypergen step list <recipe>
   */
  private async listRecipeSteps(args: string[]): Promise<{ success: boolean; message?: string }> {
    if (args.length === 0) {
      return {
        success: false,
        message: 'Recipe path required. Usage: hypergen step list <recipe>'
      }
    }

    const [recipePath] = args
    
    if (!this.recipeEngine) {
      await this.initialize()
    }

    try {
      const loadResult = await this.recipeEngine!.loadRecipe(recipePath)
      const { recipe, validation } = loadResult
      
      if (!validation.isValid) {
        return {
          success: false,
          message: `❌ Recipe file is invalid. Use 'hypergen recipe validate' to see errors.`
        }
      }
      
      if (recipe.steps.length === 0) {
        return {
          success: true,
          message: `📝 No steps found in recipe: ${recipe.name}`
        }
      }
      
      let message = `📋 Steps in recipe: ${recipe.name} (${recipe.steps.length})\n`
      
      for (const [index, step] of recipe.steps.entries()) {
        message += `\n${index + 1}. ${step.name}`
        
        if (step.description) {
          message += `\n   Description: ${step.description}`
        }
        
        message += `\n   Tool: ${step.tool}`
        
        if (step.dependsOn?.length) {
          message += `\n   Depends on: ${step.dependsOn.join(', ')}`
        }
        
        if ((step as any).condition) {
          message += `\n   Condition: ${(step as any).condition}`
        }
        
        if (step.continueOnError) {
          message += `\n   Continue on error: true`
        }
        
        // Show tool-specific configuration preview
        if ((step as any).template) {
          message += `\n   Template: ${(step as any).template}`
        }
        
        if ((step as any).action) {
          message += `\n   Action: ${(step as any).action}`
        }
        
        if ((step as any).recipe) {
          message += `\n   Sub-recipe: ${(step as any).recipe}`
        }
        
        message += '\n'
      }
      
      return { success: true, message }
    } catch (error: any) {
      return {
        success: false,
        message: `❌ Failed to list recipe steps: ${error.message || String(error)}`
      }
    }
  }

  /**
   * Execute a single step from a recipe
   * Usage: hypergen step execute <recipe> <step-name>
   */
  private async executeRecipeStep(args: string[]): Promise<{ success: boolean; message?: string }> {
    if (args.length < 2) {
      return {
        success: false,
        message: 'Recipe path and step name required. Usage: hypergen step execute <recipe> <step-name> [--var1=value1]'
      }
    }

    const [recipePath, stepName, ...paramArgs] = args
    
    if (!this.recipeEngine) {
      await this.initialize()
    }

    try {
      // Load recipe first
      const loadResult = await this.recipeEngine!.loadRecipe(recipePath)
      const { recipe, validation } = loadResult
      
      if (!validation.isValid) {
        return {
          success: false,
          message: `❌ Recipe file is invalid. Use 'hypergen recipe validate' to see errors.`
        }
      }

      // Find the specific step
      const step = recipe.steps.find(s => s.name === stepName)
      if (!step) {
        return {
          success: false,
          message: `❌ Step '${stepName}' not found in recipe '${recipe.name}'. Use 'hypergen step list ${recipePath}' to see available steps.`
        }
      }

      // Parse parameters
      const flags = this.parseFlags(paramArgs)
      const parameters = this.parseParameters(paramArgs)
      
      const dryRun = flags.has('dryRun')
      const force = flags.has('force')
      
      const options: RecipeExecutionOptions = {
        variables: parameters,
        workingDir: this.config.cwd || process.cwd(),
        dryRun,
        force,
        logger: this.consoleLogger
      }

      // Create a temporary recipe with just this step
      const singleStepRecipe = {
        ...recipe,
        steps: [step]
      }

      // Convert recipe back to YAML for execution
      const yaml = await import('js-yaml')
      const result = await this.recipeEngine!.executeRecipe({
        type: 'content',
        content: yaml.dump(singleStepRecipe),
        name: `${recipe.name}_${stepName}`
      }, options)

      if (result.success) {
        let message = dryRun 
          ? `🔍 [DRY RUN] Step '${stepName}' would complete successfully`
          : `✅ Step '${stepName}' completed successfully`
        
        message += `\n  Duration: ${result.duration}ms`
        
        if (result.filesCreated.length > 0) {
          message += dryRun 
            ? `\n  Files would be created: ${result.filesCreated.join(', ')}`
            : `\n  Files created: ${result.filesCreated.join(', ')}`
        }
        
        if (result.filesModified.length > 0) {
          message += dryRun 
            ? `\n  Files would be modified: ${result.filesModified.join(', ')}`
            : `\n  Files modified: ${result.filesModified.join(', ')}`
        }
        
        return { success: true, message }
      } else {
        let message = `❌ Step execution failed: ${stepName}`
        
        if (result.errors.length > 0) {
          message += `\n  Errors: ${result.errors.join(', ')}`
        }
        
        return { success: false, message }
      }

    } catch (error: any) {
      if (error instanceof HypergenError) {
        return {
          success: false,
          message: ErrorHandler.formatError(error)
        }
      }
      
      return {
        success: false,
        message: `❌ Step execution failed: ${error.message || String(error)}`
      }
    }
  }

  /**
   * Parse command line flags
   */
  private parseFlags(args: string[]): Set<string> {
    const flags = new Set<string>()
    
    for (const arg of args) {
      if (arg.startsWith('--')) {
        const flagName = arg.slice(2).split('=')[0]
        flags.add(flagName)
      }
    }
    
    return flags
  }

  /**
   * Parse command line parameters (key=value pairs)
   */
  private parseParameters(args: string[]): Record<string, any> {
    const parameters: Record<string, any> = {}
    const flagArgs = ['defaults', 'dryRun', 'force', 'skipPrompts', 'continueOnError'] // Known flags to exclude

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      
      if (arg.startsWith('--')) {
        const key = arg.slice(2)
        
        // Skip known flags
        if (flagArgs.includes(key)) {
          continue
        }
        
        if (arg.includes('=')) {
          // Format: --key=value
          const [paramKey, ...valueParts] = key.split('=')
          const value = valueParts.join('=')

          // Try to parse as JSON for complex values
          try {
            parameters[paramKey] = JSON.parse(value)
          } catch {
            parameters[paramKey] = value
          }
        } else {
          // Format: --key value (look ahead for value)
          const nextArg = args[i + 1]
          if (nextArg && !nextArg.startsWith('--')) {
            // Try to parse as JSON for complex values
            try {
              parameters[key] = JSON.parse(nextArg)
            } catch {
              parameters[key] = nextArg
            }
            i++ // Skip the value in next iteration
          } else {
            // No value provided, treat as boolean true
            parameters[key] = true
          }
        }
      }
    }

    return parameters
  }
}