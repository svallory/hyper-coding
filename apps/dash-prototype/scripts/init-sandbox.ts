#!/usr/bin/env bun
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

const sandboxPath = join(import.meta.dir, '../sandbox/epic-test')

console.log('🧹 Cleaning sandbox...')

// Remove and recreate sandbox
try {
  rmSync(sandboxPath, { recursive: true, force: true })
} catch (e) {
  // Ignore if doesn't exist
}

mkdirSync(sandboxPath, { recursive: true })

// Create initial state
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
    required: ['react-expert', 'typescript-expert', 'architecture-reviewer'],
    created: [],
    available: ['react-expert', 'typescript-expert', 'architecture-reviewer'],
  },
  artifacts: {
    original_doc: 'original-spec.md',
    prd: 'prd.md',
    tasks_file: '.taskmaster/tasks/tasks.json',
    complexity_report: 'complexity-report.json',
  },
  tag_name: 'epic-test',
  timestamp: new Date().toISOString(),
}

// Create initial files
writeFileSync(
  join(sandboxPath, 'workflow-state.json'),
  JSON.stringify(initialState, null, 2),
)

writeFileSync(
  join(sandboxPath, 'workflow.log'),
  `[${new Date().toISOString()}] [info] Epic workflow started for epic-test
[${new Date().toISOString()}] [success] Document validation completed
[${new Date().toISOString()}] [info] Epic folder created: sandbox/epic-test
`,
)

console.log('✅ Sandbox initialized')
console.log(`📁 Location: ${sandboxPath}`)
