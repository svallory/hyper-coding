# Critical Review: installation.mdx

## Document Overview
- **File**: /work/hyperdev/apps/docs/installation.mdx
- **Purpose**: Guide users through installing and configuring the envisioned HyperDev development platform
- **Target Audience**: Developers setting up HyperDev for the first time across different operating systems and experience levels

## Critical Issues Found

### High Priority Issues

#### 1. Fundamental CLI Command Inconsistency
- **Location**: Lines 98-101, 116-122, 178-184
- **Current Text**: Uses `hyper` as main command but installs `@hyperdev/cli`
- **Problem**: The package name suggests the CLI should be called `hyperdev`, not `hyper`. This creates confusion about what command to actually run after installation.
- **Impact**: High - Users won't know the correct command to execute after installation
- **Suggested Fix**: Either change package to `@hyperdev/hyper` or change all commands to `hyperdev`

#### 2. Tool Architecture Logic Gap  
- **Location**: Lines 104-108, 98-101
- **Current Text**: "Install all tools at once: hyper install --all" then lists gen, epics, dev, dash as separate tools
- **Problem**: If these are separate tools, why does installing the CLI (`@hyperdev/cli`) not include them? The relationship between the main CLI and sub-tools is unclear.
- **Impact**: High - Users don't understand what they're actually installing and what additional steps are needed
- **Suggested Fix**: Clarify whether these are:
  - Subcommands of main CLI (hyper gen, hyper epics)
  - Separate binaries (gen, epics, dev, dash) 
  - Plugins that need separate installation

#### 3. Missing Installation Verification Logic
- **Location**: Lines 132-140, verification section
- **Current Text**: "hyper doctor" checks "all dependencies, configurations, and tool availability"
- **Problem**: No explanation of what constitutes a successful check or what to do if it fails
- **Impact**: High - Users can't determine if their installation is actually working
- **Suggested Fix**: Show example successful output and common failure scenarios with fixes

### Medium Priority Issues

#### 4. Authentication Timing Confusion
- **Location**: Lines 169-185
- **Current Text**: Authentication section appears after tool installation
- **Problem**: It's unclear if authentication is required for basic tool functionality or only advanced features
- **Impact**: Medium - Users may attempt to use tools without proper authentication and get confused by failures
- **Suggested Fix**: Clarify which operations require authentication and which work offline

#### 5. Workspace vs Project Terminology Inconsistency
- **Location**: Lines 189-204
- **Current Text**: Uses both "workspace" and "project" terms interchangeably
- **Problem**: These could be different concepts (workspace = multiple projects, project = single codebase) but are used inconsistently
- **Impact**: Medium - Users may not understand the organizational model of the envisioned system
- **Suggested Fix**: Define the relationship between workspaces and projects clearly

#### 6. IDE Integration Prerequisites Unclear
- **Location**: Lines 207-267
- **Current Text**: Shows IDE integration setup without clarifying dependencies
- **Problem**: Unclear if HyperDev tools must be installed first, if authentication is required, or if certain commands need to work
- **Impact**: Medium - IDE integrations may fail with unclear error messages
- **Suggested Fix**: Add prerequisites section for each IDE integration

#### 7. Update Mechanism Logical Inconsistency
- **Location**: Lines 375-396
- **Current Text**: "hyper update" updates tools, but tools were installed via separate commands
- **Problem**: If tools are installed separately, how does the main CLI track and update them?
- **Impact**: Medium - Update functionality may not work as expected
- **Suggested Fix**: Clarify the relationship between CLI and tools for update management

### Lower Priority Issues

#### 8. Missing Success Criteria for Manual Installation
- **Location**: Lines 70-125, Manual Installation section
- **Current Text**: Shows installation commands but no way to verify each step succeeded
- **Problem**: Users can't validate progress through manual installation
- **Impact**: Low - Advanced users can likely troubleshoot, but creates unnecessary friction
- **Suggested Fix**: Add verification commands after each installation step

#### 9. Homebrew Installation Gaps
- **Location**: Lines 51-53
- **Current Text**: "brew install hyperdev-ai/tap/hyperdev"
- **Problem**: No explanation of what this installs (just CLI? all tools? how does it relate to npm installation?)
- **Impact**: Low - Homebrew users may be confused about what they actually installed
- **Suggested Fix**: Clarify scope of Homebrew installation vs other methods

## Specific Examples

### Issue: CLI Command Identity Crisis
- **Location**: Multiple sections (lines 76, 98, 116, 178)
- **Current Text**: Installs "@hyperdev/cli" but uses "hyper" command throughout
- **Problem**: The package name implies the command should be "hyperdev" not "hyper"
- **Impact**: Users will be confused about what command to actually run after installation
- **Suggested Fix**: Make consistent - either "@hyper/cli" package or "hyperdev" commands

### Issue: Tool Installation Architecture Confusion
- **Location**: Lines 98-101
- **Current Text**: "hyper install --all" or "hyper install gen epics dev dash"
- **Problem**: If the CLI is just @hyperdev/cli, where do these other tools come from? Are they bundled? Separate packages?
- **Impact**: Users don't understand what they're installing or how to troubleshoot missing tools
- **Suggested Fix**: Explain the relationship between CLI and tools clearly in the architecture

### Issue: Verification Without Success Criteria
- **Location**: Lines 132-140
- **Current Text**: "This checks all dependencies, configurations, and tool availability"
- **Problem**: No indication of what a successful check looks like or what to do if it fails
- **Impact**: Users can't determine if their installation is working correctly
- **Suggested Fix**: Show example successful output and link to troubleshooting for failures

## Overall Assessment
- **Vision Quality Score**: 6/10 - Good coverage but significant logical inconsistencies in core architecture
- **User Impact**: High - Installation is the first user experience and current documentation would create confusion about fundamental tool architecture
- **Priority for Vision Fixes**: High - These are foundational issues that affect every subsequent user interaction

## Recommendations

### Immediate High-Priority Fixes
1. **Resolve CLI naming inconsistency** - Decide whether the command is `hyper` or `hyperdev` and make everything consistent
2. **Clarify tool architecture** - Explain clearly how the main CLI relates to sub-tools (gen, epics, dev, dash)
3. **Add installation verification** - Show what successful installation looks like with concrete examples

### Important Medium-Priority Fixes
4. **Define workspace/project relationship** - Use these terms consistently with clear definitions
5. **Clarify authentication requirements** - Specify which operations require authentication
6. **Add IDE integration prerequisites** - Make dependencies clear for each IDE setup

### Structural Improvements
7. **Add installation success checkpoints** - Give users concrete ways to verify each installation step
8. **Improve troubleshooting coverage** - Connect common failure points to specific solutions
9. **Standardize installation paths** - Ensure all installation methods result in the same final state

### Testing Recommendations
The envisioned installation flow should be mentally "walkable" from start to finish. Currently, a user following this guide would likely get stuck trying to determine:
- What command to run after installation
- Whether their installation actually worked
- Which features require authentication
- How the various tools relate to each other

These gaps need resolution before the vision can be considered user-ready.