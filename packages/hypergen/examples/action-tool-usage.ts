/**
 * ActionTool Usage Examples
 * 
 * This file demonstrates how to use the ActionTool within the Recipe Step System
 * to execute TypeScript decorator-based actions with full lifecycle management.
 */

import { ActionTool, ActionToolFactory } from '../src/recipe-engine/tools/action-tool.js'
import { ActionRegistry } from '../src/actions/registry.js'
import type { 
  ActionStep, 
  StepContext 
} from '../src/recipe-engine/types.js'
import type { 
  ActionMetadata, 
  ActionContext, 
  ActionResult 
} from '../src/actions/types.js'

// Example 1: Basic Action Tool Usage

async function basicActionToolExample() {
  console.log('=== Basic Action Tool Usage ===')
  
  // Create and register a sample action
  const sampleAction = async (context: ActionContext): Promise<ActionResult> => {
    console.log(`Executing sample action with variables:`, context.variables)
    
    // Simulate some work
    const fileName = `${context.variables.name || 'default'}.txt`
    const content = `Hello, ${context.variables.greeting || 'World'}!`
    
    if (!context.dryRun) {
      // In a real action, you would write the file here
      console.log(`Would create file: ${fileName} with content: ${content}`)
    }
    
    return {
      success: true,
      message: `Sample action completed successfully`,
      filesCreated: [fileName],
      filesModified: [],
      filesDeleted: [],
      data: { 
        fileName, 
        content, 
        timestamp: new Date().toISOString() 
      }
    }
  }
  
  const actionMetadata: ActionMetadata = {
    name: 'sample-action',
    description: 'A sample action for demonstration',
    category: 'examples',
    parameters: [
      {
        name: 'name',
        type: 'string',
        required: true,
        description: 'Name for the generated file'
      },
      {
        name: 'greeting',
        type: 'string',
        required: false,
        default: 'World',
        description: 'Greeting message'
      }
    ],
    tags: ['sample', 'demo']
  }
  
  // Register the action
  const registry = ActionRegistry.getInstance()
  registry.register(sampleAction, actionMetadata)
  
  // Create ActionTool
  const actionTool = new ActionTool('basic-example-tool')
  await actionTool.initialize()
  
  // Define action step
  const actionStep: ActionStep = {
    name: 'create-greeting-file',
    tool: 'action',
    action: 'sample-action',
    description: 'Create a greeting file using the sample action',
    parameters: {
      name: 'example',
      greeting: 'Hello from ActionTool'
    }
  }
  
  // Create step context
  const stepContext: StepContext = {
    step: actionStep,
    variables: {
      projectName: 'action-tool-demo',
      version: '1.0.0'
    },
    projectRoot: process.cwd(),
    recipeVariables: {
      environment: 'development'
    },
    stepResults: new Map(),
    recipe: {
      id: 'demo-recipe',
      name: 'Action Tool Demo Recipe',
      startTime: new Date()
    },
    stepData: {},
    evaluateCondition: (expr, ctx) => true,
    dryRun: false,
    force: false
  }
  
  // Validate the step
  console.log('Validating action step...')
  const validation = await actionTool.validate(actionStep, stepContext)
  console.log('Validation result:', {
    isValid: validation.isValid,
    errors: validation.errors,
    warnings: validation.warnings,
    estimatedTime: validation.estimatedExecutionTime
  })
  
  if (validation.isValid) {
    // Execute the step
    console.log('Executing action step...')
    const result = await actionTool.execute(actionStep, stepContext)
    console.log('Execution result:', {
      status: result.status,
      stepName: result.stepName,
      toolType: result.toolType,
      duration: result.duration,
      filesCreated: result.filesCreated,
      output: result.output
    })
  }
  
  await actionTool.cleanup()
  console.log('Basic example completed!\n')
}

// Example 2: Action Tool with Communication

async function communicationExample() {
  console.log('=== Action Tool with Communication ===')
  
  // Create a communication-enabled action
  const communicationAction = async (context: ActionContext): Promise<ActionResult> => {
    console.log(`Executing communication action with ID: ${context.communication?.actionId}`)
    
    // Use communication features
    if (context.communication) {
      // Set shared data
      context.communication.setSharedData('action-timestamp', new Date().toISOString())
      context.communication.setSharedData('action-variables', context.variables)
      
      // Send a message
      context.communication.sendMessage('action-started', {
        actionName: 'communication-action',
        parameters: context.variables
      })
    }
    
    // Simulate work
    await new Promise(resolve => setTimeout(resolve, 100))
    
    return {
      success: true,
      message: 'Communication action completed',
      filesCreated: [],
      filesModified: [],
      filesDeleted: [],
      data: {
        communicationEnabled: !!context.communication,
        sharedDataKeys: context.communication ? 
          ['action-timestamp', 'action-variables'] : []
      }
    }
  }
  
  const commMetadata: ActionMetadata = {
    name: 'communication-action',
    description: 'Action with communication capabilities',
    category: 'communication',
    parameters: [
      {
        name: 'message',
        type: 'string',
        required: true,
        description: 'Message to process'
      }
    ]
  }
  
  // Register the action
  const registry = ActionRegistry.getInstance()
  registry.register(communicationAction, commMetadata)
  
  // Create ActionTool with communication config
  const actionTool = new ActionTool('communication-tool', {
    communicationConfig: {
      maxMessages: 100,
      ttl: 60000 // 1 minute
    }
  })
  await actionTool.initialize()
  
  // Define action step with communication
  const commStep: ActionStep = {
    name: 'communicate-step',
    tool: 'action',
    action: 'communication-action',
    parameters: {
      message: 'Hello from communication action'
    },
    actionConfig: {
      communication: {
        actionId: 'custom-action-id',
        subscribeTo: ['step-complete'],
        reads: ['global-config'],
        writes: ['action-output']
      }
    }
  }
  
  const commContext: StepContext = {
    step: commStep,
    variables: {
      globalConfig: 'production-ready'
    },
    projectRoot: process.cwd(),
    recipeVariables: {},
    stepResults: new Map(),
    recipe: {
      id: 'comm-recipe',
      name: 'Communication Demo Recipe',
      startTime: new Date()
    },
    stepData: {},
    evaluateCondition: (expr, ctx) => true,
    dryRun: false,
    force: false
  }
  
  // Execute the communication step
  const result = await actionTool.execute(commStep, commContext)
  console.log('Communication step result:', {
    status: result.status,
    communicationConfig: result.output?.communication,
    actionData: result.toolResult?.data
  })
  
  // Show execution statistics
  const stats = actionTool.getExecutionStats()
  console.log('Execution statistics:', stats)
  
  await actionTool.cleanup()
  console.log('Communication example completed!\n')
}

// Example 3: Action Tool Factory Usage

async function factoryExample() {
  console.log('=== Action Tool Factory Usage ===')
  
  const factory = new ActionToolFactory()
  
  // Validate factory configuration
  const configValidation = factory.validateConfig({
    communicationConfig: {
      maxMessages: 500,
      ttl: 120000
    },
    defaultTimeout: 30000
  })
  
  console.log('Factory config validation:', configValidation)
  
  if (configValidation.isValid) {
    // Create tool through factory
    const tool = factory.create('factory-tool', {
      communicationConfig: {
        maxMessages: 500,
        ttl: 120000
      }
    })
    
    console.log('Tool created through factory:', {
      name: tool.getName(),
      type: tool.getToolType(),
      initialized: tool.isInitialized()
    })
    
    // Get available actions
    await tool.initialize()
    const availableActions = tool.getAvailableActions()
    console.log('Available actions:', availableActions.map(a => ({
      name: a.name,
      category: a.category,
      parameterCount: a.parameterCount
    })))
    
    await tool.cleanup()
  }
  
  console.log('Factory example completed!\n')
}

// Example 4: Error Handling

async function errorHandlingExample() {
  console.log('=== Action Tool Error Handling ===')
  
  // Create a failing action
  const failingAction = async (context: ActionContext): Promise<ActionResult> => {
    if (context.variables.shouldFail) {
      return {
        success: false,
        message: 'Action failed intentionally for demonstration',
        filesCreated: [],
        filesModified: [],
        filesDeleted: []
      }
    }
    
    return {
      success: true,
      message: 'Action succeeded',
      filesCreated: [],
      filesModified: [],
      filesDeleted: []
    }
  }
  
  const failingMetadata: ActionMetadata = {
    name: 'failing-action',
    description: 'Action that can fail for demonstration',
    parameters: [
      {
        name: 'shouldFail',
        type: 'boolean',
        required: false,
        default: false
      }
    ]
  }
  
  const registry = ActionRegistry.getInstance()
  registry.register(failingAction, failingMetadata)
  
  const actionTool = new ActionTool('error-handling-tool')
  await actionTool.initialize()
  
  // Test successful execution
  const successStep: ActionStep = {
    name: 'success-step',
    tool: 'action',
    action: 'failing-action',
    parameters: { shouldFail: false }
  }
  
  const context: StepContext = {
    step: successStep,
    variables: {},
    projectRoot: process.cwd(),
    recipeVariables: {},
    stepResults: new Map(),
    recipe: { id: 'error-test', name: 'Error Test', startTime: new Date() },
    stepData: {},
    evaluateCondition: (expr, ctx) => true,
    dryRun: false,
    force: false
  }
  
  console.log('Testing successful execution...')
  const successResult = await actionTool.execute(successStep, context)
  console.log('Success result:', {
    status: successResult.status,
    message: successResult.toolResult?.message
  })
  
  // Test failed execution
  const failStep: ActionStep = {
    name: 'fail-step',
    tool: 'action',
    action: 'failing-action',
    parameters: { shouldFail: true }
  }
  
  console.log('Testing failed execution...')
  const failContext = { ...context, step: failStep }
  const failResult = await actionTool.execute(failStep, failContext)
  console.log('Fail result:', {
    status: failResult.status,
    error: failResult.error
  })
  
  await actionTool.cleanup()
  console.log('Error handling example completed!\n')
}

// Main execution
async function runExamples() {
  console.log('ActionTool Usage Examples')
  console.log('==========================\n')
  
  try {
    await basicActionToolExample()
    await communicationExample()
    await factoryExample()
    await errorHandlingExample()
    
    console.log('All examples completed successfully!')
  } catch (error) {
    console.error('Example execution failed:', error)
  } finally {
    // Clean up registry
    ActionRegistry.getInstance().clear()
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExamples()
}

export {
  basicActionToolExample,
  communicationExample,
  factoryExample,
  errorHandlingExample,
  runExamples
}