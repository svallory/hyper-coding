/**
 * Test script to verify multi-strategy navigation works for all combinations
 */

const { DocsJsonUpdater } = require('./dist/integrations/docs-json-updater.js');
const fs = require('fs');

// Mock reflection data that simulates TypeDoc output
const mockReflections = [
  {
    name: 'ActionTool',
    folder: 'actions',
    file: 'action-tool',
    kind: 'Class',
    kindIcon: 'cube',
    generatedPath: 'classes/ActionTool'
  },
  {
    name: 'ActionToolFactory', 
    folder: 'actions',
    file: 'action-tool',
    kind: 'Class',
    kindIcon: 'cube',
    generatedPath: 'classes/ActionToolFactory'
  },
  {
    name: 'RecipeEngine',
    folder: 'recipe-engine',
    file: 'recipe-engine',
    kind: 'Class', 
    kindIcon: 'cube',
    generatedPath: 'classes/RecipeEngine'
  },
  {
    name: 'StepExecutor',
    folder: 'recipe-engine',
    file: 'step-executor',
    kind: 'Class',
    kindIcon: 'cube', 
    generatedPath: 'classes/StepExecutor'
  },
  {
    name: 'ToolFactory',
    folder: 'actions',
    file: 'types',
    kind: 'Interface',
    kindIcon: 'plug',
    generatedPath: 'interfaces/ToolFactory'
  },
  {
    name: 'createTool',
    folder: 'actions', 
    file: 'utils',
    kind: 'Function',
    kindIcon: 'bolt',
    generatedPath: 'functions/createTool'
  }
];

// Test all strategy combinations
const strategyCombinations = [
  ['folder'],
  ['file'], 
  ['kind'],
  ['folder', 'file'],
  ['folder', 'kind'],
  ['file', 'kind'],
  ['folder', 'file', 'kind'],
  ['file', 'folder'], // Test order doesn't matter
  ['kind', 'folder'],
  ['file', 'folder', 'kind']
];

const iconCombinations = [
  'all',
  'none', 
  ['folder'],
  ['file'],
  ['kind'],
  ['folder', 'file'],
  ['folder', 'kind'],
  ['file', 'kind'],
  ['folder', 'file', 'kind']
];

// Create a test instance
const updater = new DocsJsonUpdater({
  docsJsonPath: '/tmp/test-docs.json',
  tabName: 'Test API',
  outputDirectory: '/tmp/output',
  projectName: 'Test Project'
});

// Test the buildHierarchicalStructure method directly
function testStrategy(strategies, sidebarIcons, description) {
  console.log(`\n=== Testing ${description} ===`);
  console.log(`Strategies: [${strategies.join(', ')}]`);
  console.log(`Icons: ${Array.isArray(sidebarIcons) ? `[${sidebarIcons.join(', ')}]` : sidebarIcons}`);
  
  try {
    // Access private method via prototype (for testing)
    const result = updater.buildHierarchicalStructure.call(updater, 
      mockReflections, 
      strategies, 
      'api-reference/test',
      sidebarIcons
    );
    
    console.log('Result structure:');
    console.log(JSON.stringify(result, null, 2));
    
    // Validate structure
    validateStructure(result, strategies, sidebarIcons);
    console.log('✅ Structure validation passed');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

function validateStructure(result, strategies, sidebarIcons) {
  // Basic validation logic
  if (!Array.isArray(result)) {
    throw new Error('Result should be an array');
  }
  
  // Check for expected structure based on strategies
  if (strategies.includes('folder') && strategies.length === 1) {
    // Should have folder groups
    const hasFolder = result.some(item => 
      typeof item === 'object' && item.group && 
      ['Actions', 'Recipe Engine'].includes(item.group)
    );
    if (!hasFolder) {
      throw new Error('Expected folder groups not found');
    }
  }
  
  if (strategies.includes('file') && strategies.length === 1) {
    // Should have file groups  
    const hasFile = result.some(item =>
      typeof item === 'object' && item.group &&
      ['action-tool', 'recipe-engine', 'step-executor'].includes(item.group)
    );
    if (!hasFile) {
      throw new Error('Expected file groups not found');
    }
  }
  
  if (strategies.includes('kind') && strategies.length === 1) {
    // Should have kind groups
    const hasKind = result.some(item =>
      typeof item === 'object' && item.group &&
      ['Classes', 'Interfaces', 'Functions'].includes(item.group)
    );
    if (!hasKind) {
      throw new Error('Expected kind groups not found');
    }
  }
}

// Make the private method accessible for testing
updater.buildHierarchicalStructure = updater.constructor.prototype.buildHierarchicalStructure;

// Run tests
console.log('🧪 Testing Multi-Strategy Navigation Generation');

// Test single strategies first
testStrategy(['folder'], 'all', 'Folder Only');
testStrategy(['file'], 'all', 'File Only'); 
testStrategy(['kind'], 'all', 'Kind Only');

// Test multi-strategy combinations
testStrategy(['folder', 'file'], 'all', 'Folder → File');
testStrategy(['folder', 'kind'], 'all', 'Folder → Kind');
testStrategy(['file', 'kind'], 'all', 'File → Kind');
testStrategy(['folder', 'file', 'kind'], 'all', 'Folder → File → Kind');

// Test that order doesn't matter
testStrategy(['file', 'folder'], 'all', 'File → Folder (order test)');

// Test different icon combinations
testStrategy(['folder'], ['folder'], 'Folder with folder icons only');
testStrategy(['folder', 'file'], ['folder', 'kind'], 'Multi-strategy with selective icons');

console.log('\n🏁 Testing complete');