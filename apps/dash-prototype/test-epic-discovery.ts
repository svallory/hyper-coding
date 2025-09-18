#!/usr/bin/env bun
import { EpicDiscoveryService } from './src/services/epic-discovery.service'

async function testEpicDiscovery() {
  console.log('🔍 Testing Epic Discovery Service...\n')
  
  const discovery = new EpicDiscoveryService([
    './agent/epics',
    '../agent/epics',
    '../../agent/epics',
    './sandbox/agent/epics'
  ])

  try {
    const epics = await discovery.discoverEpics(true)
    
    console.log(`Found ${epics.length} epic(s):\n`)
    
    for (const epic of epics) {
      console.log(`📂 ${epic.displayName}`)
      console.log(`   Path: ${epic.path}`)
      console.log(`   Status: ${epic.status}`)
      console.log(`   Valid: ${epic.isValid ? '✅' : '❌'}`)
      
      if (epic.description) {
        console.log(`   Description: ${epic.description.substring(0, 80)}${epic.description.length > 80 ? '...' : ''}`)
      }
      
      console.log(`   Files: ${epic.hasWorkflowState ? '●' : '○'} State | ${epic.hasManifest ? '●' : '○'} Manifest | ${epic.hasLogs ? '●' : '○'} Logs`)
      
      if (epic.progress) {
        console.log(`   Progress: ${epic.progress.percentage}% (${epic.progress.completedSteps.length}/${epic.progress.totalSteps})`)
      }
      
      if (epic.lastActivity) {
        console.log(`   Last Activity: ${epic.lastActivity}`)
      }
      
      if (epic.errors.length > 0) {
        console.log(`   Errors: ${epic.errors.join(', ')}`)
      }
      
      console.log('')
    }
    
    console.log('Discovery stats:', discovery.getStats())
    
  } catch (error) {
    console.error('❌ Epic discovery failed:', error)
  }
}

testEpicDiscovery()