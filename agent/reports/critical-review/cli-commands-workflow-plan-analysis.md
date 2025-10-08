# Critical Review: cli/commands/workflow/plan.mdx

## Document Overview
- **File**: `/work/hyperdev/apps/docs/cli/commands/workflow/plan.mdx`
- **Purpose**: Document the `hyper plan` command for strategic planning and architecture design with AI-powered epics and technical specifications
- **Target Audience**: Developers and project managers who need to create comprehensive feature plans, epics, and technical documentation

## Critical Issues Found

### High Priority Issues

#### 1. **Critical Epic Template Conceptual Mismatch**
- **Location**: Lines 104-118 (Epic Templates table)
- **Current Text**: Template options like `saas-feature`, `api-service`, `ui-component`, `integration`, etc.
- **Problem**: These templates describe **feature types** rather than **document formats**. An Epic is fundamentally a project planning document (like a PRD), so templates should define document structures, not feature categories.
- **Impact**: High - This creates fundamental confusion about what Epics are and leads users to think Epics are feature containers rather than planning documents.
- **Suggested Fix**: Replace with document-oriented templates like `prd-format`, `technical-spec-template`, `architecture-doc`, `user-story-format`

#### 2. **Command Syntax Inconsistency**
- **Location**: Lines 64-73 (Create New Epic examples)
- **Current Text**: Shows `hyper plan create --name "User Authentication System"` 
- **Problem**: The syntax `hyper plan create` conflicts with the documented syntax `hyper plan [epic] [options]` - there's no `create` subcommand mentioned in the syntax section.
- **Impact**: High - Users following the documentation will get command not found errors.
- **Suggested Fix**: Either document `create` as a subcommand in syntax, or use `hyper plan --create --name`

#### 3. **Epic Structure vs. Configuration Logic Contradiction**
- **Location**: Lines 124-188 (Epic Structure and Configuration)
- **Current Text**: Shows epics containing architecture/, tasks/, tests/, docs/ directories AND an epic.yml with technical specifications
- **Problem**: This conflates the Epic document with its implementation artifacts. An Epic should be a planning document that **describes** what to build, not contain the actual build artifacts.
- **Impact**: High - Blurs the line between planning and implementation, making the epic concept incoherent.
- **Suggested Fix**: Epic should contain planning documents only; implementation artifacts should be generated separately during implementation phase.

### Medium Priority Issues

#### 4. **Planning Dashboard Workflow Gap**
- **Location**: Lines 452-476 (Planning Dashboard)
- **Current Text**: "Launch planning dashboard" but no clear workflow for how dashboard integrates with command-line operations
- **Problem**: Dashboard appears disconnected from the CLI workflow - unclear how changes in dashboard affect epic files or CLI state
- **Impact**: Medium - Users won't understand how to effectively use both interfaces together
- **Suggested Fix**: Document synchronization between dashboard and CLI, show how changes flow between interfaces

#### 5. **Task Generation Logic Inconsistency**
- **Location**: Lines 322-361 (Task Management section)
- **Current Text**: Shows both `--tasks --generate` and `--tasks --breakdown` for task creation
- **Problem**: Unclear difference between "generate" and "breakdown" - seems like the same operation with different names
- **Impact**: Medium - Users won't know which command to use for task creation
- **Suggested Fix**: Clarify the distinction or consolidate into single clear command

#### 6. **Multi-Epic Planning Conceptual Gap**
- **Location**: Lines 524-535 (Multi-Epic Planning)
- **Current Text**: References "program-level roadmap" and "cross-epic dependencies"
- **Problem**: No explanation of what a "program" is in relation to epics, or how epic dependencies should logically work
- **Impact**: Medium - Advanced users will be confused about the planning hierarchy
- **Suggested Fix**: Define program concept and explain epic dependency logic clearly

### Lower Priority Issues

#### 7. **AI Review Feature Scope Unclear**
- **Location**: Lines 510-522 (AI-Powered Architecture Review)
- **Current Text**: Lists AI feedback categories but no context about when/how this review happens
- **Problem**: Unclear whether this is automatic, on-demand, or triggered by specific conditions
- **Impact**: Low - Feature is understandable but could be clearer about usage patterns
- **Suggested Fix**: Add context about review triggers and workflow integration

#### 8. **Export Format Support Assumptions**
- **Location**: Lines 538-562 (Export and Integration)
- **Current Text**: Shows various export formats (PDF, PNG, CSV, etc.) without context about requirements
- **Problem**: No mention of dependencies or setup required for different export formats
- **Impact**: Low - Users may assume all formats work out-of-box
- **Suggested Fix**: Note any dependencies or setup required for specific export formats

## Specific Examples

### Issue: Epic Template Mismatch
- **Location**: Lines 109-117 (Epic Templates table)
- **Current Text**: "`saas-feature` | SaaS product feature | User-facing features with auth, billing, etc."
- **Problem**: This describes what kind of feature is being built, not what kind of document format the epic uses. An epic template should define the structure and content of the planning document itself.
- **Impact**: High - Fundamentally misunderstands what an Epic is supposed to be
- **Suggested Fix**: "`comprehensive-prd` | Full PRD format | Complete product requirements with user stories, technical specs, success criteria"

### Issue: Command Syntax Contradiction
- **Location**: Lines 16 vs 67
- **Current Text**: Syntax shows `hyper plan [epic] [options]` but example shows `hyper plan create --name`
- **Problem**: The word "create" doesn't appear in the syntax as a valid first argument
- **Impact**: Users following examples will encounter command errors
- **Suggested Fix**: Update syntax to `hyper plan [create|<epic-name>] [options]` or change examples to match current syntax

### Issue: Epic Scope Confusion
- **Location**: Lines 124-142 (Epic Structure)
- **Current Text**: Epic contains "architecture/", "tasks/", "tests/", "docs/" directories
- **Problem**: These are implementation artifacts, not planning documents. An epic should contain planning materials that inform implementation, not the implementation itself.
- **Impact**: Users will be confused about when to use epics vs other tools
- **Suggested Fix**: Epic should contain only planning documents like PRD, technical-spec.md, requirements.md, with implementation artifacts generated by other commands

## Overall Assessment
- **Vision Quality Score**: 4/10 - The planning concept is valuable but suffers from fundamental conceptual confusion about what epics are and how they relate to implementation
- **User Impact**: High - The epic template mismatch and command syntax issues would cause immediate confusion and errors
- **Priority for Vision Fixes**: High - Core concepts need clarification before implementation

## Recommendations

### Immediate Priority
1. **Redesign Epic Templates**: Focus on document formats rather than feature types
2. **Fix Command Syntax**: Align examples with documented syntax or update syntax documentation
3. **Clarify Epic Scope**: Define clear boundaries between planning documents and implementation artifacts

### Secondary Priority
4. **Document Dashboard Integration**: Show how CLI and dashboard work together
5. **Rationalize Task Commands**: Clarify difference between task generation approaches
6. **Define Planning Hierarchy**: Explain relationship between epics, programs, and projects

### Long-term Improvements
7. **Add AI Review Context**: Explain when and how AI reviews are triggered
8. **Document Export Dependencies**: Note requirements for different export formats

The planning command has excellent intentions but needs fundamental conceptual clarity about the role of epics in the development workflow. The epic template issue is particularly critical as it affects the core understanding of what the tool does.