/**
 * CodeMod Tool Integration Example
 * 
 * This example demonstrates how to integrate and use the CodeModTool
 * within the Recipe Step System alongside other tools.
 */

import { CodeModTool, CodeModToolFactory } from '../src/recipe-engine/tools/codemod-tool.js'
import { TemplateTool } from '../src/recipe-engine/tools/template-tool.js'
import { ActionTool } from '../src/recipe-engine/tools/action-tool.js'
import type { CodeModStep, TemplateStep, ActionStep, StepContext } from '../src/recipe-engine/types.js'

/**
 * Example: Complete Code Generation and Transformation Workflow
 */
async function demonstrateIntegratedWorkflow() {
  console.log('🚀 Starting integrated code generation and transformation workflow...')
  
  // Initialize tools
  const templateTool = new TemplateTool()
  const codemodTool = new CodeModTool()
  const actionTool = new ActionTool()
  
  // Initialize all tools
  await Promise.all([
    templateTool.initialize(),
    codemodTool.initialize(),
    actionTool.initialize()
  ])
  
  // Mock context for demonstration
  const context: StepContext = {
    step: {} as any, // Will be set for each step
    variables: {
      componentName: 'UserProfile',
      apiVersion: 'v2',
      features: ['authentication', 'validation']
    },
    projectRoot: '/project',
    recipeVariables: {},
    stepResults: new Map(),
    recipe: {
      id: 'demo-recipe',
      name: 'Demo Recipe',
      startTime: new Date()
    },
    stepData: {},
    evaluateCondition: (expr: string) => true,
    dryRun: false,
    force: false
  }
  
  try {
    // Step 1: Generate base component files using Template Tool
    console.log('\n📄 Step 1: Generating base component files...')
    const templateStep: TemplateStep = {
      name: 'generate-component',
      tool: 'template',
      template: 'react-component',
      outputDir: 'src/components',
      variables: {
        componentName: context.variables.componentName,
        includeTests: true
      }
    }
    
    context.step = templateStep
    const templateResult = await templateTool.execute(templateStep, context)
    console.log(`✅ Generated ${templateResult.filesCreated?.length || 0} files`)
    
    // Step 2: Add React imports using CodeMod Tool
    console.log('\n🔧 Step 2: Adding React imports to generated files...')
    const addImportStep: CodeModStep = {
      name: 'add-react-imports',
      tool: 'codemod',
      codemod: 'add-import',
      files: ['src/components/**/*.tsx'],
      backup: true,
      parameters: {
        import: 'React',
        from: 'react',
        importType: 'default'
      },
      codemodConfig: {
        transform: {
          preserveFormatting: true,
          includeComments: true
        },
        validation: {
          validateSyntax: true
        }
      }
    }
    
    context.step = addImportStep
    const importResult = await codemodTool.execute(addImportStep, context)
    console.log(`✅ Modified ${importResult.filesModified?.length || 0} files with React imports`)
    
    // Step 3: Add utility hooks imports
    console.log('\n🔧 Step 3: Adding utility hooks imports...')
    const addHooksStep: CodeModStep = {
      name: 'add-hooks-imports',
      tool: 'codemod',
      codemod: 'add-import',
      files: ['src/components/**/*.tsx'],
      parameters: {
        import: '{ useState, useEffect }',
        from: 'react',
        importType: 'named'
      }
    }
    
    context.step = addHooksStep
    const hooksResult = await codemodTool.execute(addHooksStep, context)
    console.log(`✅ Added React hooks imports to ${hooksResult.filesModified?.length || 0} files`)
    
    // Step 4: Update API endpoints using text replacement
    console.log('\n🔧 Step 4: Updating API endpoints...')
    const updateApiStep: CodeModStep = {
      name: 'update-api-endpoints',
      tool: 'codemod',
      codemod: 'replace-text',
      files: ['src/components/**/*.tsx', 'src/api/**/*.ts'],
      backup: true,
      parameters: {
        find: '/api/v1/',
        replace: `/api/${context.variables.apiVersion}/`,
        global: true
      }
    }
    
    context.step = updateApiStep
    const apiResult = await codemodTool.execute(updateApiStep, context, { dryRun: true })
    console.log(`✅ Would update API endpoints in ${apiResult.filesModified?.length || 0} files (dry run)`)
    
    // Step 5: Add component exports
    console.log('\n🔧 Step 5: Adding component exports...')
    const addExportStep: CodeModStep = {
      name: 'add-component-exports',
      tool: 'codemod',
      codemod: 'add-export',
      files: ['src/components/index.ts'],
      parameters: {
        export: context.variables.componentName,
        exportType: 'named'
      }
    }
    
    context.step = addExportStep
    const exportResult = await codemodTool.execute(addExportStep, context)
    console.log(`✅ Added exports to ${exportResult.filesModified?.length || 0} files`)
    
    // Step 6: Custom transformation for configuration
    console.log('\n🔧 Step 6: Adding configuration properties...')
    const configStep: CodeModStep = {
      name: 'add-config-properties',
      tool: 'codemod',
      codemod: 'add-property',
      files: ['src/config/**/*.ts'],
      parameters: {
        objectName: 'appConfig',
        propertyName: 'componentFeatures',
        propertyValue: JSON.stringify(context.variables.features),
        propertyType: 'string[]'
      }
    }
    
    context.step = configStep
    const configResult = await codemodTool.execute(configStep, context)
    console.log(`✅ Updated configuration in ${configResult.filesModified?.length || 0} files`)
    
    // Summary
    console.log('\n📊 Workflow Summary:')
    console.log(`- Template files generated: ${templateResult.filesCreated?.length || 0}`)
    console.log(`- Files modified by CodeMod transformations: ${
      (importResult.filesModified?.length || 0) +
      (hooksResult.filesModified?.length || 0) +
      (exportResult.filesModified?.length || 0) +
      (configResult.filesModified?.length || 0)
    }`)
    console.log(`- API endpoint updates (dry run): ${apiResult.filesModified?.length || 0}`)
    
  } catch (error) {
    console.error('❌ Workflow failed:', error)
  } finally {
    // Clean up resources
    await Promise.all([
      templateTool.cleanup(),
      codemodTool.cleanup(),
      actionTool.cleanup()
    ])
    
    console.log('\n🧹 Resources cleaned up')
  }
}

/**
 * Example: Tool Factory Usage
 */
function demonstrateToolFactory() {
  console.log('\n🏭 Demonstrating Tool Factory usage...')
  
  const factory = new CodeModToolFactory()
  
  // Create tool instance
  const tool = factory.create('custom-codemod-tool', {
    enableCaching: true,
    cleanupBackups: false
  })
  
  console.log(`✅ Created tool: ${tool.getName()} (${tool.getToolType()})`)
  
  // Validate configuration
  const configValidation = factory.validateConfig({
    enableCaching: true,
    cleanupBackups: 'invalid-value', // This will generate a warning
    customOption: 'test'
  })
  
  console.log('Configuration validation:')
  console.log(`- Valid: ${configValidation.isValid}`)
  console.log(`- Errors: ${configValidation.errors.length}`)
  console.log(`- Warnings: ${configValidation.warnings.length}`)
  console.log(`- Suggestions: ${configValidation.suggestions.length}`)
  
  if (configValidation.warnings.length > 0) {
    console.log('Warnings:', configValidation.warnings)
  }
  
  if (configValidation.suggestions.length > 0) {
    console.log('Suggestions:', configValidation.suggestions)
  }
}

/**
 * Example: Error Handling and Recovery
 */
async function demonstrateErrorHandling() {
  console.log('\n🚨 Demonstrating error handling...')
  
  const tool = new CodeModTool()
  await tool.initialize()
  
  const context: StepContext = {
    step: {} as any,
    variables: {},
    projectRoot: '/nonexistent',
    recipeVariables: {},
    stepResults: new Map(),
    recipe: { id: 'error-demo', name: 'Error Demo', startTime: new Date() },
    stepData: {},
    evaluateCondition: () => true,
    dryRun: false,
    force: false
  }
  
  // Test invalid CodeMod type
  const invalidStep: CodeModStep = {
    name: 'invalid-test',
    tool: 'codemod',
    codemod: 'invalid-transformation-type' as any,
    files: ['**/*.ts']
  }
  
  try {
    context.step = invalidStep
    const validation = await tool.validate(invalidStep, context)
    console.log(`❌ Validation failed as expected: ${validation.errors.join(', ')}`)
  } catch (error) {
    console.log(`❌ Validation error caught: ${error}`)
  }
  
  // Test missing parameters
  const incompleteStep: CodeModStep = {
    name: 'incomplete-test',
    tool: 'codemod',
    codemod: 'add-import',
    files: ['**/*.ts'],
    parameters: {
      import: 'React'
      // Missing 'from' parameter
    }
  }
  
  try {
    context.step = incompleteStep
    const validation = await tool.validate(incompleteStep, context)
    console.log(`❌ Parameter validation failed as expected: ${validation.errors.join(', ')}`)
  } catch (error) {
    console.log(`❌ Parameter validation error: ${error}`)
  }
  
  await tool.cleanup()
}

/**
 * Run all demonstrations
 */
async function main() {
  console.log('🎯 CodeMod Tool Integration Examples')
  console.log('=====================================')
  
  // Note: These are demonstration functions that show the API usage
  // In a real environment, you would have actual files and proper setup
  
  console.log('\n1. Tool Factory Demonstration:')
  demonstrateToolFactory()
  
  console.log('\n2. Error Handling Demonstration:')
  await demonstrateErrorHandling()
  
  console.log('\n3. Integrated Workflow (Mock):')
  console.log('Note: This would work with real files and proper project setup')
  // await demonstrateIntegratedWorkflow() // Commented out for example
  
  console.log('\n✅ Examples completed!')
}

// Export for use in other modules
export {
  demonstrateIntegratedWorkflow,
  demonstrateToolFactory,
  demonstrateErrorHandling
}

// Run if called directly
if (import.meta.main) {
  main().catch(console.error)
}