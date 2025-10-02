#!/usr/bin/env node

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const crypto = require('crypto');

/**
 * HyperDash Binary Installer
 * Downloads and installs the appropriate binary for the current platform
 */

const packageJson = require('./package.json');

// Platform detection and mapping
const PLATFORM_MAPPING = {
  'darwin': 'Darwin',
  'linux': 'Linux',
  'win32': 'Windows'
};

const ARCH_MAPPING = {
  'x64': 'x86_64',
  'arm64': 'arm64'
};

const EXTENSION_MAPPING = {
  'darwin': 'tar.gz',
  'linux': 'tar.gz',
  'win32': 'zip'
};

class BinaryInstaller {
  constructor() {
    this.packageVersion = packageJson.version;
    this.binaryName = packageJson.config.binary.name;
    this.platform = process.platform;
    this.arch = process.arch;
    this.binDir = path.join(__dirname, 'bin');
    this.tempDir = path.join(__dirname, '.tmp');

    // Ensure directories exist
    if (!fs.existsSync(this.binDir)) {
      fs.mkdirSync(this.binDir, { recursive: true });
    }
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Get the download URL for the current platform
   */
  getDownloadUrl() {
    const mappedPlatform = PLATFORM_MAPPING[this.platform];
    const mappedArch = ARCH_MAPPING[this.arch];
    const extension = EXTENSION_MAPPING[this.platform];

    if (!mappedPlatform || !mappedArch) {
      throw new Error(`Unsupported platform: ${this.platform}-${this.arch}`);
    }

    // Skip Windows ARM64 as per GoReleaser config
    if (this.platform === 'win32' && this.arch === 'arm64') {
      throw new Error('Windows ARM64 is not supported');
    }

    const filename = `hyper-dash_${mappedPlatform}_${mappedArch}.${extension}`;
    const version = this.packageVersion.startsWith('v') ? this.packageVersion : `v${this.packageVersion}`;

    return `https://github.com/hyperdev-io/hyper-dash/releases/download/${version}/${filename}`;
  }

  /**
   * Get the checksum URL for the current release
   */
  getChecksumUrl() {
    const version = this.packageVersion.startsWith('v') ? this.packageVersion : `v${this.packageVersion}`;
    return `https://github.com/hyperdev-io/hyper-dash/releases/download/${version}/checksums.txt`;
  }

  /**
   * Try multiple version formats if the primary fails
   */
  async tryDownloadWithFallbacks(primaryUrl, dest) {
    const errors = [];

    // Try primary URL first
    try {
      await this.downloadFile(primaryUrl, dest);
      return;
    } catch (error) {
      errors.push(`Primary (${primaryUrl}): ${error.message}`);
    }

    // Try without 'v' prefix
    if (primaryUrl.includes('/v' + this.packageVersion + '/')) {
      const fallbackUrl = primaryUrl.replace('/v' + this.packageVersion + '/', '/' + this.packageVersion + '/');
      try {
        console.log(`⚠️  Primary URL failed, trying fallback: ${fallbackUrl}`);
        await this.downloadFile(fallbackUrl, dest);
        return;
      } catch (error) {
        errors.push(`Fallback 1 (${fallbackUrl}): ${error.message}`);
      }
    }

    // Try 'latest' as version
    const latestUrl = primaryUrl.replace(`/v${this.packageVersion}/`, '/latest/').replace(`/${this.packageVersion}/`, '/latest/');
    try {
      console.log(`⚠️  Version-specific URL failed, trying latest: ${latestUrl}`);
      await this.downloadFile(latestUrl, dest);
      return;
    } catch (error) {
      errors.push(`Latest (${latestUrl}): ${error.message}`);
    }

    // All attempts failed
    const errorMessage = `Failed to download from any URL:\n${errors.join('\n')}`;
    throw new Error(errorMessage);
  }

  /**
   * Download file with progress indication
   */
  downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      console.log(`📦 Downloading from: ${url}`);

      const file = fs.createWriteStream(dest);
      const request = url.startsWith('https') ? https : http;

      const req = request.get(url, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          console.log(`↪️  Redirecting to: ${response.headers.location}`);
          return this.downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with status: ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedSize = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize > 0) {
            const progress = Math.round((downloadedSize / totalSize) * 100);
            process.stdout.write(`\r📈 Progress: ${progress}% (${downloadedSize}/${totalSize} bytes)`);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log('\n✅ Download completed');
          resolve();
        });

        file.on('error', (err) => {
          fs.unlink(dest, () => {}); // Delete the file on error
          reject(err);
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Download request failed: ${err.message}`));
      });

      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Download timeout after 30 seconds'));
      });
    });
  }

  /**
   * Verify the checksum of the downloaded file
   */
  async verifyChecksum(archivePath) {
    console.log('🔐 Verifying checksum...');
    const checksumUrl = this.getChecksumUrl();
    const checksumPath = path.join(this.tempDir, 'checksums.txt');

    try {
      await this.downloadFile(checksumUrl, checksumPath);
    } catch (error) {
      console.warn(`⚠️  Could not download checksums.txt. Skipping verification. Error: ${error.message}`);
      return;
    }

    const checksums = fs.readFileSync(checksumPath, 'utf8');
    const archiveFilename = path.basename(archivePath);

    const expectedChecksumLine = checksums.split('\n').find(line => line.includes(archiveFilename));
    if (!expectedChecksumLine) {
      throw new Error(`Checksum for ${archiveFilename} not found in checksums.txt`);
    }
    const expectedChecksum = expectedChecksumLine.split(/\s+/)[0];

    const fileBuffer = fs.readFileSync(archivePath);
    const hash = crypto.createHash('sha256');
    hash.update(fileBuffer);
    const calculatedChecksum = hash.digest('hex');

    if (calculatedChecksum !== expectedChecksum) {
      throw new Error(`Checksum mismatch for ${archiveFilename}. Expected ${expectedChecksum}, got ${calculatedChecksum}.`);
    }

    console.log('✅ Checksum verified');
  }

  /**
   * Extract tar.gz archive
   */
  extractTarGz(archivePath, extractPath) {
    return new Promise((resolve, reject) => {
      console.log('🗜️  Extracting tar.gz archive...');

      const readStream = fs.createReadStream(archivePath);
      const gunzip = zlib.createGunzip();

      // Simple tar extraction for single binary
      let chunks = [];

      readStream
        .pipe(gunzip)
        .on('data', (chunk) => chunks.push(chunk))
        .on('end', () => {
          try {
            // Use tar command if available, otherwise fall back to node implementation
            if (this.commandExists('tar')) {
              execSync(`tar -xzf "${archivePath}" -C "${extractPath}"`, { stdio: 'ignore' });
            } else {
              // Basic tar parsing - look for the binary file
              const buffer = Buffer.concat(chunks);
              this.extractBinaryFromTar(buffer, extractPath);
            }
            resolve();
          } catch (error) {
            reject(error);
          }
        })
        .on('error', reject);
    });
  }

  /**
   * Extract zip archive (Windows)
   */
  extractZip(archivePath, extractPath) {
    return new Promise((resolve, reject) => {
      console.log('🗜️  Extracting zip archive...');

      try {
        if (this.commandExists('unzip')) {
          execSync(`unzip -q "${archivePath}" -d "${extractPath}"`, { stdio: 'ignore' });
        } else if (this.commandExists('powershell')) {
          execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractPath}'"`, { stdio: 'ignore' });
        } else {
          throw new Error('No zip extraction utility found. Please install unzip or use PowerShell on Windows.');
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Basic tar file parsing to extract binary
   */
  extractBinaryFromTar(buffer, extractPath) {
    // This is a simplified tar parser
    // In production, you might want to use a proper tar library
    let offset = 0;

    while (offset < buffer.length) {
      if (offset + 512 > buffer.length) break;

      const header = buffer.slice(offset, offset + 512);
      const filename = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
      const filesize = parseInt(header.toString('utf8', 124, 136).replace(/\0.*$/, ''), 8);

      offset += 512;

      if (filename && filename.includes(this.binaryName)) {
        const fileData = buffer.slice(offset, offset + filesize);
        const outputPath = path.join(extractPath, this.binaryName);
        fs.writeFileSync(outputPath, fileData, { mode: 0o755 });
        console.log(`📁 Extracted: ${filename} -> ${outputPath}`);
        return;
      }

      // Move to next file (rounded up to 512-byte boundary)
      offset += Math.ceil(filesize / 512) * 512;
    }

    throw new Error(`Binary ${this.binaryName} not found in archive`);
  }

  /**
   * Check if a command exists
   */
  commandExists(command) {
    try {
      execSync(`which ${command}`, { stdio: 'ignore' });
      return true;
    } catch {
      try {
        execSync(`where ${command}`, { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Make binary executable and create symlink
   */
  setupBinary() {
    // Use different names to avoid conflicts with the wrapper script
    const executableName = this.platform === 'win32' ? `${this.binaryName}.exe` : `${this.binaryName}-bin`;
    const binaryPath = path.join(this.binDir, executableName);

    // Find the extracted binary
    let extractedBinary = path.join(this.tempDir, this.platform === 'win32' ? `${this.binaryName}.exe` : this.binaryName);
    if (!fs.existsSync(extractedBinary)) {
      extractedBinary = path.join(this.tempDir, this.binaryName);
    }

    if (!fs.existsSync(extractedBinary)) {
      throw new Error(`Extracted binary not found at ${extractedBinary}`);
    }

    // Copy to bin directory
    fs.copyFileSync(extractedBinary, binaryPath);

    // Make executable on Unix systems
    if (this.platform !== 'win32') {
      fs.chmodSync(binaryPath, 0o755);
    }

    console.log(`🔗 Binary installed: ${binaryPath}`);

    // Test the binary
    try {
      const result = execSync(`"${binaryPath}" --version`, { encoding: 'utf8', timeout: 5000 });
      console.log(`🧪 Binary test successful: ${result.trim()}`);
    } catch (error) {
      console.warn(`⚠️  Binary test failed: ${error.message}`);
    }
  }

  /**
   * Show usage information after installation
   */
  showUsageInfo() {
    console.log('');
    console.log('Usage:');
    console.log('  hyper-dash                    # Start the dashboard');
    console.log('  hyper-dash -test              # Test data loading');
    console.log('  hyper-dash --version          # Show version');
    console.log('');
    console.log('For more information, visit: https://github.com/hyperdev-io/hyper-dash');
  }

  /**
   * Clean up temporary files
   */
  cleanup() {
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
        console.log('🧹 Cleaned up temporary files');
      }
    } catch (error) {
      console.warn(`⚠️  Cleanup warning: ${error.message}`);
    }
  }

  /**
   * Check for local development binary
   */
  checkLocalBinary() {
    const possiblePaths = [
      path.join(__dirname, 'dash'),
      path.join(__dirname, 'hyper-dash'),
      path.join(__dirname, '..', '..', 'dash'),
      path.join(__dirname, '..', '..', 'hyper-dash')
    ];

    for (const localPath of possiblePaths) {
      if (fs.existsSync(localPath)) {
        console.log(`🔍 Found local binary: ${localPath}`);
        return localPath;
      }
    }

    return null;
  }

  /**
   * Main installation process
   */
  async install() {
    try {
      console.log('🚀 Installing hyper-dash binary...');
      console.log(`📋 Platform: ${this.platform}-${this.arch}`);

      // Check for local development binary first
      const localBinary = this.checkLocalBinary();
      if (localBinary) {
        console.log('📁 Using local binary for development');
        const executableName = this.platform === 'win32' ? `${this.binaryName}.exe` : `${this.binaryName}-bin`;
        const binaryPath = path.join(this.binDir, executableName);
        fs.copyFileSync(localBinary, binaryPath);

        if (this.platform !== 'win32') {
          fs.chmodSync(binaryPath, 0o755);
        }

        console.log('🎉 hyper-dash installed successfully (local binary)!');
        this.showUsageInfo();
        return;
      }

      const downloadUrl = this.getDownloadUrl();
      const archivePath = path.join(this.tempDir, `hyper-dash.${EXTENSION_MAPPING[this.platform]}`);

      // Download the archive with fallback mechanisms
      await this.tryDownloadWithFallbacks(downloadUrl, archivePath);

      // Verify checksum
      await this.verifyChecksum(archivePath);

      // Extract based on platform
      if (this.platform === 'win32') {
        await this.extractZip(archivePath, this.tempDir);
      } else {
        await this.extractTarGz(archivePath, this.tempDir);
      }

      // Setup the binary
      this.setupBinary();

      console.log('🎉 hyper-dash installed successfully!');
      this.showUsageInfo();

    } catch (error) {
      console.error('❌ Installation failed:', error.message);

      if (error.message.includes('Unsupported platform')) {
        console.error('');
        console.error('Supported platforms:');
        console.error('  - macOS (x64, arm64)');
        console.error('  - Linux (x64, arm64)');
        console.error('  - Windows (x64)');
      } else if (error.message.includes('Download failed')) {
        console.error('');
        console.error('This might be due to:');
        console.error('  - Network connectivity issues');
        console.error('  - GitHub releases not available for this version');
        console.error('  - Rate limiting');
        console.error('');
        console.error('Please try again later or install manually from:');
        console.error('https://github.com/hyperdev-io/hyper-dash/releases');
      }

      process.exit(1);
    } finally {
      this.cleanup();
    }
  }
}

// Run installation if called directly
if (require.main === module) {
  const installer = new BinaryInstaller();
  installer.install().catch((error) => {
    console.error('Installation error:', error);
    process.exit(1);
  });
}

module.exports = BinaryInstaller;
