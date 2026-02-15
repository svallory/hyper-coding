/**
 * Sequence Tool Implementation for Recipe Step System
 * 
 * This tool executes a list of recipe steps sequentially.
 * It is a direct replacement for the generic GroupTool, offering
 * clearer semantics for sequential execution.
 */

import createDebug from 'debug'
import { Tool, type ToolValidationResult } from '#//base.js'
import { 
  type StepContext, 
  type StepResult,
  type StepExecutionOptions,
  type SequenceStep,
  type SequenceExecutionResult
} from '#/recipe-engine/types'
import { StepExecutor } from '#/recipe-engine/step-executor'
import { ErrorHandler, ErrorCode } from '#/errors/hypergen-errors'

const debug = createDebug('hypergen:v8:recipe:tool:sequence')

export class SequenceTool extends Tool<SequenceStep> {
  constructor(name: string = 'sequence-tool', options: Record<string, any> = {}) {
    super('sequence', name, options)
  }

  protected async onValidate(step: SequenceStep, context: StepContext): Promise<ToolValidationResult> {
    const errors: string[] = []
    
    if (!step.steps || !Array.isArray(step.steps) || step.steps.length === 0) {
      errors.push('Sequence steps must be a non-empty array')
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: [],
      suggestions: [],
      estimatedExecutionTime: (step.steps?.length || 0) * 1000,
      resourceRequirements: {
        memory: 0,
        disk: 0,
        network: false,
        processes: 0
      }
    }
  }

  protected async onExecute(
    step: SequenceStep,
    context: StepContext,
    options?: StepExecutionOptions
  ): Promise<StepResult> {
    const startTime = new Date()
    this.debug('Executing sequence step: %s with %d steps', step.name, step.steps.length)

    try {
      const executor = new StepExecutor(undefined, {
        collectMetrics: false,
        enableProgressTracking: false,
      })

      const results = await executor.executeSteps(step.steps, context, options)
      
      const failed = results.filter(r => r.status === 'failed')
      
      if (failed.length > 0 && !step.continueOnError && !options?.continueOnError) {
         throw ErrorHandler.createError(
           ErrorCode.TEMPLATE_EXECUTION_ERROR,
           `Sequence execution failed: ${failed.map(f => f.stepName).join(', ')}`,
           { template: step.name, cause: failed[0].error }
         )
      }

      this.debug('Sequence execution completed')
      
      return this.createResult(step, results, startTime, 'completed')

    } catch (error: any) {
      const endTime = new Date()
      return {
        status: 'failed',
        stepName: step.name,
        toolType: 'sequence',
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        retryCount: 0,
        dependenciesSatisfied: true,
        error: {
          message: error.message,
          code: error.code || 'SEQUENCE_EXECUTION_ERROR',
          cause: error
        }
      }
    }
  }

  private createResult(
    step: SequenceStep, 
    results: StepResult[], 
    startTime: Date, 
    status: 'completed' | 'skipped'
  ): StepResult {
    const endTime = new Date()
    
    const filesCreated: string[] = []
    const filesModified: string[] = []
    const filesDeleted: string[] = []

    results.forEach(r => {
      if (r.filesCreated) filesCreated.push(...r.filesCreated)
      if (r.filesModified) filesModified.push(...r.filesModified)
      if (r.filesDeleted) filesDeleted.push(...r.filesDeleted)
    })

    return {
      status,
      stepName: step.name,
      toolType: 'sequence',
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
      retryCount: 0,
      dependenciesSatisfied: true,
      filesCreated,
      filesModified,
      filesDeleted,
      toolResult: {
        steps: results
      } as SequenceExecutionResult,
      output: {
        totalSteps: results.length,
        completed: results.filter(r => r.status === 'completed').length,
        failed: results.filter(r => r.status === 'failed').length
      }
    }
  }
}

export class SequenceToolFactory {
  create(name: string = 'sequence-tool', options: Record<string, any> = {}): SequenceTool {
    return new SequenceTool(name, options)
  }

  getToolType(): 'sequence' {
    return 'sequence'
  }
  
  validateConfig(config: Record<string, any>): ToolValidationResult {
    return {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: []
    }
  }
}

export const sequenceToolFactory = new SequenceToolFactory()
