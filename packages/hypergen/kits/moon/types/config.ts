/**
 * Configuration Types for Hypergen Kit System
 *
 * These types define the schema for kit.yml, cookbook.yml, and recipe.yml
 * files to support default recipes and hierarchical configuration.
 */

// ===== Kit Configuration Types =====

export interface KitConfig {
  /** Kit name (e.g., "@hyper-kits/moon") */
  name: string;
  /** Kit description */
  description: string;
  /** Semantic version */
  version: string;
  /** Author information */
  author?: string;
  /** Homepage URL */
  homepage?: string;
  /** Repository URL */
  repository?: string;
  /** Keywords for discovery */
  keywords?: string[];
  /** License */
  license?: string;

  /** Default cookbook, recipe, or direct recipe configuration */
  defaults?: KitDefaults;

  /** Available cookbooks in this kit - glob patterns or explicit references */
  cookbooks?: string[] | CookbookReference[];

  /** Direct recipes that don't belong to a cookbook - glob patterns */
  recipes?: string[];

  /** Kit-wide variables available to all recipes */
  variables?: Record<string, VariableConfig>;

  /** Tags for categorization */
  tags?: string[];

  /** Categories for organization */
  categories?: string[];

  /** Shared templates and partials */
  shared?: SharedConfig;
}

export interface KitDefaults {
  /** Default cookbook when none specified */
  cookbook?: string;
  /** Default recipe when none specified (cookbook or direct) */
  recipe?: string;
  /** Per-cookbook default recipes */
  cookbookDefaults?: Record<string, string>; // cookbookName -> defaultRecipe
  /** Default direct recipe when no cookbook specified */
  directRecipe?: string;
}

export interface CookbookReference {
  /** Cookbook name */
  name: string;
  /** Cookbook description */
  description: string;
  /** Path to cookbook directory */
  path: string;
  /** Default recipe for this cookbook (overrides kit-level) */
  defaultRecipe?: string;
}

export interface SharedConfig {
  /** Glob patterns for shared templates */
  templates?: string[];
  /** Glob patterns for shared partials */
  partials?: string[];
}

// ===== Cookbook Configuration Types =====

export interface CookbookConfig {
  /** Cookbook name */
  name: string;
  /** Cookbook description */
  description: string;
  /** Semantic version */
  version: string;
  /** Default recipe for this cookbook */
  defaultRecipe?: string;
  /** Cookbook-specific variables */
  variables?: Record<string, VariableConfig>;
  /** Available recipes */
  recipes: RecipeReference[];
  /** Extend another cookbook */
  extends?: string;
  /** Lifecycle hooks */
  hooks?: CookbookHooks;
}

export interface RecipeReference {
  /** Recipe name */
  name: string;
  /** Recipe description */
  description: string;
  /** Path to recipe directory */
  path: string;
}

export interface CookbookHooks {
  /** Script to run before recipe execution */
  preExecute?: string;
  /** Script to run after recipe execution */
  postExecute?: string;
}

// ===== Recipe Configuration Types =====

export interface RecipeConfig {
  /** Recipe name */
  name: string;
  /** Recipe description */
  description: string;
  /** Semantic version */
  version?: string;
  /** Inherit variables from kit/cookbook */
  inheritVariables?: boolean;
  /** Recipe-specific variables */
  variables?: Record<string, VariableConfig>;
  /** Execution steps configuration */
  steps?: StepConfig[] | StepSections;
  /** Tags for categorization */
  tags?: string[];
  /** Difficulty level */
  difficulty?: "beginner" | "intermediate" | "advanced";
  /** Estimated completion time (e.g., "5 minutes") */
  estimatedTime?: string;
}

export interface StepSections {
  /** Steps to execute before automatic template processing */
  pre?: StepConfig[];
  /** Steps to execute after automatic template processing */
  post?: StepConfig[];
}

export interface VariableConfig {
  /** Variable type */
  type: "string" | "number" | "boolean" | "enum" | "array" | "object" | "file" | "directory";
  /** Prompt text for interactive input */
  prompt?: string;
  /** Whether the variable is required */
  required?: boolean;
  /** Default value */
  default?: any;
  /** Description for documentation */
  description?: string;
  /** Validation rules */
  validate?: ValidationConfig;
  /** Available values (for enum type) */
  values?: string[];
  /** Array item schema (for array type) */
  items?: VariableConfig;
  /** Object properties (for object type) */
  properties?: Record<string, VariableConfig>;
}

export interface ValidationConfig {
  /** Regex pattern for string validation */
  pattern?: string;
  /** Error message for validation failure */
  message?: string;
  /** Minimum value/length */
  min?: number;
  /** Maximum value/length */
  max?: number;
}

export type StepConfig =
  | TemplateStep
  | ActionStep
  | CodemodStep
  | RecipeStep
  | ShellStep;

export interface BaseStep {
  /** Step name */
  name: string;
  /** Tool to use */
  tool: "template" | "action" | "codemod" | "recipe" | "shell";
  /** Condition for execution (LiquidJS expression) */
  condition?: string;
}

export interface TemplateStep extends BaseStep {
  tool: "template";
  /** Template file or directory */
  template: string;
  /** Output path (optional) */
  to?: string;
  /** Whether to inject into existing files */
  inject?: boolean;
  /** Injection marker */
  after?: string;
  /** Skip if file exists */
  skipIfExists?: boolean;
}

export interface ActionStep extends BaseStep {
  tool: "action";
  /** Action file path */
  action: string;
  /** Action parameters */
  parameters?: Record<string, any>;
}

export interface CodemodStep extends BaseStep {
  tool: "codemod";
  /** Codemod file path */
  codemod: string;
  /** Files to transform (glob pattern) */
  files: string;
  /** Transformation options */
  options?: Record<string, any>;
}

export interface RecipeStep extends BaseStep {
  tool: "recipe";
  /** Recipe to execute */
  recipe: string;
  /** Recipe parameters */
  parameters?: Record<string, any>;
}

export interface ShellStep extends BaseStep {
  tool: "shell";
  /** Shell command to execute */
  command: string;
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
}

// ===== Configuration Resolution Types =====

export interface ResolvedConfig {
  /** Kit configuration (if found) */
  kit?: KitConfig;
  /** Cookbook configuration (if found) */
  cookbook?: CookbookConfig;
  /** Recipe configuration */
  recipe: RecipeConfig;
  /** Merged variables from kit → cookbook → recipe */
  variables: Record<string, any>;
  /** Path information */
  paths: ConfigPaths;
}

export interface ConfigPaths {
  /** Kit root directory */
  kitPath?: string;
  /** Cookbook directory */
  cookbookPath?: string;
  /** Recipe directory */
  recipePath: string;
}

// ===== Validation Types =====

export interface ConfigValidationError {
  /** Error type */
  type: "invalid_schema" | "missing_required" | "invalid_reference" | "circular_dependency";
  /** Error message */
  message: string;
  /** Path to the error */
  path: string;
  /** Suggested fix */
  suggestion?: string;
}

// ===== Utility Types =====

export type VariableValue = string | number | boolean | any[] | Record<string, any>;

export interface VariableContext {
  /** Variable name */
  name: string;
  /** Variable configuration */
  config: VariableConfig;
  /** Resolved value */
  value: VariableValue;
  /** Source of the value (kit/cookbook/recipe/cli/prompt) */
  source: string;
}

// ===== Configuration Loader Types =====

export interface ConfigLoaderOptions {
  /** Whether to validate configurations */
  validate?: boolean;
  /** Whether to inherit variables */
  inheritVariables?: boolean;
  /** Whether to resolve references */
  resolveReferences?: boolean;
  /** Custom variable resolvers */
  variableResolvers?: VariableResolver[];
}

export interface VariableResolver {
  /** Variable name pattern to match */
  pattern: RegExp;
  /** Resolver function */
  resolve: (name: string, context: ResolutionContext) => VariableValue;
}

export interface ResolutionContext {
  /** Kit configuration */
  kit?: KitConfig;
  /** Cookbook configuration */
  cookbook?: CookbookConfig;
  /** Recipe configuration */
  recipe: RecipeConfig;
  /** Current working directory */
  cwd: string;
  /** Environment variables */
  env: Record<string, string>;
}