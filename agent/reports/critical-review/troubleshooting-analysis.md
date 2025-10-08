# Critical Review: troubleshooting.mdx

## Document Overview
- **File**: /work/hyperdev/apps/docs/troubleshooting.mdx
- **Purpose**: Comprehensive troubleshooting guide for diagnosing and resolving HyperDev tool issues
- **Target Audience**: Developers using HyperDev who encounter problems during installation, configuration, or usage

## Critical Issues Found

### High Priority Issues

#### 1. Command Name Inconsistency Throughout Document
- **Location**: Throughout entire document
- **Current Text**: Document consistently uses "hypergen" as the command name
- **Problem**: This creates massive confusion since the tool is being rebranded as HyperDev, yet all troubleshooting commands reference "hypergen"
- **Impact**: High - Users will be completely lost trying to troubleshoot a "HyperDev" tool using "hypergen" commands
- **Suggested Fix**: Replace all instances of "hypergen" command with the correct HyperDev command name

#### 2. Template Structure Conceptual Mismatch
- **Location**: Lines 314-321 (template structure example)
- **Current Text**: Shows `_templates/component/new/component.ejs.t` structure
- **Problem**: This follows the old Hygen pattern where templates are organized as `generator/action/files`. For HyperDev's vision, this should likely be more modern
- **Impact**: High - Teaches users an outdated mental model
- **Suggested Fix**: Update template structure to match HyperDev's envisioned architecture

#### 3. Configuration File Format Inconsistency
- **Location**: Lines 202-209, 285, 703-709, etc.
- **Current Text**: Shows both `hypergen.config.js` and various export formats
- **Problem**: Document shows multiple configuration formats without clearly establishing which is canonical for HyperDev
- **Impact**: High - Users won't know which configuration format to use
- **Suggested Fix**: Standardize on one configuration format and clearly document it

#### 4. Action System Conceptual Confusion
- **Location**: Lines 518-528 (action file structure)
- **Current Text**: Shows TypeScript action structure with exports
- **Problem**: This doesn't align with the modern template/recipe system described elsewhere in HyperDev docs
- **Impact**: High - Creates conflicting mental models about how actions work
- **Suggested Fix**: Align action examples with the recipe-based system architecture

### Medium Priority Issues

#### 1. Package Manager Inconsistency
- **Location**: Lines 67, 76, 119, 154, etc.
- **Current Text**: Shows "bun install -g hypergen" and similar commands
- **Problem**: While document uses bun correctly, it installs "hypergen" package instead of whatever HyperDev's package will be named
- **Impact**: Medium - Users will install wrong package
- **Suggested Fix**: Update package name throughout to match HyperDev's planned distribution

#### 2. Debug Namespace Inconsistency
- **Location**: Lines 34, 191, 407, etc.
- **Current Text**: `DEBUG=hypergen* hypergen [command]`
- **Problem**: Debug namespaces reference "hypergen" instead of HyperDev
- **Impact**: Medium - Debug commands won't work with actual HyperDev tool
- **Suggested Fix**: Update debug namespaces to match HyperDev's implementation

#### 3. URL and Repository Reference Issues
- **Location**: Lines 782-815, 1252-1254
- **Current Text**: References github.com/user/repo and github.com/svallory/hypergen
- **Problem**: GitHub repository references point to hypergen instead of HyperDev repositories
- **Impact**: Medium - Users will go to wrong places for help
- **Suggested Fix**: Update all repository URLs to point to HyperDev repositories

#### 4. Template File Extension Confusion
- **Location**: Lines 305, 352, etc.
- **Current Text**: Uses `.ejs.t` file extension consistently
- **Problem**: HyperDev may use different template file extensions in its modern approach
- **Impact**: Medium - Users may use wrong file naming conventions
- **Suggested Fix**: Verify and update template file extensions to match HyperDev's design

### Lower Priority Issues

#### 1. Legacy Command References
- **Location**: Lines 198, 330, 514, etc.
- **Current Text**: Commands like `hypergen init generator`
- **Problem**: These may be legacy Hygen commands that don't align with HyperDev's vision
- **Impact**: Low - May confuse advanced users but core functionality still described
- **Suggested Fix**: Update command examples to match HyperDev's actual CLI design

#### 2. Cache Directory References
- **Location**: Lines 790, 912, 949
- **Current Text**: `~/.hypergen/cache/`
- **Problem**: Cache directory references old tool name
- **Impact**: Low - Functional issue but not critical
- **Suggested Fix**: Update cache directory paths to match HyperDev naming

## Specific Examples

### Issue: Command Name Brand Confusion
- **Location**: Title, throughout document (1300+ occurrences)
- **Current Text**: "hypergen --version", "hypergen list", etc.
- **Problem**: The entire document is written for "hypergen" but this is supposed to be HyperDev troubleshooting documentation
- **Impact**: Users will be completely confused about what tool they're troubleshooting
- **Suggested Fix**: Global find-replace to update command name to HyperDev's actual CLI command

### Issue: Template Discovery Mental Model
- **Location**: Lines 322-326, 488-496
- **Current Text**: Shows manual template discovery with `hypergen discover`
- **Problem**: This may not align with HyperDev's envisioned template system architecture
- **Impact**: Users learn outdated workflow patterns
- **Suggested Fix**: Update discovery examples to match HyperDev's modern template resolution system

### Issue: Configuration Schema References
- **Location**: Lines 282-284
- **Current Text**: `hypergen config schema`
- **Problem**: Commands reference hypergen-specific functionality that may not exist in HyperDev
- **Impact**: Users will try non-existent commands
- **Suggested Fix**: Update command examples to match HyperDev's actual configuration system

### Issue: Error Code Namespace
- **Location**: Lines 176, 218, 261, etc.
- **Current Text**: Error codes like `CONFIG_FILE_NOT_FOUND`
- **Problem**: Error codes may not match HyperDev's actual error handling system
- **Impact**: Users won't be able to match error codes to solutions
- **Suggested Fix**: Verify error codes match HyperDev's planned error handling system

## Overall Assessment
- **Vision Quality Score**: 4/10 - The troubleshooting approaches and problem-solving methodology are sound, but the entire document is written for the wrong tool
- **User Impact**: High - Users will be completely confused trying to troubleshoot HyperDev using hypergen commands and concepts
- **Priority for Vision Fixes**: High - This document needs immediate and comprehensive updates to align with HyperDev branding and architecture

## Recommendations

### Immediate Actions Required
1. **Global Command Name Update**: Replace all instances of "hypergen" with HyperDev's actual command name
2. **Configuration Format Standardization**: Choose one configuration format and update all examples consistently
3. **Template Structure Modernization**: Update template organization examples to match HyperDev's envisioned architecture
4. **Repository URL Updates**: Fix all GitHub and package repository references

### Architectural Alignment Needed
1. **Action System Consistency**: Align action examples with recipe-based system described in other HyperDev documentation
2. **Template Engine Verification**: Verify that EJS is still the planned template engine for HyperDev
3. **Discovery System Updates**: Ensure template discovery commands match HyperDev's planned implementation
4. **Error Handling Alignment**: Verify all error codes and messages match HyperDev's actual error system

### Content Quality Improvements
1. **Add HyperDev-Specific Sections**: Include troubleshooting for features unique to HyperDev (recipes, modern actions, etc.)
2. **Remove Legacy Content**: Remove troubleshooting for deprecated Hygen features not carried forward to HyperDev
3. **Update Examples**: Ensure all code examples reflect HyperDev's modern development patterns
4. **Verify Command Accuracy**: Test all commands against HyperDev's planned CLI to ensure accuracy

### Vision Coherence Issues
The document has excellent troubleshooting methodology but suffers from complete disconnection from the HyperDev vision. It reads as a hypergen troubleshooting guide that was copied without proper adaptation to the new tool's architecture and branding. This creates a fundamental coherence problem that undermines user confidence and success.

The systematic debugging approach, categorization of issues, and solution formats are all excellent and should be preserved while updating the technical details to match HyperDev's actual implementation.