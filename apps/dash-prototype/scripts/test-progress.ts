#!/usr/bin/env bun
import { appendFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const epicFolder = 'sandbox/epic-test'

// Simulate progressive workflow updates
const steps = [
  { step: 1, name: 'Document Validation', duration: 1000 },
  { step: 2, name: 'Epic Analysis & Setup', duration: 2000 },
  { step: 3, name: 'Tag Creation & Switching', duration: 1500 },
  { step: 4, name: 'PRD Generation', duration: 3000 },
  { step: 5, name: 'Agent Analysis & Creation', duration: 2500 },
  { step: 6, name: 'Research Decision', duration: 1000 },
  { step: 7, name: 'Parse PRD to Tasks', duration: 4000 },
  { step: 8, name: 'Complexity Analysis', duration: 2000 },
  { step: 9, name: 'Multi-Agent Review', duration: 5000 },
  { step: 10, name: 'Final Verification', duration: 1000 },
]

async function simulateProgress() {
  console.log('Starting workflow simulation...')

  // Initialize
  const initialState = {
    epic_name: 'epic-test',
    current_step: 1,
    completed_steps: [],
    workflow_config: {
      no_stop: false,
      max_subagents: 9,
      use_research: true,
    },
    agents: {
      required: ['react-expert', 'typescript-expert'],
      created: [],
      available: ['react-expert', 'typescript-expert'],
    },
    timestamp: new Date().toISOString(),
  }

  writeFileSync(join(epicFolder, 'workflow-state.json'), JSON.stringify(initialState, null, 2))
  writeFileSync(join(epicFolder, 'workflow.log'), `[${new Date().toISOString()}] [info] Starting workflow simulation\n`)

  // Simulate each step
  for (const { step, name, duration } of steps) {
    console.log(`Step ${step}: ${name}`)

    // Update state
    const state = {
      ...initialState,
      current_step: step,
      completed_steps: Array.from({ length: step - 1 }, (_, i) => i + 1),
    }

    writeFileSync(join(epicFolder, 'workflow-state.json'), JSON.stringify(state, null, 2))

    // Add log entries
    appendFileSync(
      join(epicFolder, 'workflow.log'),
      `[${new Date().toISOString()}] [info] Starting ${name}\n`,
    )

    await new Promise(resolve => setTimeout(resolve, duration / 2))

    appendFileSync(
      join(epicFolder, 'workflow.log'),
      `[${new Date().toISOString()}] [success] ${name} completed\n`,
    )

    // Complete the step
    state.completed_steps.push(step)
    if (step < steps.length) {
      state.current_step = step + 1
    }
    writeFileSync(join(epicFolder, 'workflow-state.json'), JSON.stringify(state, null, 2))

    await new Promise(resolve => setTimeout(resolve, duration / 2))
  }

  console.log('Simulation complete!')
}

simulateProgress().catch(console.error)
