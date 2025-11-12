#!/usr/bin/env node

/**
 * Documentation generation script with improved DX
 * Runs build, extract, and generate steps with clean, formatted output
 */

const { execSync } = require('child_process');
const path = require('path');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// Status icons
const icons = {
  start: '▶',
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
};

function log(message, color = 'reset', icon = null) {
  const prefix = icon ? `${icon} ` : '';
  console.log(`${colors[color]}${prefix}${message}${colors.reset}`);
}

function section(title) {
  console.log(`\n${colors.bright}${colors.blue}${'—'.repeat(60)}${colors.reset}`);
  log(title, 'bright', icons.start);
  console.log(`${colors.blue}${'—'.repeat(60)}${colors.reset}`);
}

function runCommand(command, stepName, suppressOutput = false) {
  try {
    const startTime = Date.now();

    const output = execSync(command, {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      stdio: suppressOutput ? 'pipe' : 'inherit',
    });

    const duration = Date.now() - startTime;

    if (suppressOutput && output) {
      // Show filtered output if suppressed
      const lines = output.split('\n').filter(line => {
        // Only show warnings and errors
        return line.includes('Warning:') ||
               line.includes('Error:') ||
               line.includes('✓') ||
               line.includes('Generated') ||
               line.includes('Updated');
      });

      if (lines.length > 0) {
        console.log(lines.join('\n'));
      }
    }

    log(`${stepName} completed in ${duration}ms`, 'green', icons.success);
    return true;
  } catch (error) {
    log(`${stepName} failed`, 'red', icons.error);
    if (error.stdout) {
      console.error(error.stdout.toString());
    }
    if (error.stderr) {
      console.error(error.stderr.toString());
    }
    return false;
  }
}

function main() {
  console.clear();

  log('Mintlify-TSdocs Documentation Generator', 'bright');
  log('Generating documentation from TypeScript API', 'dim');

  const startTime = Date.now();

  // Step 1: Build
  section('Step 1: Building TypeScript');
  if (!runCommand('tsc && cp -r src/schemas lib/ && cp -r src/components lib/', 'Build', true)) {
    process.exit(1);
  }

  // Step 2: Extract API
  section('Step 2: Extracting API Documentation');
  if (!runCommand('api-extractor run --local', 'API Extraction')) {
    process.exit(1);
  }

  // Step 3: Generate docs
  section('Step 3: Generating Mintlify Documentation');
  if (!runCommand(
    'node ./bin/mintlify-tsdocs markdown -i docs/reference --tab-name Reference --group "Code API" --menu --readme -o docs/reference --docs-json docs/docs.json',
    'Documentation Generation'
  )) {
    process.exit(1);
  }

  // Summary
  const totalTime = Date.now() - startTime;
  console.log(`\n${colors.green}${'='.repeat(60)}${colors.reset}`);
  log(`Documentation generated successfully in ${(totalTime / 1000).toFixed(2)}s`, 'green', icons.success);
  console.log(`${colors.green}${'='.repeat(60)}${colors.reset}\n`);
}

main();
