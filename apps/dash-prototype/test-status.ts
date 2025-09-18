#!/usr/bin/env bun
import { EpicDiscoveryService } from './src/services/epic-discovery.service'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const WORKFLOW_STEPS = [
  'Document Validation',
  'Epic Analysis & Setup',
  'Tag Creation & Switching',
  'PRD Generation',
  'Agent Analysis & Creation',
  'Research Decision',
  'Parse PRD to Tasks',
  'Complexity Analysis',
  'Multi-Agent Review',
  'Final Verification',
]

async function testStatusCommand() {
  const epicName = 'dashboard-tui-ux-improvements'
  console.log(`🔍 Testing status command for epic: ${epicName}\n`)
  
  try {
    const discovery = new EpicDiscoveryService()
    const epic = await discovery.getEpic(epicName)
    
    if (!epic || !epic.isValid) {
      console.error('❌ Epic not found or invalid')
      return
    }

    console.log(`Found epic: ${epic.displayName}`)
    console.log(`Path: ${epic.path}`)
    console.log(`Status: ${epic.status}`)
    console.log(`Valid: ${epic.isValid}`)
    console.log('')

    const statePath = join(epic.path, 'workflow-state.json')
    if (!existsSync(statePath)) {
      console.error('❌ Workflow state not found')
      return
    }

    const state = JSON.parse(readFileSync(statePath, 'utf-8'))
    const progressPercentage = Math.round((state.completed_steps.length / WORKFLOW_STEPS.length) * 100)

    // ASCII output with epic context
    const progressBar = '█'.repeat(Math.floor(progressPercentage / 5))
      + '░'.repeat(20 - Math.floor(progressPercentage / 5))

    console.log(`\n╔═══════════════════════════════════════════════════════════════╗`)
    console.log(`║                     EPIC STATUS REPORT                       ║`)
    console.log(`╠═══════════════════════════════════════════════════════════════╣`)
    console.log(`║ Epic: ${epic.displayName.padEnd(53)} ║`)
    console.log(`║ Status: ${epic.status.padEnd(51)} ║`)
    console.log(
      `║ Progress: [${progressBar}] ${progressPercentage}%${(' '.repeat(
        19 - progressPercentage.toString().length,
      ))} ║`,
    )
    console.log(`║ Step: ${state.current_step} of ${WORKFLOW_STEPS.length}${' '.repeat(47)} ║`)
    console.log(`║ Tag: ${(state.tag_name || 'N/A').padEnd(54)} ║`)
    console.log(`╠═══════════════════════════════════════════════════════════════╣`)
    console.log(`║ Epic Context:                                                 ║`)
    console.log(`║   Path: ${epic.path.substring(0, 50).padEnd(50)} ║`)
    console.log(`║   Files: ${(epic.hasWorkflowState ? '●' : '○')} State ${(epic.hasManifest ? '●' : '○')} Manifest ${(epic.hasLogs ? '●' : '○')} Logs${''.padEnd(25)} ║`)
    if (epic.lastActivity) {
      console.log(`║   Last Activity: ${new Date(epic.lastActivity).toLocaleString().padEnd(40)} ║`)
    }
    console.log(`╠═══════════════════════════════════════════════════════════════╣`)
    console.log(`║ Configuration:                                                ║`)
    console.log(`║   Research: ${(state.workflow_config?.use_research ? '✓ Enabled' : '✗ Disabled').padEnd(44)} ║`)
    console.log(`║   No Stop: ${(state.workflow_config?.no_stop ? '✓ Enabled' : '✗ Disabled').padEnd(45)} ║`)
    console.log(`║   Max Agents: ${(state.workflow_config?.max_subagents || 9).toString().padEnd(42)} ║`)
    console.log(`╠═══════════════════════════════════════════════════════════════╣`)
    console.log(`║ Agents:                                                       ║`)
    console.log(`║   Required: ${(state.agents?.required?.length || 0).toString().padEnd(46)} ║`)
    console.log(`║   Available: ${(state.agents?.available?.length || 0).toString().padEnd(45)} ║`)
    console.log(`║   Created: ${(state.agents?.created?.length || 0).toString().padEnd(47)} ║`)
    console.log(`╠═══════════════════════════════════════════════════════════════╣`)
    console.log(`║ Workflow Steps:                                               ║`)

    WORKFLOW_STEPS.forEach((step, index) => {
      const symbol = state.completed_steps.includes(index + 1)
        ? '✅'
        : state.current_step === index + 1
        ? '⏳'
        : '⭕'
      const truncatedStep = step.length > 45 ? step.substring(0, 42) + '...' : step
      console.log(`║   ${symbol} ${(index + 1).toString().padStart(2)}: ${truncatedStep.padEnd(45)} ║`)
    })

    console.log(`╠═══════════════════════════════════════════════════════════════╣`)
    console.log(`║ Status: ${(progressPercentage === 100 ? '✅ COMPLETED' : '⏳ IN PROGRESS').padEnd(51)} ║`)
    console.log(`║ Last Updated: ${new Date(state.timestamp).toLocaleString().padEnd(42)} ║`)
    console.log(`╚═══════════════════════════════════════════════════════════════╝\n`)

  } catch (error) {
    console.error('❌ Failed to get epic status:', error)
  }
}

testStatusCommand()