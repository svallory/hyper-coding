/**
 * Comprehensive test script to verify all combinations of sidebarIcons settings work correctly
 */

import { DocsJsonUpdater } from './dist/src/integrations/docs-json-updater.js';
import fs from 'fs';

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

// All possible icon configurations
const iconConfigurations = [
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

// Representative grouping combinations to test with different icon settings
const testGroupings = [
  ['folder'],           // Single grouping
  ['file'],            // Single grouping
  ['kind'],            // Single grouping
  ['folder', 'file'],  // Multi-grouping
  ['folder', 'kind'],  // Multi-grouping
  ['file', 'kind'],    // Multi-grouping
  ['folder', 'file', 'kind'] // Triple grouping
];

// Create a test instance
const updater = new DocsJsonUpdater({
  docsJsonPath: '/tmp/test-docs.json',
  tabName: 'Test API',
  outputDirectory: '/tmp/output',
  projectName: 'Test Project'
});

// Make the private method accessible for testing
updater.buildHierarchicalStructure = updater.constructor.prototype.buildHierarchicalStructure;

// Test function for specific grouping + icon combination
function testIconConfiguration(groupings, sidebarIcons, description) {
  console.log(`\n=== ${description} ===`);
  console.log(`Groupings: [${groupings.join(', ')}]`);
  console.log(`Icons: ${Array.isArray(sidebarIcons) ? `[${sidebarIcons.join(', ')}]` : sidebarIcons}`);
  
  try {
    const result = updater.buildHierarchicalStructure.call(updater, 
      mockReflections, 
      groupings, 
      'api-reference/test',
      sidebarIcons
    );
    
    // Validate icon behavior
    const validation = validateIcons(result, sidebarIcons, groupings);
    console.log(`📊 Icon Analysis: ${validation.summary}`);
    
    if (validation.issues.length > 0) {
      console.log('⚠️ Issues found:');
      validation.issues.forEach(issue => console.log(`  - ${issue}`));
    } else {
      console.log('✅ All icon configurations correct');
    }
    
    return validation.issues.length === 0;
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

// Detailed icon validation function
function validateIcons(result, sidebarIcons, groupings) {
  const issues = [];
  const stats = {
    folderIcons: 0,
    fileIcons: 0, 
    kindIcons: 0,
    noIcons: 0,
    totalGroups: 0
  };
  
  function analyzeNode(node, expectedLevel) {
    if (typeof node === 'string') {
      stats.noIcons++;
      return;
    }
    
    stats.totalGroups++;
    
    if (node.icon) {
      // Check if icon should be present based on sidebarIcons setting
      const shouldHaveIcon = shouldNodeHaveIcon(expectedLevel, sidebarIcons);
      
      if (!shouldHaveIcon) {
        issues.push(`Unexpected icon '${node.icon}' on ${expectedLevel} level group '${node.group}'`);
      } else {
        // Count icon types
        if (node.icon === 'folder') stats.folderIcons++;
        else if (node.icon === 'file') stats.fileIcons++;
        else if (['cube', 'plug', 'bolt', 'file-text', 'package', 'list'].includes(node.icon)) {
          stats.kindIcons++;
        }
      }
    } else {
      // Check if icon should be absent
      const shouldHaveIcon = shouldNodeHaveIcon(expectedLevel, sidebarIcons);
      
      if (shouldHaveIcon) {
        issues.push(`Missing icon on ${expectedLevel} level group '${node.group}'`);
      }
      stats.noIcons++;
    }
    
    // Recursively analyze child pages
    if (node.pages && Array.isArray(node.pages)) {
      node.pages.forEach(page => {
        if (typeof page === 'object') {
          // Determine child level based on groupings
          let childLevel = 'kind'; // default
          if (groupings.length > 1) {
            const currentLevelIndex = getLevelIndex(expectedLevel, groupings);
            if (currentLevelIndex < groupings.length - 1) {
              childLevel = groupings[currentLevelIndex + 1];
            }
          }
          analyzeNode(page, childLevel);
        }
      });
    }
  }
  
  // Analyze top-level nodes
  result.forEach(node => {
    const topLevel = groupings[0] || 'kind';
    analyzeNode(node, topLevel);
  });
  
  const summary = `${stats.folderIcons} folder icons, ${stats.fileIcons} file icons, ${stats.kindIcons} kind icons, ${stats.noIcons} no icons (${stats.totalGroups} total groups)`;
  
  return { issues, summary, stats };
}

// Helper to determine if a node should have an icon based on level and sidebarIcons setting
function shouldNodeHaveIcon(level, sidebarIcons) {
  if (sidebarIcons === 'none') return false;
  if (sidebarIcons === 'all') return true;
  if (Array.isArray(sidebarIcons)) {
    return sidebarIcons.includes(level);
  }
  return false;
}

// Helper to get the index of a level in groupings array
function getLevelIndex(level, groupings) {
  const index = groupings.indexOf(level);
  return index >= 0 ? index : groupings.length - 1;
}

// Run comprehensive icon tests
console.log('🎨 Testing Icon Configurations Across All Grouping Combinations');
console.log('=' .repeat(80));

let totalTests = 0;
let passedTests = 0;

// Test each grouping with each icon configuration
for (const grouping of testGroupings) {
  console.log(`\n📁 TESTING GROUPING: [${grouping.join(' → ')}]`);
  console.log('-'.repeat(50));
  
  for (const iconConfig of iconConfigurations) {
    const iconDesc = Array.isArray(iconConfig) ? `[${iconConfig.join(', ')}]` : iconConfig;
    const description = `${grouping.join(' → ')} with icons: ${iconDesc}`;
    
    const passed = testIconConfiguration(grouping, iconConfig, description);
    totalTests++;
    if (passed) passedTests++;
  }
}

// Special edge case tests
console.log('\n🧪 TESTING EDGE CASES');
console.log('-'.repeat(30));

// Test empty groupings (should default to kind)
console.log('\n=== Empty Groupings (Default to Kind) ===');
const emptyTest = testIconConfiguration([], 'all', 'Empty groupings with all icons');
totalTests++;
if (emptyTest) passedTests++;

// Test single item scenarios with different icon settings
console.log('\n=== Single Item Scenarios ===');
const singleItemReflections = [mockReflections[0]]; // Just one item

for (const iconConfig of ['all', 'none', ['kind'], ['folder']]) {
  const updaterSingle = new DocsJsonUpdater({
    docsJsonPath: '/tmp/test-docs.json',
    tabName: 'Test API',
    outputDirectory: '/tmp/output',
    projectName: 'Test Project'
  });
  updaterSingle.buildHierarchicalStructure = updaterSingle.constructor.prototype.buildHierarchicalStructure;
  
  try {
    const result = updaterSingle.buildHierarchicalStructure.call(updaterSingle, 
      singleItemReflections, 
      ['folder'], 
      'api-reference/test',
      iconConfig
    );
    
    const iconDesc = Array.isArray(iconConfig) ? `[${iconConfig.join(', ')}]` : iconConfig;
    console.log(`Single item with icons ${iconDesc}: ${result.length > 0 ? '✅' : '❌'}`);
    totalTests++;
    if (result.length > 0) passedTests++;
  } catch (error) {
    console.log(`Single item with icons ${iconConfig}: ❌ Error`);
    totalTests++;
  }
}

// Summary
console.log('\n📊 FINAL RESULTS');
console.log('=' .repeat(40));
console.log(`Total Tests: ${totalTests}`);
console.log(`Passed: ${passedTests}`);
console.log(`Failed: ${totalTests - passedTests}`);
console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

if (passedTests === totalTests) {
  console.log('\n🎉 ALL ICON CONFIGURATION TESTS PASSED!');
  console.log('The sidebarIcons system works correctly across all grouping combinations.');
} else {
  console.log('\n⚠️  Some tests failed. Review the issues above.');
}

console.log('\n🏁 Icon testing complete');