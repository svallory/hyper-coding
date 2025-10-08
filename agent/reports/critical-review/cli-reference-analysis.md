# Critical Review: cli-reference.mdx

## Document Overview
- **File**: `/work/hyperdev/apps/docs/cli-reference.mdx`
- **Purpose**: Complete command reference for the HyperGen CLI with syntax, examples, and workflows
- **Target Audience**: Developers who need comprehensive CLI documentation for code generation workflows

## Critical Issues Found

### High Priority Issues

#### 1. **Major Brand Inconsistency Throughout Documentation**
- **Location**: Title, installation commands, and throughout entire document
- **Current Text**: Document uses "HyperGen" throughout but describes installing and using `hypergen` command
- **Problem**: The aspirational documentation should reflect the envisioned tool name "HyperDev" with `hyper` command, but consistently uses the old "HyperGen"/"hypergen" naming
- **Impact**: HIGH - Creates fundamental confusion about what tool users are actually using
- **Suggested Fix**: Replace all instances of "HyperGen"/"hypergen" with "HyperDev"/"hyper" to match the aspirational vision

#### 2. **Command Structure Logic Problems**
- **Location**: Recipe system commands (`hypergen recipe execute`, `hypergen step execute`)
- **Current Text**: Commands like `hypergen recipe execute <recipe> [options...]` and `hypergen step execute <recipe> <step-name>`
- **Problem**: The command hierarchy is inconsistent - some commands use subcommands (`recipe execute`) while others don't (`action`, `list`, `info`)
- **Impact**: HIGH - Creates cognitive confusion about command patterns and makes CLI less intuitive
- **Suggested Fix**: Adopt consistent command pattern, either all flat (`hyper execute-recipe`) or all hierarchical (`hyper recipe execute`)

#### 3. **Parameter Naming Convention Chaos**
- **Location**: Throughout examples in action and recipe sections
- **Current Text**: Mix of `--name=Button`, `--typescript=true`, `--api-version`, `--componentName`
- **Problem**: Inconsistent parameter naming - sometimes kebab-case (`api-version`), sometimes camelCase (`componentName`), inconsistent boolean patterns
- **Impact**: HIGH - Users will struggle to predict parameter names and get frustrated with CLI
- **Suggested Fix**: Establish and consistently apply single parameter naming convention (recommend kebab-case for CLI parameters)

### Medium Priority Issues

#### 4. **Template vs Action vs Recipe Conceptual Confusion**
- **Location**: Action Management section vs Template Management section
- **Current Text**: `hypergen action create-component` vs `hypergen template validate` vs `hypergen recipe execute`
- **Problem**: The distinction between actions, templates, and recipes isn't clear from the command structure - when do you use which?
- **Impact**: MEDIUM - New users will be confused about which command to use for their use case
- **Suggested Fix**: Add clear conceptual explanation of when to use each command type, or restructure commands to be more intuitive

#### 5. **Discovery Command Logic Gap**
- **Location**: `hypergen discover` section
- **Current Text**: Command discovers generators but examples show it affecting `hypergen action` behavior
- **Problem**: The relationship between discovery and action execution isn't clear - does discovery need to be run first?
- **Impact**: MEDIUM - Users may not understand when they need to run discovery
- **Suggested Fix**: Clarify automatic vs manual discovery behavior and when discovery command is actually needed

#### 6. **Recipe Variable Syntax Inconsistency**
- **Location**: Recipe execution examples
- **Current Text**: Shows both `--name=MyApp` and `--<variable>=<value>` formats
- **Problem**: Unclear how recipe variables map to CLI parameters - are they the same as action parameters?
- **Impact**: MEDIUM - Users won't know how to pass complex variables to recipes
- **Suggested Fix**: Standardize variable passing syntax and clearly document complex parameter formats

#### 7. **Step Execution Dependency Logic**
- **Location**: `hypergen step execute` section
- **Current Text**: Shows dependency checking but unclear how partial execution state is tracked
- **Problem**: If steps have dependencies, how does the system know which steps have already been completed?
- **Impact**: MEDIUM - Users attempting step-by-step execution may get frustrated with dependency errors
- **Suggested Fix**: Document how step execution state is tracked and how to view/reset execution state

### Lower Priority Issues

#### 8. **Error Message Examples vs Command Names**
- **Location**: Error handling examples throughout
- **Current Text**: Error messages still reference `hypergen` while vision should use `hyper`
- **Problem**: Stylistic inconsistency with branding
- **Impact**: LOW - Minor confusion about tool identity
- **Suggested Fix**: Update error messages to reflect correct tool name

#### 9. **Configuration File Extension Inconsistency**
- **Location**: Configuration section
- **Current Text**: Shows `hypergen.config.js` but earlier sections reference `hypergen-package.config.js`
- **Problem**: Unclear which configuration files exist and their naming patterns
- **Impact**: LOW - Minor confusion about configuration files
- **Suggested Fix**: Standardize configuration file naming and document the hierarchy clearly

#### 10. **Installation Command Contradiction**
- **Location**: Installation section
- **Current Text**: Shows both `bun install -g hypergen` and `npm install -g hypergen`
- **Problem**: Instructions mention using bun but package name assumes npm registry
- **Impact**: LOW - Users might be confused about installation method
- **Suggested Fix**: Clarify package distribution method and preferred installation command

## Specific Examples

### Issue: Brand Name Inconsistency
- **Location**: Line 2, 9, 14, and throughout
- **Current Text**: "HyperGen CLI Reference", "The HyperGen CLI is the command-line interface", "hypergen command-line tool"
- **Problem**: Document should reflect "HyperDev" branding with `hyper` CLI command for aspirational vision
- **Impact**: Creates fundamental confusion about tool identity
- **Suggested Fix**: Replace with "HyperDev CLI Reference", "The HyperDev CLI", "hyper command-line tool"

### Issue: Command Pattern Inconsistency  
- **Location**: Lines 75, 268, 511
- **Current Text**: `hypergen action <name>` vs `hypergen recipe execute <recipe>` vs `hypergen step execute <recipe> <step-name>`
- **Problem**: Inconsistent command structure - some are flat, some are hierarchical with different patterns
- **Impact**: Users can't develop intuitive understanding of command structure
- **Suggested Fix**: Adopt consistent pattern like `hyper <object> <verb>` or `hyper <verb>-<object>`

### Issue: Parameter Naming Chaos
- **Location**: Lines 102, 130, 432
- **Current Text**: `--name=Button`, `--typescript=true`, `--api-version`, `--componentName`
- **Problem**: Mix of kebab-case, camelCase, and inconsistent boolean patterns
- **Impact**: Users will struggle to predict parameter names
- **Suggested Fix**: Standardize on kebab-case: `--component-name`, `--api-version`, `--use-typescript`

### Issue: Template vs Action Conceptual Gap
- **Location**: Lines 75 vs 670
- **Current Text**: "Execute a code generation action" vs "Validate a template configuration file"
- **Problem**: The relationship between actions and templates isn't explained - are actions built from templates?
- **Impact**: Users won't understand which command to use when
- **Suggested Fix**: Add conceptual explanation of how actions, templates, and recipes relate to each other

## Overall Assessment
- **Vision Quality Score**: 4/10 - While comprehensive, the documentation has serious conceptual and naming consistency issues that would confuse users
- **User Impact**: HIGH - Multiple critical inconsistencies would frustrate users and prevent successful tool adoption
- **Priority for Vision Fixes**: HIGH - Core branding and command structure issues must be resolved before implementation

## Recommendations

### Immediate Actions Required
1. **Rebrand Completely**: Replace all "HyperGen"/"hypergen" with "HyperDev"/"hyper" throughout
2. **Standardize Command Structure**: Decide on consistent command hierarchy (flat vs nested) and apply uniformly
3. **Fix Parameter Naming**: Adopt single parameter naming convention (recommend kebab-case) throughout all examples
4. **Clarify Conceptual Model**: Add clear explanation of relationship between actions, templates, recipes, and steps

### Structural Improvements
1. **Add Conceptual Overview Section**: Before diving into commands, explain the mental model of how different command types work together
2. **Reorganize by User Journey**: Structure commands by typical user workflows rather than alphabetically
3. **Standardize Example Patterns**: Use consistent example naming (ButtonComponent, UserAPI, etc.) throughout
4. **Add Decision Tree**: Help users choose between action, template, recipe, or step commands

### Technical Consistency Fixes
1. **Audit All Parameter Names**: Ensure every parameter follows same naming convention
2. **Standardize Error Messages**: Ensure all error examples use correct tool name and consistent format
3. **Verify Configuration References**: Ensure all config file names and paths are consistent
4. **Check Discovery Logic**: Clarify automatic vs manual discovery behavior

The aspirational CLI design has strong functionality concepts but suffers from significant consistency and branding issues that would severely impact user experience. The command structure needs fundamental revision for logical coherence.