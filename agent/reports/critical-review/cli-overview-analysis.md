# Critical Review: CLI Overview Documentation

## Document Overview
- **File**: `/work/hyperdev/apps/docs/cli/overview.mdx`
- **Purpose**: Introduces the unified HyperDev CLI as the primary interface for AI-augmented development workflows
- **Target Audience**: Developers at all levels who want to use the HyperDev methodology through command-line tools

## Critical Issues Found

### High Priority Issues

#### 1. Fundamental Command Architecture Contradiction
- **Location**: Lines 58-62 (Advanced Tool Access section)
- **Current Text**: Lists `hyper gen` under both Workflow Commands (line 36) and Advanced Tool Access (line 58)
- **Problem**: This creates a major conceptual contradiction about what `hyper gen` actually is - is it a basic workflow command or an advanced tool?
- **Impact**: High - Users will be confused about the command hierarchy and when to use which version
- **Suggested Fix**: Clarify whether these are the same command with different usage patterns, or distinct commands with different purposes

#### 2. Inconsistent Tool-to-Command Mapping
- **Location**: Lines 116-120 (Integration section) vs Lines 58-62 (Advanced Tool Access)
- **Current Text**: Claims CLI provides access to 5 core tools, but command mapping is inconsistent
- **Problem**: The tool names (Gen, Epics, Dev, DX, Dash) don't cleanly map to the command structure presented
- **Impact**: High - Breaks the promised integration between CLI and methodology
- **Suggested Fix**: Either redesign the command structure to match the 5 tools exactly, or clarify how commands relate to tools

#### 3. Discovery Command Logic Flaw  
- **Location**: Lines 42-44 (Discovery Commands)
- **Current Text**: `hyper search` for "Universal search" and `hyper list` for "List available resources"
- **Problem**: These appear to overlap significantly - unclear when to use search vs list
- **Impact**: High - Users won't know which command to use for finding resources
- **Suggested Fix**: Define clear, non-overlapping purposes for these commands

### Medium Priority Issues

#### 4. Workflow vs Resource Command Confusion
- **Location**: Lines 47-50 (Resource Commands)  
- **Current Text**: `hyper epic`, `hyper task`, `hyper docs` listed as "Resource Commands"
- **Problem**: These seem like they should be part of workflow commands, not separate resource management
- **Impact**: Medium - Creates artificial separation between planning and execution
- **Suggested Fix**: Reconsider categorization - these might be workflow sub-commands

#### 5. Missing Command Consistency
- **Location**: Lines 107-108 (Composable Commands example)
- **Current Text**: Shows `hyper plan create --name` but `hyper plan` is listed as a workflow command without subcommands
- **Problem**: Example suggests subcommands that aren't documented in the command structure
- **Impact**: Medium - Leads users to expect functionality that may not exist as shown
- **Suggested Fix**: Align examples with documented command structure

#### 6. Context Parameter Ambiguity
- **Location**: Line 107 (Composable Commands example)
- **Current Text**: `hyper gen api-gateway --context "user management"`
- **Problem**: The `--context` parameter is not explained - unclear what this does or how it works
- **Impact**: Medium - Users won't understand how to use context effectively
- **Suggested Fix**: Either explain the context system or remove from examples

### Lower Priority Issues

#### 7. Inconsistent Help Command Patterns
- **Location**: Lines 97-99 (Contextual Help)
- **Current Text**: Mix of `--help` flags and `help` subcommands
- **Problem**: Inconsistent patterns for getting help
- **Impact**: Low - Minor usability issue
- **Suggested Fix**: Standardize on one help pattern or explain when to use which

#### 8. Trust Score Presentation
- **Location**: Lines 136-138 (Error Handling example)
- **Current Text**: Shows trust scores like "trust: 9.2" in error messages
- **Problem**: No explanation of what trust scores mean or how to interpret them
- **Impact**: Low - Users see numbers without context
- **Suggested Fix**: Brief explanation of trust scoring system

## Specific Examples

### Issue: Command Duplication Confusion
- **Location**: Lines 36 and 58
- **Current Text**: "`hyper gen` - AI-augmented code generation" (Workflow) and "`hyper gen` - Advanced code generation features" (Advanced Tools)
- **Problem**: Same command appears in two different categories with slightly different descriptions, creating confusion about its true purpose and complexity level
- **Impact**: Users won't understand the command hierarchy or know which documentation to follow
- **Suggested Fix**: Either make these distinct commands (`hyper generate` vs `hyper gen`) or clarify they're the same command with different usage levels

### Issue: Methodology Integration Claims
- **Location**: Lines 116-120
- **Current Text**: "CLI directly implements the HyperDev methodology, providing command-line access to: Gen Tool, Epics Tool, Dev Tool, DX Tool, Dash Tool"
- **Problem**: The command structure doesn't clearly map to these 5 tools - some tools have obvious commands, others don't
- **Impact**: High - Breaks the promised seamless integration between CLI and methodology
- **Suggested Fix**: Restructure commands to clearly map to the 5 tools, or explain how the mapping works

### Issue: Incomplete Workflow Logic
- **Location**: Lines 105-110 (Composable Commands example)
- **Current Text**: Shows a complete project setup flow with commands that aren't fully documented
- **Problem**: Example suggests `hyper plan create` and `hyper dev --watch --focus` without documenting these parameters
- **Impact**: Users will try commands that may not work as shown
- **Suggested Fix**: Use only documented command patterns in examples, or document all shown parameters

## Overall Assessment
- **Vision Quality Score**: 6/10 - Good concept but significant structural inconsistencies
- **User Impact**: High - Command hierarchy confusion will frustrate users from day one
- **Priority for Vision Fixes**: High - Core command structure needs resolution before implementation

## Recommendations

### Immediate Fixes Required
1. **Resolve Command Duplication**: Decide if `hyper gen` is one command or multiple, and update documentation accordingly
2. **Clarify Tool-Command Mapping**: Either restructure commands to match the 5 tools exactly or provide clear mapping documentation
3. **Fix Discovery Logic**: Define distinct, non-overlapping purposes for `search` vs `list` commands

### Architectural Decisions Needed
1. **Command Categorization**: Reconsider whether the current 4 categories (Workflow, Discovery, Resource, Dashboard) make sense or if a simpler structure would be better
2. **Help System**: Standardize on one help pattern throughout the CLI
3. **Context System**: Either fully document the context parameter system or remove it from examples

### Documentation Standards
1. **Example Accuracy**: Ensure all examples use only documented command patterns and parameters
2. **Terminology Consistency**: Use the same terms throughout (e.g., "generate" vs "gen")
3. **Conceptual Clarity**: Each command should have one clear purpose that doesn't overlap with others

### Long-term Considerations
The CLI architecture should directly reflect the 5-tool methodology structure for maximum user comprehension. Consider:
- `hyper gen` (Gen Tool)
- `hyper epic` (Epics Tool) 
- `hyper dev` (Dev Tool)
- `hyper dx` (DX Tool)
- `hyper dash` (Dash Tool)

With workflow-oriented aliases and discovery commands as secondary features.