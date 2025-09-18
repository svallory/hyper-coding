#!/usr/bin/env bun
import { EpicContextManager } from './src/services/epic-context.service'

async function testEpicContextManager() {
  console.log('🔄 Testing Epic Context Manager...\n')
  
  const manager = new EpicContextManager([
    './agent/epics',
    '../agent/epics',
    '../../agent/epics',
    './sandbox/agent/epics'
  ])

  try {
    // Discover available epics
    console.log('1. Discovering available epics...')
    const epics = await manager.getAvailableEpics(true)
    console.log(`   Found ${epics.length} epics\n`)

    if (epics.length === 0) {
      console.log('❌ No epics found. Cannot test context switching.')
      return
    }

    // Test switching to first epic
    console.log('2. Switching to first epic...')
    const firstEpic = epics[0]
    console.log(`   Switching to: ${firstEpic.displayName}`)
    const context1 = await manager.switchToEpic(firstEpic.path)
    
    if (context1) {
      console.log('   ✅ Successfully switched to first epic')
      console.log(`   Epic: ${context1.epic.displayName}`)
      console.log(`   Valid: ${context1.epic.isValid}`)
      console.log(`   Active: ${context1.isActive}`)
      console.log(`   TaskMaster Service: ${context1.taskMasterService ? 'Created' : 'Not created'}`)
    } else {
      console.log('   ❌ Failed to switch to first epic')
    }
    console.log('')

    // Test switching to second epic (if available)
    if (epics.length > 1) {
      console.log('3. Switching to second epic...')
      const secondEpic = epics[1]
      console.log(`   Switching to: ${secondEpic.displayName}`)
      const context2 = await manager.switchToEpic(secondEpic.path)
      
      if (context2) {
        console.log('   ✅ Successfully switched to second epic')
        console.log(`   Epic: ${context2.epic.displayName}`)
        console.log(`   Valid: ${context2.epic.isValid}`)
        console.log(`   Active: ${context2.isActive}`)
        console.log(`   TaskMaster Service: ${context2.taskMasterService ? 'Created' : 'Not created'}`)
        
        // Check that first context is now inactive
        const cachedContext1 = manager.getCachedContexts().find(c => c.epic.path === firstEpic.path)
        if (cachedContext1) {
          console.log(`   First epic (${cachedContext1.epic.displayName}) active: ${cachedContext1.isActive}`)
        }
      } else {
        console.log('   ❌ Failed to switch to second epic')
      }
      console.log('')
    }

    // Test getting current context
    console.log('4. Testing current context retrieval...')
    const currentContext = manager.getCurrentContext()
    if (currentContext) {
      console.log(`   ✅ Current context: ${currentContext.epic.displayName}`)
      console.log(`   Path: ${currentContext.epic.path}`)
      console.log(`   Active: ${currentContext.isActive}`)
    } else {
      console.log('   ❌ No current context found')
    }
    console.log('')

    // Test context caching
    console.log('5. Testing context caching...')
    const cachedContexts = manager.getCachedContexts()
    console.log(`   Cached contexts: ${cachedContexts.length}`)
    for (const context of cachedContexts) {
      console.log(`   - ${context.epic.displayName} (active: ${context.isActive})`)
    }
    console.log('')

    // Test switching by epic name
    console.log('6. Testing epic name resolution...')
    const epicName = epics[0].name
    console.log(`   Switching to epic by name: ${epicName}`)
    const contextByName = await manager.switchToEpic(epicName)
    
    if (contextByName) {
      console.log('   ✅ Successfully switched using epic name')
      console.log(`   Epic: ${contextByName.epic.displayName}`)
    } else {
      console.log('   ❌ Failed to switch using epic name')
    }
    console.log('')

    // Test manager stats
    console.log('7. Manager statistics:')
    const stats = manager.getStats()
    console.log('   ', JSON.stringify(stats, null, 2))
    console.log('')

    // Test refresh current context
    if (manager.getCurrentContext()) {
      console.log('8. Testing context refresh...')
      await manager.refreshCurrentContext()
      console.log('   ✅ Context refreshed')
      console.log('')
    }

    // Test invalid epic switching
    console.log('9. Testing invalid epic handling...')
    const invalidContext = await manager.switchToEpic('non-existent-epic')
    if (invalidContext) {
      console.log('   ❌ Expected failure but switch succeeded')
    } else {
      console.log('   ✅ Correctly handled invalid epic')
    }
    console.log('')

  } catch (error) {
    console.error('❌ Test failed:', error)
  } finally {
    // Cleanup
    manager.destroy()
    console.log('✅ Test completed and resources cleaned up')
  }
}

testEpicContextManager()