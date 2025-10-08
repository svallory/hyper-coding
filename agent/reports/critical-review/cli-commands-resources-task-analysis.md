# Critical Review: cli/commands/resources/task.mdx

## Document Overview
- **File**: `/work/hyperdev/apps/docs/cli/commands/resources/task.mdx`
- **Purpose**: Define comprehensive task management system for individual development work items within the HyperDev vision
- **Target Audience**: Developers managing tactical development work, subtasks, and team coordination

## Critical Issues Found

### High Priority Issues

#### 1. **Command Action Inconsistency - Status vs Action Naming**
- **Location**: Actions table (lines 38-47) vs Status Management section (lines 135-150)
- **Current Text**: Actions table shows `complete`, but later sections use `done` command
- **Problem**: The actions table lists `complete` as an action, but the Status Management section shows `hyper task done AUTH-001` and the lifecycle shows the status as `done`, not `completed`
- **Impact**: HIGH - Users will try the wrong command based on the actions table
- **Suggested Fix**: Standardize on either `complete` (action) → `completed` (status) OR `done` (action) → `done` (status)

#### 2. **Missing Critical Action - Review Submission**
- **Location**: Actions table (lines 38-47) and Status Management (lines 135-150)  
- **Current Text**: No `review` action in actions table, but status flow shows `review` command usage
- **Problem**: Status lifecycle includes `in-progress → review` transition via `hyper task review AUTH-001` but `review` action is missing from the main actions table
- **Impact**: HIGH - Incomplete action reference that leaves gaps in the documented workflow
- **Suggested Fix**: Add `review` action to the actions table

#### 3. **Task ID Format Logic Contradiction**
- **Location**: Task Structure (line 157) vs Configuration (line 475)
- **Current Text**: Example shows "AUTH-001" but config shows 'PROJ-{number}' format
- **Problem**: Documentation uses domain-specific prefixes (AUTH-001) but configuration suggests generic project prefixes (PROJ-001)
- **Impact**: HIGH - Users won't understand how task IDs are actually formatted
- **Suggested Fix**: Align examples with configuration or explain the relationship between project domains and ID formats

#### 4. **Subtask ID Format Inconsistency**
- **Location**: Throughout subtask examples (lines 191-195, 211-236)
- **Current Text**: Uses both "AUTH-001.1" and "AUTH-001.2" format inconsistently  
- **Problem**: Sometimes subtask IDs are referenced as nested format, other times as separate entities
- **Impact**: HIGH - Confusion about how subtask addressing works in the system
- **Suggested Fix**: Establish clear subtask ID format and use consistently

### Medium Priority Issues

#### 5. **Time Tracking Command Overlap**
- **Location**: Time Tracking section (lines 271-302)
- **Current Text**: `hyper task start AUTH-001` used for both progress tracking and time tracking
- **Problem**: The `start` action is used for two different purposes - starting work and starting time tracking
- **Impact**: MEDIUM - Users may be confused about whether starting a task automatically starts time tracking
- **Suggested Fix**: Clarify the relationship between task progress and time tracking, or separate the commands

#### 6. **Dependency Management Syntax Inconsistency**
- **Location**: Dependency Management section (lines 240-254)
- **Current Text**: Uses both `hyper task depends AUTH-002 --on AUTH-001` and `--depends-on` option
- **Problem**: Two different syntaxes for managing dependencies without clear distinction
- **Impact**: MEDIUM - Users won't know which syntax to use when
- **Suggested Fix**: Choose one primary syntax and use consistently, or clearly differentiate when to use each

#### 7. **Template vs Subtask Creation Logic Gap**
- **Location**: Templates section (lines 341-377) and Subtask creation (lines 207-224)
- **Current Text**: Templates can create subtasks, but no clear relationship to manual subtask creation
- **Problem**: Unclear how template-generated subtasks relate to manually added subtasks
- **Impact**: MEDIUM - Confusion about subtask management workflows
- **Suggested Fix**: Clarify how template subtasks and manual subtasks integrate

#### 8. **Auto-Assignment Logic Ambiguity**
- **Location**: Team Coordination section (lines 390-394)
- **Current Text**: `hyper task assign AUTH-001 --auto` and `--distribute` options
- **Problem**: Unclear how auto-assignment algorithms work or what criteria they use
- **Impact**: MEDIUM - Users can't predict auto-assignment behavior
- **Suggested Fix**: Define auto-assignment criteria and load balancing logic

### Lower Priority Issues

#### 9. **Progress Percentage Inconsistency**
- **Location**: Task Progress Management (line 109) vs Subtask Progress (line 231)
- **Current Text**: Uses both explicit progress percentage and subtask-based progress calculation
- **Problem**: Unclear how manual progress percentages relate to subtask-based progress
- **Impact**: LOW - Minor confusion about progress calculation
- **Suggested Fix**: Clarify progress calculation precedence

#### 10. **Time Format Standardization**
- **Location**: Various time examples throughout
- **Current Text**: Uses "6h", "4h", "2h" format inconsistently
- **Problem**: Minor inconsistency in time format representation
- **Impact**: LOW - Stylistic inconsistency
- **Suggested Fix**: Standardize time format across all examples

## Specific Examples

### Issue: Command Action vs Status Naming Mismatch
- **Location**: Lines 46 and 143
- **Current Text**: 
  - Actions table: "`complete` | Mark task complete | `hyper task complete AUTH-001`"  
  - Status section: "`hyper task done AUTH-001`"
- **Problem**: Actions table promises `complete` command but examples use `done` command
- **Impact**: Users will try `hyper task complete` and get command not found errors
- **Suggested Fix**: Use consistent command names throughout - either all `complete` or all `done`

### Issue: Missing Review Action
- **Location**: Lines 38-47 vs 139
- **Current Text**: 
  - Actions table missing `review` action
  - Status section: "`hyper task review AUTH-001`"
- **Problem**: Key workflow action missing from primary reference table
- **Impact**: Users won't discover the review submission capability from the actions table
- **Suggested Fix**: Add `| review | Submit task for review | hyper task review AUTH-001 |` to actions table

### Issue: Task ID Format Logic Gap
- **Location**: Lines 157 vs 475
- **Current Text**:
  - Example: `id: "AUTH-001"`
  - Config: `id_format: 'PROJ-{number}'`
- **Problem**: Examples suggest domain-specific prefixes but config suggests generic project format
- **Impact**: Users won't understand if they can use domain prefixes like AUTH-, USER-, API- or must use PROJ-
- **Suggested Fix**: Either use PROJ-001 in examples or explain how domain prefixes map to projects

### Issue: Subtask Auto-Complete Logic
- **Location**: Lines 233-235
- **Current Text**: "Parent AUTH-001 automatically moves to review"
- **Problem**: Unclear if this happens when ALL subtasks are done or just the final one
- **Impact**: Users won't understand the trigger condition for auto-advancement
- **Suggested Fix**: Specify "when ALL subtasks are completed, parent automatically moves to review"

## Overall Assessment
- **Vision Quality Score**: 7/10 - Comprehensive task management vision with good feature coverage, but significant consistency issues that would confuse users
- **User Impact**: HIGH - Command inconsistencies and missing actions would prevent successful task completion
- **Priority for Vision Fixes**: HIGH - Core command reference must be consistent for users to succeed

## Recommendations

### Immediate Vision Fixes Required:
1. **Standardize command naming** - Choose either `complete` or `done` and use consistently
2. **Add missing actions** - Include `review` action in main actions table  
3. **Align ID format examples** - Make task ID examples match configuration patterns
4. **Clarify subtask ID addressing** - Define clear subtask reference format

### Design Improvements:
1. **Separate time vs progress tracking** - Clarify if they're the same operation or different
2. **Define auto-assignment criteria** - Specify how workload balancing works
3. **Standardize dependency syntax** - Choose primary syntax for dependency management
4. **Integrate template and manual workflows** - Show how template-generated and manual subtasks work together

### Workflow Completeness:
1. **Add error handling examples** - Show what happens when operations fail
2. **Define transition restrictions** - Clarify which status transitions are allowed when
3. **Specify integration behavior** - Detail how git commits, PRs, and notifications actually work

The task management vision is comprehensive but needs consistency fixes to be usable. The core concept is sound - tactical work item management with epic integration, team coordination, and progress tracking. However, command reference inconsistencies would cause immediate user frustration and prevent successful adoption of the envisioned system.