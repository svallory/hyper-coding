# Critical Review: cli/commands/resources/epic.mdx

## Document Overview
- **File**: `/work/hyperdev/apps/docs/cli/commands/resources/epic.mdx`
- **Purpose**: Define the CLI interface for epic management - creating, tracking, and organizing strategic feature development
- **Target Audience**: Development teams and project managers using HyperDev for strategic planning and epic-based development

## Critical Issues Found

### High Priority Issues

#### 1. **CRITICAL: Epic Template Parameter Logic Contradiction**
- **Location**: Lines 51, 82-84, 125-133
- **Current Text**: `--template saas-feature`, `--template api-service`, `--template ui-component`
- **Problem**: Templates describe FEATURE TYPES, not document formats. An epic is a document/container for requirements, but templates are defining what's being built instead of how the epic should be structured.
- **Impact**: Fundamental conceptual confusion about what epics are and what templates should control
- **Suggested Fix**: Templates should be document-oriented like `prd-format`, `technical-spec`, `user-story-format`, `requirements-template`

#### 2. **Workflow Inconsistency: Epic vs Task Relationship**
- **Location**: Lines 276-283
- **Current Text**: `hyper task create "Login API" --epic user-auth`
- **Problem**: The relationship direction is backwards - the epic command should manage tasks within an epic, not tasks referencing epics
- **Impact**: Creates confusion about the hierarchical relationship and ownership
- **Suggested Fix**: Epic commands should create/manage tasks: `hyper epic task add user-auth "Login API"`

### Medium Priority Issues

#### 3. **Template System Ambiguity**
- **Location**: Lines 125-133 (Built-in Templates section)
- **Problem**: Template descriptions mix project types with epic structures. "SaaS product feature" vs "Backend API service" are project contexts, not epic document formats
- **Impact**: Users won't understand when to use which template since they describe content rather than structure
- **Suggested Fix**: Clarify that templates define epic structure/format: `detailed-prd`, `lightweight-spec`, `technical-epic`, `user-focused-epic`

#### 4. **Milestone Command Inconsistency**
- **Location**: Line 107
- **Current Text**: `hyper epic milestone user-auth "Core Auth" --complete`
- **Problem**: Introduces milestone management syntax not defined in the actions table (Line 37-46)
- **Impact**: Users follow examples that reference undefined functionality
- **Suggested Fix**: Either add `milestone` to actions table or use `hyper epic update user-auth --milestone "Core Auth" --status completed`

#### 5. **Auto-generation Logic Mismatch**
- **Location**: Lines 401, 408 (Configuration section)
- **Current Text**: `auto_generate: ['tasks', 'tests']` and `auto_generate: ['openapi_spec', 'tests']`
- **Problem**: Epic templates auto-generating implementation artifacts (tests, API specs) conflates epic planning with implementation details
- **Impact**: Blurs the boundary between strategic planning (epics) and tactical implementation
- **Suggested Fix**: Auto-generate should focus on epic structure: `auto_generate: ['requirements_template', 'acceptance_criteria_template', 'task_breakdown_structure']`

### Lower Priority Issues

#### 6. **Terminology Inconsistency: Epic vs Feature**
- **Location**: Throughout document, especially lines 126-133
- **Problem**: Uses "feature" and "epic" interchangeably, but these are different concepts (epics contain features)
- **Impact**: Conceptual confusion about the scope and purpose of epics
- **Suggested Fix**: Consistent use of "epic" for strategic containers, clarify that epics may contain multiple features

#### 7. **Status Flow Presentation**
- **Location**: Lines 149-153
- **Problem**: ASCII diagram doesn't clearly show which states are valid transitions vs alternatives
- **Impact**: Users may not understand valid state transitions
- **Suggested Fix**: Use clearer notation or table format for state transitions

## Specific Examples

### Issue: Epic Template Purpose Confusion
- **Location**: Lines 125-133, template examples throughout
- **Current Text**: "saas-feature - SaaS product feature with user stories and acceptance criteria"
- **Problem**: This template name describes WHAT is being built (SaaS feature) rather than HOW the epic should be structured (document format). An epic about a SaaS feature should still use a standardized epic format, not a "SaaS-specific" epic format.
- **Impact**: Users will be confused about whether templates control epic structure or project domain, leading to inconsistent epic management
- **Suggested Fix**: Rename to format-focused templates: "detailed-requirements - Comprehensive epic with user stories, acceptance criteria, and technical specs"

### Issue: Command Hierarchy Logic Error  
- **Location**: Lines 276-283
- **Current Text**: `hyper task create "Login API" --epic user-auth`
- **Problem**: Tasks reference epics, implying tasks are managed independently and then linked to epics. This breaks the hierarchical containment model where epics should own and manage their tasks.
- **Impact**: Creates confusion about whether epics or tasks are the primary organizational unit
- **Suggested Fix**: Epic-centric task management: `hyper epic add-task user-auth "Login API"` or epic context switching: `hyper epic use user-auth && hyper task create "Login API"`

### Issue: Configuration Auto-generation Scope Creep
- **Location**: Lines 401, 408 in epic template configuration  
- **Current Text**: `auto_generate: ['openapi_spec', 'tests']`
- **Problem**: Epic templates generating implementation artifacts violates separation of concerns. Epics are strategic planning documents, not implementation generators.
- **Impact**: Tool becomes unfocused, trying to be both strategic planning and code generation, reducing clarity of purpose
- **Suggested Fix**: Limit auto-generation to epic structure: `auto_generate: ['requirements_outline', 'task_breakdown_template', 'acceptance_criteria_template']`

## Overall Assessment
- **Vision Quality Score**: 6/10 - Strong workflow concepts undermined by fundamental template logic errors and hierarchical inconsistencies
- **User Impact**: High - The template parameter confusion and task relationship issues will cause persistent user confusion
- **Priority for Vision Fixes**: High - Core conceptual issues need resolution before implementation

## Recommendations

### Critical Fixes Required
1. **Redesign Template System**: Templates should define epic document structure, not project domains. Use names like `comprehensive-prd`, `lightweight-spec`, `technical-architecture`, `user-story-epic`
2. **Fix Task Hierarchy**: Establish clear epic-owns-tasks relationship with consistent command patterns: `hyper epic task add/remove/list`
3. **Clarify Epic Purpose**: Epics are strategic planning documents that contain requirements, not project type categorizations

### Medium Priority Improvements  
1. **Standardize Command Patterns**: Ensure all epic sub-operations follow consistent syntax patterns
2. **Separate Planning from Implementation**: Keep epic templates focused on planning structure, not code generation
3. **Improve State Management Documentation**: Clear state transition rules and validation

### Low Priority Enhancements
1. **Terminology Consistency**: Use precise terms consistently throughout
2. **Example Quality**: Ensure all examples use defined command syntax
3. **Documentation Structure**: Improve information architecture for learning progression

The core vision of epic management is sound, but the template parameter logic needs fundamental revision to avoid persistent user confusion about the tool's purpose and proper usage patterns.