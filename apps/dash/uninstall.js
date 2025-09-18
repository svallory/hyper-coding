#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * HyperDash Binary Uninstaller
 * Cleans up installed binaries and temporary files
 */

const packageJson = require('./package.json');

class BinaryUninstaller {
  constructor() {
    this.binaryName = packageJson.config.binary.name;
    this.binDir = path.join(__dirname, 'bin');
    this.tempDir = path.join(__dirname, '.tmp');
  }

  /**
   * Remove directory recursively
   */
  removeDirectory(dirPath) {
    if (fs.existsSync(dirPath)) {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log(`🗑️  Removed: ${dirPath}`);
        return true;
      } catch (error) {
        console.warn(`⚠️  Warning: Could not remove ${dirPath}: ${error.message}`);
        return false;
      }
    }
    return true;
  }

  /**
   * Remove file safely
   */
  removeFile(filePath) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`🗑️  Removed: ${filePath}`);
        return true;
      } catch (error) {
        console.warn(`⚠️  Warning: Could not remove ${filePath}: ${error.message}`);
        return false;
      }
    }
    return true;
  }

  /**
   * Find and remove global symlinks (best effort)
   */
  removeGlobalLinks() {
    const possiblePaths = [
      '/usr/local/bin/hyper-dash',
      '/usr/bin/hyper-dash',
      path.join(process.env.HOME || '', '.local', 'bin', 'hyper-dash'),
      path.join(process.env.APPDATA || '', 'npm', 'hyper-dash'),
      path.join(process.env.APPDATA || '', 'npm', 'hyper-dash.cmd'),
    ];

    let removedCount = 0;
    
    possiblePaths.forEach(globalPath => {
      try {
        if (fs.existsSync(globalPath)) {
          const stats = fs.lstatSync(globalPath);
          
          // Check if it's a symlink pointing to our binary
          if (stats.isSymbolicLink()) {
            const linkTarget = fs.readlinkSync(globalPath);
            if (linkTarget.includes('hyper-dash')) {
              fs.unlinkSync(globalPath);
              console.log(`🔗 Removed symlink: ${globalPath} -> ${linkTarget}`);
              removedCount++;
            }
          } else if (stats.isFile()) {
            // For npm global installs, check if it's our script
            const content = fs.readFileSync(globalPath, 'utf8');
            if (content.includes('hyper-dash') && content.includes(__dirname)) {
              fs.unlinkSync(globalPath);
              console.log(`📝 Removed global script: ${globalPath}`);
              removedCount++;
            }
          }
        }
      } catch (error) {
        // Silently ignore permission errors and missing files
      }
    });

    if (removedCount > 0) {
      console.log(`✅ Removed ${removedCount} global link(s)`);
    }
  }

  /**
   * Clean npm cache entries
   */
  cleanNpmCache() {
    try {
      // Only clean if npm is available
      execSync('npm --version', { stdio: 'ignore' });
      
      console.log('🧹 Cleaning npm cache...');
      execSync('npm cache clean --force', { stdio: 'ignore' });
      console.log('✅ npm cache cleaned');
    } catch (error) {
      // npm not available or cache clean failed - not critical
      console.log('ℹ️  npm cache clean skipped (npm not available or failed)');
    }
  }

  /**
   * Display helpful uninstall information
   */
  showUninstallInfo() {
    console.log('');
    console.log('📋 Manual cleanup (if needed):');
    console.log('');
    console.log('If you installed hyper-dash globally, you may need to manually remove:');
    console.log('  - Global npm packages: npm uninstall -g hyper-dash');
    console.log('  - Homebrew: brew uninstall hyper-dash');
    console.log('  - System packages: sudo apt remove hyper-dash (or equivalent)');
    console.log('');
    console.log('Configuration files (if any) may remain in:');
    console.log('  - ~/.hyper-dash/');
    console.log('  - ~/.config/hyper-dash/');
    console.log('');
  }

  /**
   * Main uninstallation process
   */
  async uninstall() {
    console.log('🧹 Uninstalling hyper-dash...');
    
    let success = true;
    
    // Remove binary directory
    if (!this.removeDirectory(this.binDir)) {
      success = false;
    }
    
    // Remove temporary directory
    if (!this.removeDirectory(this.tempDir)) {
      success = false;
    }
    
    // Remove any cached archives
    const cacheFiles = [
      path.join(__dirname, 'hyper-dash.tar.gz'),
      path.join(__dirname, 'hyper-dash.zip'),
      path.join(__dirname, '.download-cache')
    ];
    
    cacheFiles.forEach(file => {
      if (!this.removeFile(file)) {
        success = false;
      }
    });
    
    // Try to remove global links (best effort)
    this.removeGlobalLinks();
    
    // Clean npm cache
    this.cleanNpmCache();
    
    if (success) {
      console.log('✅ hyper-dash uninstalled successfully');
    } else {
      console.log('⚠️  hyper-dash uninstallation completed with warnings');
      console.log('Some files could not be removed due to permissions or other issues.');
    }
    
    this.showUninstallInfo();
  }

  /**
   * Verify uninstallation
   */
  verify() {
    const binaryPath = path.join(this.binDir, this.binaryName);
    
    if (fs.existsSync(binaryPath)) {
      console.log('❌ Uninstallation verification failed: Binary still exists');
      return false;
    }
    
    if (fs.existsSync(this.tempDir)) {
      console.log('⚠️  Temporary directory still exists (may contain other files)');
    }
    
    console.log('✅ Uninstallation verification passed');
    return true;
  }
}

// Run uninstallation if called directly
if (require.main === module) {
  const uninstaller = new BinaryUninstaller();
  
  uninstaller.uninstall().then(() => {
    uninstaller.verify();
  }).catch((error) => {
    console.error('Uninstallation error:', error);
    process.exit(1);
  });
}

module.exports = BinaryUninstaller;