/**
 * Template.yml Parser
 * 
 * Parses and validates template.yml files to extract action definitions
 * and variable configurations for code generation
 */

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { ErrorHandler, ErrorCode, withErrorHandling, validateParameter } from '../errors/hypergen-errors.js'
import type { RecipeConfig, RecipeStepUnion, ToolType } from '../recipe-engine/types.js'

export interface TemplateVariable {
  type: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object' | 'file' | 'directory'
  required?: boolean
  multiple?: boolean
  default?: any
  description?: string
  pattern?: string
  values?: string[]
  min?: number
  max?: number
  validation?: {
    message?: string
  }
}

export interface TemplateExample {
  title: string
  description?: string
  variables: Record<string, any>
}

export interface TemplateInclude {
  url: string
  version?: string
  variables?: Record<string, any> // Variable overrides
  condition?: string // JavaScript expression for conditional inclusion
  strategy?: 'merge' | 'replace' | 'extend' // Conflict resolution strategy
}

export interface TemplateDependency {
  name: string
  version?: string
  type?: 'npm' | 'github' | 'local' | 'http'
  url?: string
  optional?: boolean
  dev?: boolean
}

export interface TemplateConfig {
  name: string
  description?: string
  version?: string
  author?: string
  category?: string
  tags?: string[]
  variables: Record<string, TemplateVariable>
  examples?: TemplateExample[]
  dependencies?: string[] | TemplateDependency[] // Support both string[] and full dependency objects
  outputs?: string[]
  // V8 Recipe Step System - New!
  steps?: RecipeStepUnion[] // Recipe steps for V8 system
  // Advanced composition features
  extends?: string // Template inheritance
  includes?: TemplateInclude[] // Template composition
  conflicts?: {
    strategy: 'merge' | 'replace' | 'extend' | 'error'
    rules?: Record<string, 'merge' | 'replace' | 'extend' | 'error'>
  }
  // Versioning and compatibility
  engines?: {
    hypergen?: string
    node?: string
  }
  // Lifecycle hooks
  hooks?: {
    pre?: string[]
    post?: string[]
    error?: string[]
  }
  // V8 Recipe execution settings
  settings?: {
    timeout?: number
    retries?: number
    continueOnError?: boolean
    maxParallelSteps?: number
    workingDir?: string
  }
}

export interface ParsedTemplate {
  config: TemplateConfig
  filePath: string
  isValid: boolean
  errors: string[]
  warnings: string[]
}

export class TemplateParser {
  private static readonly SUPPORTED_VERSIONS = ['1.0.0']
  private static readonly VALID_VARIABLE_TYPES = ['string', 'number', 'boolean', 'enum', 'array', 'object', 'file', 'directory']
  private static readonly VALID_TOOL_TYPES: ToolType[] = ['template', 'action', 'codemod', 'recipe', 'shell']
  private static readonly VALID_STEP_STATUSES = ['pending', 'running', 'completed', 'failed', 'skipped', 'cancelled']

  /**
   * Parse a template.yml file and return validated configuration
   */
  static async parseTemplateFile(filePath: string): Promise<ParsedTemplate> {
    const result: ParsedTemplate = {
      config: {} as TemplateConfig,
      filePath,
      isValid: false,
      errors: [],
      warnings: []
    }

    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        result.errors.push(`Template file not found: ${filePath}`)
        return result
      }

      // Read and parse YAML
      const content = fs.readFileSync(filePath, 'utf-8')
      const parsed = yaml.load(content) as any

      if (!parsed || typeof parsed !== 'object') {
        result.errors.push('Invalid YAML format or empty file')
        return result
      }

      // Validate and build config
      result.config = this.validateAndBuildConfig(parsed, result.errors, result.warnings)
      result.isValid = result.errors.length === 0

      return result

    } catch (error: any) {
      result.errors.push(`Failed to parse template file: ${error.message}`)
      return result
    }
  }

  /**
   * Parse all template.yml files in a directory
   */
  static async parseTemplateDirectory(dirPath: string): Promise<ParsedTemplate[]> {
    const results: ParsedTemplate[] = []

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const templatePath = path.join(dirPath, entry.name, 'template.yml')
          if (fs.existsSync(templatePath)) {
            const parsed = await this.parseTemplateFile(templatePath)
            results.push(parsed)
          }
        }
      }

    } catch (error: any) {
      // Return empty array if directory doesn't exist or can't be read
      console.warn(`Warning: Could not read template directory: ${dirPath}`)
    }

    return results
  }

  /**
   * Validate template configuration and build normalized config object
   */
  private static validateAndBuildConfig(
    parsed: any,
    errors: string[],
    warnings: string[]
  ): TemplateConfig {
    const config: TemplateConfig = {
      name: '',
      variables: {}
    }

    // Validate required fields
    if (!parsed.name || typeof parsed.name !== 'string') {
      errors.push('Template name is required and must be a string')
    } else {
      config.name = parsed.name
    }

    if (!parsed.variables || typeof parsed.variables !== 'object') {
      errors.push('Template variables section is required and must be an object')
    } else {
      this.validateVariables(parsed.variables, config, errors, warnings)
    }

    // Validate optional fields
    if (parsed.description && typeof parsed.description === 'string') {
      config.description = parsed.description
    }

    if (parsed.version) {
      if (typeof parsed.version !== 'string') {
        warnings.push('Template version should be a string')
      } else {
        config.version = parsed.version
        if (!this.SUPPORTED_VERSIONS.includes(parsed.version)) {
          warnings.push(`Unsupported template version: ${parsed.version}`)
        }
      }
    }

    if (parsed.author && typeof parsed.author === 'string') {
      config.author = parsed.author
    }

    if (parsed.category && typeof parsed.category === 'string') {
      config.category = parsed.category
    }

    if (parsed.tags) {
      if (Array.isArray(parsed.tags)) {
        config.tags = parsed.tags.filter(tag => typeof tag === 'string')
        if (config.tags.length !== parsed.tags.length) {
          warnings.push('Some tags were ignored (must be strings)')
        }
      } else {
        warnings.push('Tags should be an array of strings')
      }
    }

    if (parsed.examples) {
      if (Array.isArray(parsed.examples)) {
        config.examples = this.validateExamples(parsed.examples, config.variables, warnings)
      } else {
        warnings.push('Examples should be an array')
      }
    }

    if (parsed.dependencies) {
      if (Array.isArray(parsed.dependencies)) {
        config.dependencies = this.validateDependencies(parsed.dependencies, warnings)
      } else {
        warnings.push('Dependencies should be an array')
      }
    }

    if (parsed.outputs) {
      if (Array.isArray(parsed.outputs)) {
        config.outputs = parsed.outputs.filter(output => typeof output === 'string')
      } else {
        warnings.push('Outputs should be an array of strings')
      }
    }

    // Validate engines
    if (parsed.engines) {
      config.engines = this.validateEngines(parsed.engines, warnings)
    }

    // Validate hooks
    if (parsed.hooks) {
      config.hooks = this.validateHooks(parsed.hooks, warnings)
    }

    // V8 Recipe Step System validation
    if (parsed.steps) {
      if (Array.isArray(parsed.steps)) {
        config.steps = this.validateSteps(parsed.steps, config.variables, errors, warnings)
      } else {
        warnings.push('Steps should be an array')
      }
    }

    // V8 Recipe settings validation
    if (parsed.settings) {
      config.settings = this.validateSettings(parsed.settings, warnings)
    }

    return config
  }

  /**
   * Validate variables section of template configuration
   */
  private static validateVariables(
    variables: any,
    config: TemplateConfig,
    errors: string[],
    warnings: string[]
  ): void {
    for (const [varName, varConfig] of Object.entries(variables)) {
      if (!varConfig || typeof varConfig !== 'object') {
        errors.push(`Variable '${varName}' must be an object`)
        continue
      }

      const variable = this.validateVariable(varName, varConfig as any, errors, warnings)
      if (variable) {
        config.variables[varName] = variable
      }
    }
  }

  /**
   * Validate individual variable configuration
   */
  private static validateVariable(
    varName: string,
    varConfig: any,
    errors: string[],
    warnings: string[]
  ): TemplateVariable | null {
    const variable: TemplateVariable = {
      type: 'string'
    }

    // Validate type
    if (!varConfig.type) {
      errors.push(`Variable '${varName}' must have a type`)
      return null
    }

    if (!this.VALID_VARIABLE_TYPES.includes(varConfig.type)) {
      errors.push(`Variable '${varName}' has invalid type: ${varConfig.type}`)
      return null
    }

    variable.type = varConfig.type

    // Validate required field
    if (varConfig.required !== undefined) {
      if (typeof varConfig.required !== 'boolean') {
        warnings.push(`Variable '${varName}' required field should be boolean`)
      } else {
        variable.required = varConfig.required
      }
    }

    // Validate default value
    if (varConfig.default !== undefined) {
      if (variable.required) {
        warnings.push(`Variable '${varName}' cannot have default value when required`)
      } else {
        variable.default = varConfig.default
      }
    }

    // Validate description
    if (varConfig.description) {
      if (typeof varConfig.description !== 'string') {
        warnings.push(`Variable '${varName}' description should be a string`)
      } else {
        variable.description = varConfig.description
      }
    }

    // Validate pattern (for string types)
    if (varConfig.pattern) {
      if (variable.type !== 'string') {
        warnings.push(`Variable '${varName}' pattern only applies to string types`)
      } else if (typeof varConfig.pattern !== 'string') {
        warnings.push(`Variable '${varName}' pattern should be a string`)
      } else {
        try {
          new RegExp(varConfig.pattern)
          variable.pattern = varConfig.pattern
        } catch (error) {
          errors.push(`Variable '${varName}' has invalid regex pattern: ${varConfig.pattern}`)
        }
      }
    }

    // Validate enum values
    if (varConfig.values) {
      if (variable.type !== 'enum') {
        warnings.push(`Variable '${varName}' values only apply to enum types`)
      } else if (!Array.isArray(varConfig.values)) {
        errors.push(`Variable '${varName}' values must be an array`)
      } else {
        variable.values = varConfig.values.filter(val => typeof val === 'string')
        if (variable.values.length === 0) {
          errors.push(`Variable '${varName}' enum must have at least one value`)
        }
      }
    }

    // Validate min/max (for number types)
    if (varConfig.min !== undefined) {
      if (variable.type !== 'number') {
        warnings.push(`Variable '${varName}' min only applies to number types`)
      } else if (typeof varConfig.min !== 'number') {
        warnings.push(`Variable '${varName}' min should be a number`)
      } else {
        variable.min = varConfig.min
      }
    }

    if (varConfig.max !== undefined) {
      if (variable.type !== 'number') {
        warnings.push(`Variable '${varName}' max only applies to number types`)
      } else if (typeof varConfig.max !== 'number') {
        warnings.push(`Variable '${varName}' max should be a number`)
      } else {
        variable.max = varConfig.max
      }
    }

    return variable
  }

  /**
   * Validate examples section
   */
  private static validateExamples(
    examples: any[],
    variables: Record<string, TemplateVariable>,
    warnings: string[]
  ): TemplateExample[] {
    const validExamples: TemplateExample[] = []

    for (const [index, example] of examples.entries()) {
      if (!example || typeof example !== 'object') {
        warnings.push(`Example ${index + 1} must be an object`)
        continue
      }

      if (!example.title || typeof example.title !== 'string') {
        warnings.push(`Example ${index + 1} must have a title`)
        continue
      }

      if (!example.variables || typeof example.variables !== 'object') {
        warnings.push(`Example ${index + 1} must have variables`)
        continue
      }

      const validExample: TemplateExample = {
        title: example.title,
        variables: example.variables
      }

      if (example.description && typeof example.description === 'string') {
        validExample.description = example.description
      }

      // Validate example variables against template variables
      for (const [varName, varValue] of Object.entries(example.variables)) {
        if (!variables[varName]) {
          warnings.push(`Example ${index + 1} references undefined variable: ${varName}`)
        }
      }

      validExamples.push(validExample)
    }

    return validExamples
  }

  /**
   * Validate variable value against template variable definition
   */
  static validateVariableValue(
    varName: string,
    value: any,
    variable: TemplateVariable
  ): { isValid: boolean; error?: string } {
    // Check required
    if (variable.required && (value === undefined || value === null || value === '')) {
      return { isValid: false, error: `Variable '${varName}' is required` }
    }

    // If value is undefined and not required, use default
    if (value === undefined && variable.default !== undefined) {
      return { isValid: true }
    }

    // If value is undefined and no default, skip validation
    if (value === undefined) {
      return { isValid: true }
    }

    // Type validation
    switch (variable.type) {
      case 'string':
        if (typeof value !== 'string') {
          return { isValid: false, error: `Variable '${varName}' must be a string` }
        }
        if (variable.pattern) {
          const regex = new RegExp(variable.pattern)
          if (!regex.test(value)) {
            return { isValid: false, error: `Variable '${varName}' does not match pattern: ${variable.pattern}` }
          }
        }
        break

      case 'number':
        if (typeof value !== 'number') {
          return { isValid: false, error: `Variable '${varName}' must be a number` }
        }
        if (variable.min !== undefined && value < variable.min) {
          return { isValid: false, error: `Variable '${varName}' must be >= ${variable.min}` }
        }
        if (variable.max !== undefined && value > variable.max) {
          return { isValid: false, error: `Variable '${varName}' must be <= ${variable.max}` }
        }
        break

      case 'boolean':
        if (typeof value !== 'boolean') {
          return { isValid: false, error: `Variable '${varName}' must be a boolean` }
        }
        break

      case 'enum':
        if (variable.multiple && Array.isArray(value)) {
          // Validate each value in array
          const invalid = value.find(v => !variable.values?.includes(v))
          if (invalid) {
            return { isValid: false, error: `Value '${invalid}' for variable '${varName}' must be one of: ${variable.values?.join(', ')}` }
          }
        } else if (!variable.values || !variable.values.includes(value)) {
          return { isValid: false, error: `Variable '${varName}' must be one of: ${variable.values?.join(', ')}` }
        }
        break

      case 'array':
        if (!Array.isArray(value)) {
          return { isValid: false, error: `Variable '${varName}' must be an array` }
        }
        break

      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return { isValid: false, error: `Variable '${varName}' must be an object` }
        }
        break
    }

    return { isValid: true }
  }

  /**
   * Get resolved variable value (with default if not provided)
   */
  static getResolvedValue(value: any, variable: TemplateVariable): any {
    if (value !== undefined) {
      return value
    }
    return variable.default
  }

  /**
   * Validate dependencies array (supports both string[] and TemplateDependency[])
   */
  private static validateDependencies(dependencies: any[], warnings: string[]): string[] | TemplateDependency[] {
    const result: TemplateDependency[] = []
    
    for (const [index, dep] of dependencies.entries()) {
      if (typeof dep === 'string') {
        // Convert string to TemplateDependency
        result.push({ name: dep, type: 'npm' })
      } else if (typeof dep === 'object' && dep !== null) {
        // Validate TemplateDependency object
        const dependency = this.validateDependency(dep, index, warnings)
        if (dependency) {
          result.push(dependency)
        }
      } else {
        warnings.push(`Dependency ${index + 1} must be a string or object`)
      }
    }
    
    return result
  }

  /**
   * Validate individual dependency object
   */
  private static validateDependency(dep: any, index: number, warnings: string[]): TemplateDependency | null {
    if (!dep.name || typeof dep.name !== 'string') {
      warnings.push(`Dependency ${index + 1} must have a name`)
      return null
    }

    const dependency: TemplateDependency = {
      name: dep.name
    }

    if (dep.version && typeof dep.version === 'string') {
      dependency.version = dep.version
    }

    if (dep.type && ['npm', 'github', 'local', 'http'].includes(dep.type)) {
      dependency.type = dep.type
    }

    if (dep.url && typeof dep.url === 'string') {
      dependency.url = dep.url
    }

    if (dep.optional !== undefined && typeof dep.optional === 'boolean') {
      dependency.optional = dep.optional
    }

    if (dep.dev !== undefined && typeof dep.dev === 'boolean') {
      dependency.dev = dep.dev
    }

    return dependency
  }

  /**
   * Validate engines configuration
   */
  private static validateEngines(engines: any, warnings: string[]): Record<string, string> {
    const result: Record<string, string> = {}

    if (typeof engines !== 'object' || engines === null) {
      warnings.push('Engines should be an object')
      return result
    }

    if (engines.hypergen && typeof engines.hypergen === 'string') {
      result.hypergen = engines.hypergen
    }

    if (engines.node && typeof engines.node === 'string') {
      result.node = engines.node
    }

    return result
  }

  /**
   * Validate hooks configuration
   */
  private static validateHooks(hooks: any, warnings: string[]): { pre?: string[]; post?: string[]; error?: string[] } {
    const result: { pre?: string[]; post?: string[]; error?: string[] } = {}

    if (typeof hooks !== 'object' || hooks === null) {
      warnings.push('Hooks should be an object')
      return result
    }

    if (hooks.pre) {
      if (Array.isArray(hooks.pre)) {
        result.pre = hooks.pre.filter(hook => typeof hook === 'string')
        if (result.pre.length !== hooks.pre.length) {
          warnings.push('Some pre hooks were ignored (must be strings)')
        }
      } else {
        warnings.push('Pre hooks should be an array of strings')
      }
    }

    if (hooks.post) {
      if (Array.isArray(hooks.post)) {
        result.post = hooks.post.filter(hook => typeof hook === 'string')
        if (result.post.length !== hooks.post.length) {
          warnings.push('Some post hooks were ignored (must be strings)')
        }
      } else {
        warnings.push('Post hooks should be an array of strings')
      }
    }

    if (hooks.error) {
      if (Array.isArray(hooks.error)) {
        result.error = hooks.error.filter(hook => typeof hook === 'string')
        if (result.error.length !== hooks.error.length) {
          warnings.push('Some error hooks were ignored (must be strings)')
        }
      } else {
        warnings.push('Error hooks should be an array of strings')
      }
    }

    return result
  }

  /**
   * Validate recipe steps array (V8 Recipe Step System)
   */
  private static validateSteps(
    steps: any[],
    variables: Record<string, TemplateVariable>,
    errors: string[],
    warnings: string[]
  ): RecipeStepUnion[] {
    const validSteps: RecipeStepUnion[] = []
    const stepNames = new Set<string>()
    const stepDependencies = new Map<string, string[]>()

    for (const [index, step] of steps.entries()) {
      if (!step || typeof step !== 'object') {
        errors.push(`Step ${index + 1} must be an object`)
        continue
      }

      const validStep = this.validateStep(step, index + 1, variables, errors, warnings)
      if (validStep) {
        // Check for duplicate step names
        if (stepNames.has(validStep.name)) {
          errors.push(`Duplicate step name: '${validStep.name}'`)
        } else {
          stepNames.add(validStep.name)
        }

        validSteps.push(validStep)

        // Track dependencies for circular dependency check
        if (validStep.dependsOn) {
          stepDependencies.set(validStep.name, validStep.dependsOn)
        }
      }
    }

    // Check for circular dependencies
    this.validateStepDependencies(stepDependencies, errors)

    // Validate step dependencies reference existing steps
    this.validateStepDependencyReferences(stepDependencies, stepNames, warnings)

    return validSteps
  }

  /**
   * Validate individual recipe step
   */
  private static validateStep(
    step: any,
    index: number,
    variables: Record<string, TemplateVariable>,
    errors: string[],
    warnings: string[]
  ): RecipeStepUnion | null {
    // Validate required fields
    if (!step.name || typeof step.name !== 'string') {
      errors.push(`Step ${index} must have a name (string)`)
      return null
    }

    // Tool inference / Shorthand support
    if (!step.tool) {
      if (step.command) {
        step.tool = 'shell'
      } else if (step.recipe) {
        step.tool = 'recipe'
      } else if (step.template) {
        step.tool = 'template'
      } else if (step.action) {
        step.tool = 'action'
      } else if (step.codemod) {
        step.tool = 'codemod'
      }
    }

    if (!step.tool || !this.VALID_TOOL_TYPES.includes(step.tool)) {
      errors.push(`Step '${step.name}' must have a valid tool type (${this.VALID_TOOL_TYPES.join(', ')})`)
      return null
    }

    // Base step configuration
    const baseStep = {
      name: step.name,
      tool: step.tool as ToolType
    }

    // Validate optional base fields
    if (step.description && typeof step.description === 'string') {
      (baseStep as any).description = step.description
    }

    if (step.when && typeof step.when === 'string') {
      // Basic condition validation - check if it looks like a valid expression
      if (this.validateConditionExpression(step.when)) {
        (baseStep as any).when = step.when
      } else {
(baseStep as any).when = step.when; warnings.push(`Step '${step.name}' has potentially invalid condition expression`)
      }
    }

    if (step.dependsOn) {
      if (Array.isArray(step.dependsOn)) {
        const validDeps = step.dependsOn.filter(dep => typeof dep === 'string')
        if (validDeps.length !== step.dependsOn.length) {
          warnings.push(`Step '${step.name}' has some invalid dependencies (must be strings)`)
        }
        if (validDeps.length > 0) {
          (baseStep as any).dependsOn = validDeps
        }
      } else {
        warnings.push(`Step '${step.name}' dependsOn should be an array of strings`)
      }
    }

    if (step.parallel !== undefined && typeof step.parallel === 'boolean') {
      (baseStep as any).parallel = step.parallel
    }

    if (step.continueOnError !== undefined && typeof step.continueOnError === 'boolean') {
      (baseStep as any).continueOnError = step.continueOnError
    }

    if (step.timeout !== undefined && typeof step.timeout === 'number' && step.timeout > 0) {
      (baseStep as any).timeout = step.timeout
    }

    if (step.retries !== undefined && typeof step.retries === 'number' && step.retries >= 0) {
      (baseStep as any).retries = step.retries
    }

    if (step.tags && Array.isArray(step.tags)) {
      const validTags = step.tags.filter(tag => typeof tag === 'string')
      if (validTags.length > 0) {
        (baseStep as any).tags = validTags
      }
    }

    if (step.variables && typeof step.variables === 'object' && step.variables !== null) {
      (baseStep as any).variables = step.variables
    }

    if (step.environment && typeof step.environment === 'object' && step.environment !== null) {
      (baseStep as any).environment = step.environment
    }

    // Tool-specific validation
    switch (step.tool) {
      case 'template':
        return this.validateTemplateStep(baseStep, step, errors, warnings)
      case 'action':
        return this.validateActionStep(baseStep, step, errors, warnings)
      case 'codemod':
        return this.validateCodeModStep(baseStep, step, errors, warnings)
      case 'recipe':
        return this.validateRecipeStep(baseStep, step, errors, warnings)
      default:
        errors.push(`Step '${step.name}' has unsupported tool type: ${step.tool}`)
        return null
    }
  }

  /**
   * Validate template step configuration
   */
  private static validateTemplateStep(
    baseStep: any,
    step: any,
    errors: string[],
    warnings: string[]
  ): RecipeStepUnion | null {
    if (!step.template || typeof step.template !== 'string') {
      errors.push(`Template step '${step.name}' must have a template (string)`)
      return null
    }

    const templateStep = {
      ...baseStep,
      template: step.template
    }

    if (step.engine && ['liquid', 'auto'].includes(step.engine)) {
      templateStep.engine = step.engine
    }

    if (step.outputDir && typeof step.outputDir === 'string') {
      templateStep.outputDir = step.outputDir
    }

    if (step.overwrite !== undefined && typeof step.overwrite === 'boolean') {
      templateStep.overwrite = step.overwrite
    }

    if (step.exclude && Array.isArray(step.exclude)) {
      const validExcludes = step.exclude.filter(pattern => typeof pattern === 'string')
      if (validExcludes.length > 0) {
        templateStep.exclude = validExcludes
      }
    }

    if (step.templateConfig && typeof step.templateConfig === 'object') {
      templateStep.templateConfig = step.templateConfig
    }

    return templateStep as RecipeStepUnion
  }

  /**
   * Validate action step configuration
   */
  private static validateActionStep(
    baseStep: any,
    step: any,
    errors: string[],
    warnings: string[]
  ): RecipeStepUnion | null {
    if (!step.action || typeof step.action !== 'string') {
      errors.push(`Action step '${step.name}' must have an action (string)`)
      return null
    }

    const actionStep = {
      ...baseStep,
      action: step.action
    }

    if (step.parameters && typeof step.parameters === 'object' && step.parameters !== null) {
      actionStep.parameters = step.parameters
    }

    if (step.dryRun !== undefined && typeof step.dryRun === 'boolean') {
      actionStep.dryRun = step.dryRun
    }

    if (step.force !== undefined && typeof step.force === 'boolean') {
      actionStep.force = step.force
    }

    if (step.actionConfig && typeof step.actionConfig === 'object') {
      actionStep.actionConfig = step.actionConfig
    }

    return actionStep as RecipeStepUnion
  }

  /**
   * Validate codemod step configuration
   */
  private static validateCodeModStep(
    baseStep: any,
    step: any,
    errors: string[],
    warnings: string[]
  ): RecipeStepUnion | null {
    if (!step.codemod || typeof step.codemod !== 'string') {
      errors.push(`CodeMod step '${step.name}' must have a codemod (string)`)
      return null
    }

    if (!step.files || !Array.isArray(step.files) || step.files.length === 0) {
      errors.push(`CodeMod step '${step.name}' must have a files array with at least one pattern`)
      return null
    }

    const validFiles = step.files.filter(file => typeof file === 'string')
    if (validFiles.length !== step.files.length) {
      warnings.push(`CodeMod step '${step.name}' has some invalid file patterns (must be strings)`)
    }

    if (validFiles.length === 0) {
      errors.push(`CodeMod step '${step.name}' must have at least one valid file pattern`)
      return null
    }

    const codemodStep = {
      ...baseStep,
      codemod: step.codemod,
      files: validFiles
    }

    if (step.backup !== undefined && typeof step.backup === 'boolean') {
      codemodStep.backup = step.backup
    }

    if (step.parser && ['typescript', 'javascript', 'json', 'auto'].includes(step.parser)) {
      codemodStep.parser = step.parser
    }

    if (step.parameters && typeof step.parameters === 'object' && step.parameters !== null) {
      codemodStep.parameters = step.parameters
    }

    if (step.force !== undefined && typeof step.force === 'boolean') {
      codemodStep.force = step.force
    }

    if (step.codemodConfig && typeof step.codemodConfig === 'object') {
      codemodStep.codemodConfig = step.codemodConfig
    }

    return codemodStep as RecipeStepUnion
  }

  /**
   * Validate recipe step configuration
   */
  private static validateRecipeStep(
    baseStep: any,
    step: any,
    errors: string[],
    warnings: string[]
  ): RecipeStepUnion | null {
    if (!step.recipe || typeof step.recipe !== 'string') {
      errors.push(`Recipe step '${step.name}' must have a recipe (string)`)
      return null
    }

    const recipeStep = {
      ...baseStep,
      recipe: step.recipe
    }

    if (step.version && typeof step.version === 'string') {
      recipeStep.version = step.version
    }

    if (step.inheritVariables !== undefined && typeof step.inheritVariables === 'boolean') {
      recipeStep.inheritVariables = step.inheritVariables
    }

    if (step.variableOverrides && typeof step.variableOverrides === 'object' && step.variableOverrides !== null) {
      recipeStep.variableOverrides = step.variableOverrides
    }

    if (step.recipeConfig && typeof step.recipeConfig === 'object') {
      recipeStep.recipeConfig = step.recipeConfig
    }

    return recipeStep as RecipeStepUnion
  }

  /**
   * Validate step dependencies for circular references
   */
  private static validateStepDependencies(
    dependencies: Map<string, string[]>,
    errors: string[]
  ): void {
    const visited = new Set<string>()
    const recursionStack = new Set<string>()

    const detectCycle = (stepName: string, path: string[]): string[] | null => {
      if (recursionStack.has(stepName)) {
        // Found a cycle - return the cycle path
        const cycleStart = path.indexOf(stepName)
        return path.slice(cycleStart).concat(stepName)
      }

      if (visited.has(stepName)) {
        return null // Already processed
      }

      visited.add(stepName)
      recursionStack.add(stepName)
      const currentPath = [...path, stepName]

      const stepDeps = dependencies.get(stepName) || []
      for (const dep of stepDeps) {
        const cycle = detectCycle(dep, currentPath)
        if (cycle) {
          return cycle
        }
      }

      recursionStack.delete(stepName)
      return null
    }

    for (const stepName of dependencies.keys()) {
      if (!visited.has(stepName)) {
        const cycle = detectCycle(stepName, [])
        if (cycle) {
          errors.push(`Circular dependency detected: ${cycle.join(' -> ')}`)
          break // Report only the first cycle found
        }
      }
    }
  }

  /**
   * Validate that step dependencies reference existing steps
   */
  private static validateStepDependencyReferences(
    dependencies: Map<string, string[]>,
    stepNames: Set<string>,
    warnings: string[]
  ): void {
    for (const [stepName, deps] of dependencies) {
      for (const dep of deps) {
        if (!stepNames.has(dep)) {
          warnings.push(`Step '${stepName}' depends on undefined step: '${dep}'`)
        }
      }
    }
  }

  /**
   * Basic validation of condition expressions
   */
  private static validateConditionExpression(condition: string): boolean {
    // Basic validation - just check if it looks like a reasonable expression
    // More sophisticated validation could be added later
    if (!condition.trim()) {
      return false
    }

    // Check for obviously invalid patterns
    const invalidPatterns = [
      /^[{}()\[\].,;]*$/, // Only punctuation
      /^\d+$/, // Only numbers
      /^[a-zA-Z_$][a-zA-Z0-9_$]*\s*$/, // Only a single identifier
    ]

    return !invalidPatterns.some(pattern => pattern.test(condition.trim()))
  }

  /**
   * Validate recipe execution settings
   */
  private static validateSettings(
    settings: any,
    warnings: string[]
  ): { timeout?: number; retries?: number; continueOnError?: boolean; maxParallelSteps?: number; workingDir?: string } {
    const result: any = {}

    if (typeof settings !== 'object' || settings === null) {
      warnings.push('Settings should be an object')
      return result
    }

    if (settings.timeout !== undefined) {
      if (typeof settings.timeout === 'number' && settings.timeout > 0) {
        result.timeout = settings.timeout
      } else {
        warnings.push('Settings timeout should be a positive number')
      }
    }

    if (settings.retries !== undefined) {
      if (typeof settings.retries === 'number' && settings.retries >= 0) {
        result.retries = settings.retries
      } else {
        warnings.push('Settings retries should be a non-negative number')
      }
    }

    if (settings.continueOnError !== undefined) {
      if (typeof settings.continueOnError === 'boolean') {
        result.continueOnError = settings.continueOnError
      } else {
        warnings.push('Settings continueOnError should be a boolean')
      }
    }

    if (settings.maxParallelSteps !== undefined) {
      if (typeof settings.maxParallelSteps === 'number' && settings.maxParallelSteps > 0) {
        result.maxParallelSteps = settings.maxParallelSteps
      } else {
        warnings.push('Settings maxParallelSteps should be a positive number')
      }
    }

    if (settings.workingDir !== undefined) {
      if (typeof settings.workingDir === 'string') {
        result.workingDir = settings.workingDir
      } else {
        warnings.push('Settings workingDir should be a string')
      }
    }

    return result
  }

  /**
   * Check if a template version is compatible with current engine
   */
  static isVersionCompatible(templateEngines?: { hypergen?: string; node?: string }): boolean {
    if (!templateEngines) {
      return true // No specific requirements
    }

    // For now, return true - in a real implementation, this would check:
    // - Current Hypergen version against templateEngines.hypergen
    // - Current Node.js version against templateEngines.node
    return true
  }

  /**
   * Check if this configuration uses V8 Recipe Step System
   */
  static isRecipeConfig(config: TemplateConfig): config is TemplateConfig & { steps: RecipeStepUnion[] } {
    return Array.isArray(config.steps) && config.steps.length > 0
  }

  /**
   * Convert a TemplateConfig to RecipeConfig (V8 Recipe Step System)
   */
  static toRecipeConfig(templateConfig: TemplateConfig): RecipeConfig | null {
    if (!this.isRecipeConfig(templateConfig)) {
      return null // Not a recipe configuration
    }

    const recipeConfig: RecipeConfig = {
      name: templateConfig.name,
      variables: templateConfig.variables,
      steps: templateConfig.steps
    }

    // Copy optional fields
    if (templateConfig.description) recipeConfig.description = templateConfig.description
    if (templateConfig.version) recipeConfig.version = templateConfig.version
    if (templateConfig.author) recipeConfig.author = templateConfig.author
    if (templateConfig.category) recipeConfig.category = templateConfig.category
    if (templateConfig.tags) recipeConfig.tags = templateConfig.tags
    if (templateConfig.outputs) recipeConfig.outputs = templateConfig.outputs
    if (templateConfig.engines) recipeConfig.engines = templateConfig.engines

    // Convert examples if present
    if (templateConfig.examples) {
      recipeConfig.examples = templateConfig.examples.map(example => ({
        title: example.title,
        description: example.description,
        variables: example.variables
      }))
    }

    // Convert dependencies if present
    if (templateConfig.dependencies) {
      recipeConfig.dependencies = templateConfig.dependencies.map(dep => {
        if (typeof dep === 'string') {
          return {
            name: dep,
            type: 'npm' as const
          }
        }
        return {
          name: dep.name,
          version: dep.version,
          type: (dep.type as any) || 'npm',
          url: dep.url,
          optional: dep.optional,
          dev: dep.dev
        }
      })
    }

    // Convert hooks if present
    if (templateConfig.hooks) {
      recipeConfig.hooks = {
        beforeRecipe: templateConfig.hooks.pre,
        afterRecipe: templateConfig.hooks.post,
        onError: templateConfig.hooks.error
      }
    }

    // Convert settings if present
    if (templateConfig.settings) {
      recipeConfig.settings = templateConfig.settings
    }

    // Handle composition (extends/includes) - map to recipe composition
    if (templateConfig.extends || templateConfig.includes) {
      recipeConfig.composition = {}
      
      if (templateConfig.extends) {
        recipeConfig.composition.extends = templateConfig.extends
      }
      
      if (templateConfig.includes) {
        recipeConfig.composition.includes = templateConfig.includes.map(include => ({
          recipe: include.url, // Map URL to recipe identifier
          version: include.version,
          variables: include.variables,
          condition: include.condition,
          strategy: include.strategy
        }))
      }
      
      if (templateConfig.conflicts) {
        recipeConfig.composition.conflicts = templateConfig.conflicts
      }
    }

    return recipeConfig
  }

  /**
   * Validate that step configuration matches expected tool schema
   */
  static validateStepToolConfiguration(
    step: RecipeStepUnion,
    errors: string[],
    warnings: string[]
  ): void {
    switch (step.tool) {
      case 'template':
        // Additional template-specific validation can be added here
        break
      case 'action':
        // Additional action-specific validation can be added here
        break
      case 'codemod':
        // Additional codemod-specific validation can be added here
        break
      case 'recipe':
        // Additional recipe-specific validation can be added here
        break
      default:
        errors.push(`Unknown tool type: ${(step as any).tool}`)
    }
  }

  /**
   * Compare two semantic versions
   */
  static compareVersions(version1: string, version2: string): number {
    const v1Parts = version1.split('.').map(Number)
    const v2Parts = version2.split('.').map(Number)
    
    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      const v1Part = v1Parts[i] || 0
      const v2Part = v2Parts[i] || 0
      
      if (v1Part > v2Part) return 1
      if (v1Part < v2Part) return -1
    }
    
    return 0
  }
}