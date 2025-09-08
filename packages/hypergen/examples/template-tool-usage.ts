/**
 * TemplateTool Usage Example
 * 
 * This example demonstrates how to use the TemplateTool in the Recipe Step System
 * to process templates and generate files.
 */

import { TemplateTool, templateToolFactory } from '../src/recipe-engine/tools/template-tool.js'
import type { TemplateStep, StepContext } from '../src/recipe-engine/types.js'

// Example: Basic Template Processing
async function basicTemplateExample() {
  console.log('=== Basic Template Tool Usage ===\n')

  // Create tool instance
  const templateTool = templateToolFactory.create('example-template-tool')

  // Define template step configuration
  const templateStep: TemplateStep = {
    tool: 'template',
    name: 'generate-component',
    description: 'Generate React component from template',
    template: 'component.liquid',
    engine: 'liquid',
    variables: {
      componentName: 'UserProfile',
      typescript: true,
      withTests: true
    },
    overwrite: false,
    exclude: ['*.test.ts']
  }

  // Define step context
  const stepContext: StepContext = {
    step: templateStep,
    variables: {
      componentName: 'UserProfile',
      typescript: true,
      withTests: true,
      projectName: 'my-app'
    },
    projectRoot: '/path/to/project',
    recipeVariables: {
      author: 'John Doe',
      license: 'MIT'
    },
    stepResults: new Map(),
    recipe: {
      id: 'react-component-recipe',
      name: 'React Component Generator',
      startTime: new Date()
    },
    stepData: {},
    evaluateCondition: (expression: string, context: Record<string, any>) => {
      // Simple condition evaluation
      try {
        return new Function('context', `with(context) { return ${expression} }`)(context)
      } catch {
        return false
      }
    },
    dryRun: true // Enable dry run for example
  }

  try {
    // Initialize the tool
    await templateTool.initialize()
    console.log('✓ Template tool initialized')

    // Validate the step configuration
    console.log('🔍 Validating template step...')
    const validationResult = await templateTool.validate(templateStep, stepContext)
    
    if (validationResult.isValid) {
      console.log('✓ Template step validation passed')
      console.log(`  - Estimated execution time: ${validationResult.estimatedExecutionTime}ms`)
      console.log(`  - Memory requirements: ${Math.round((validationResult.resourceRequirements?.memory || 0) / 1024 / 1024)}MB`)
    } else {
      console.log('❌ Template step validation failed:')
      validationResult.errors.forEach(error => console.log(`  - ${error}`))
    }

    // Execute the template step
    if (validationResult.isValid) {
      console.log('\n🚀 Executing template step...')
      const result = await templateTool.execute(templateStep, stepContext)
      
      console.log(`✓ Template execution ${result.status}`)
      console.log(`  - Duration: ${result.duration}ms`)
      console.log(`  - Tool type: ${result.toolType}`)
      console.log(`  - Template engine: ${result.toolResult?.engine}`)
      console.log(`  - Files processed: ${result.output?.totalFiles}`)
      console.log(`  - Files generated: ${result.output?.generatedFiles}`)
      console.log(`  - Files skipped: ${result.output?.skippedFiles}`)
    }

    // Clean up resources
    await templateTool.cleanup()
    console.log('✓ Template tool cleanup completed')

  } catch (error) {
    console.error('❌ Template tool execution failed:', error)
  }
}

// Example: Advanced Template Processing with Composition
async function advancedTemplateExample() {
  console.log('\n=== Advanced Template Tool Usage ===\n')

  const templateTool = new TemplateTool('advanced-template-tool', {
    templateEngineConfig: {
      default: 'liquidjs',
      engines: {
        liquidjs: {
          strictVariables: false,
          cache: true
        }
      }
    }
  })

  // Advanced template step with composition
  const templateStep: TemplateStep = {
    tool: 'template',
    name: 'generate-full-stack-component',
    description: 'Generate full-stack component with API and tests',
    template: 'full-stack-component.liquid',
    engine: 'liquid',
    variables: {
      componentName: 'ProductList',
      apiEndpoint: '/api/products',
      withGraphQL: true,
      withRedux: true
    },
    templateConfig: {
      variables: {
        componentName: {
          type: 'string',
          required: true,
          description: 'Name of the component to generate'
        },
        apiEndpoint: {
          type: 'string',
          required: true,
          description: 'API endpoint for data fetching'
        },
        withGraphQL: {
          type: 'boolean',
          default: false,
          description: 'Include GraphQL integration'
        }
      },
      composition: {
        includes: [
          {
            template: 'component-base.liquid',
            variables: { includeTypes: true },
            condition: 'typescript'
          },
          {
            template: 'api-integration.liquid',
            variables: { endpoint: '{{ apiEndpoint }}' },
            condition: 'apiEndpoint'
          },
          {
            template: 'graphql-queries.liquid',
            condition: 'withGraphQL'
          },
          {
            template: 'redux-slice.liquid',
            condition: 'withRedux'
          },
          {
            template: 'component-tests.liquid',
            variables: { testFramework: 'jest' }
          }
        ]
      }
    },
    outputDir: 'src/components',
    overwrite: false,
    exclude: ['*.backup.*']
  }

  const stepContext: StepContext = {
    step: templateStep,
    variables: {
      componentName: 'ProductList',
      apiEndpoint: '/api/products',
      withGraphQL: true,
      withRedux: true,
      typescript: true,
      projectType: 'react'
    },
    projectRoot: '/path/to/project',
    recipeVariables: {
      framework: 'react',
      stateManagement: 'redux',
      apiType: 'graphql'
    },
    stepResults: new Map(),
    recipe: {
      id: 'full-stack-component-recipe',
      name: 'Full Stack Component Generator',
      startTime: new Date()
    },
    stepData: {},
    evaluateCondition: (expression: string, context: Record<string, any>) => {
      // Enhanced condition evaluation with variable support
      const evaluationContext = { ...context, ...stepContext.variables }
      try {
        return new Function('context', `with(context) { return ${expression} }`)(evaluationContext)
      } catch (error) {
        console.warn(`Condition evaluation failed for "${expression}":`, error.message)
        return false
      }
    },
    dryRun: true
  }

  try {
    await templateTool.initialize()
    console.log('✓ Advanced template tool initialized')

    const validationResult = await templateTool.validate(templateStep, stepContext)
    console.log(`🔍 Validation result: ${validationResult.isValid ? 'PASSED' : 'FAILED'}`)
    
    if (!validationResult.isValid) {
      console.log('Validation errors:')
      validationResult.errors.forEach(error => console.log(`  ❌ ${error}`))
    }
    
    if (validationResult.warnings.length > 0) {
      console.log('Validation warnings:')
      validationResult.warnings.forEach(warning => console.log(`  ⚠️  ${warning}`))
    }

    if (validationResult.suggestions.length > 0) {
      console.log('Suggestions:')
      validationResult.suggestions.forEach(suggestion => console.log(`  💡 ${suggestion}`))
    }

    if (validationResult.isValid) {
      const result = await templateTool.execute(templateStep, stepContext)
      
      console.log('\n🎉 Advanced template execution results:')
      console.log(`  Status: ${result.status}`)
      console.log(`  Duration: ${result.duration}ms`)
      console.log(`  Template: ${result.toolResult?.templateName}`)
      console.log(`  Engine: ${result.toolResult?.engine}`)
      
      if (result.output) {
        console.log('  Execution Summary:')
        console.log(`    Total files: ${result.output.totalFiles}`)
        console.log(`    Generated: ${result.output.generatedFiles}`)
        console.log(`    Skipped: ${result.output.skippedFiles}`)
        
        if (result.output.skippedReasons && result.output.skippedReasons.length > 0) {
          console.log('  Skip reasons:')
          result.output.skippedReasons.forEach((skip: any) => {
            console.log(`    - ${skip.path}: ${skip.reason}`)
          })
        }
      }
      
      if (result.metadata?.performance) {
        console.log('  Performance:')
        console.log(`    Template compile time: ${result.metadata.performance.templateCompileTime}ms`)
      }
    }

    await templateTool.cleanup()
    console.log('✓ Advanced template tool cleanup completed')

  } catch (error) {
    console.error('❌ Advanced template execution failed:', error)
  }
}

// Example: Factory Usage and Configuration Validation
async function factoryExample() {
  console.log('\n=== Template Tool Factory Usage ===\n')

  // Test factory configuration validation
  const validConfig = {
    templateEngineConfig: {
      default: 'liquidjs',
      engines: {
        liquidjs: { cache: true, strictVariables: false },
        ejs: { cache: false, delimiter: '%' }
      }
    },
    cacheEnabled: true
  }

  const invalidConfig = {
    templateEngineConfig: 'not-an-object', // Invalid
    cacheEnabled: 'yes' // Should be boolean
  }

  console.log('🔧 Testing factory configuration validation...')
  
  const validResult = templateToolFactory.validateConfig(validConfig)
  console.log(`✓ Valid config result: ${validResult.isValid}`)
  console.log(`  Errors: ${validResult.errors.length}`)
  console.log(`  Warnings: ${validResult.warnings.length}`)

  const invalidResult = templateToolFactory.validateConfig(invalidConfig)
  console.log(`❌ Invalid config result: ${invalidResult.isValid}`)
  console.log('  Errors:')
  invalidResult.errors.forEach(error => console.log(`    - ${error}`))
  console.log('  Warnings:')
  invalidResult.warnings.forEach(warning => console.log(`    - ${warning}`))

  // Create tools with different configurations
  const tool1 = templateToolFactory.create('tool-1')
  const tool2 = templateToolFactory.create('tool-2', validConfig)

  console.log(`\n✓ Created tools: ${tool1.getName()} and ${tool2.getName()}`)
  console.log(`  Tool type: ${templateToolFactory.getToolType()}`)
}

// Main execution
async function main() {
  try {
    await basicTemplateExample()
    await advancedTemplateExample()
    await factoryExample()
    
    console.log('\n🎉 All examples completed successfully!')
  } catch (error) {
    console.error('💥 Example execution failed:', error)
    process.exit(1)
  }
}

// Run examples
if (import.meta.main) {
  main()
}

export {
  basicTemplateExample,
  advancedTemplateExample,
  factoryExample
}