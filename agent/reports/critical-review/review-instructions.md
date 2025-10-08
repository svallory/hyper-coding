# Critical Documentation Review Instructions

## ⚠️ CRITICAL UNDERSTANDING: ASPIRATIONAL DOCUMENTATION

**THIS IS ASPIRATIONAL DOCUMENTATION** - We are reviewing documentation that defines how our tool **WILL BE**, not how it currently is. 

**DO NOT COMPARE TO CURRENT IMPLEMENTATION** - Ignore the current `hypergen` implementation completely. We are designing the perfect tool through documentation, then we'll implement it.

## Objective
Perform a comprehensive critical analysis of HyperDev **aspirational documentation** to identify conceptual inconsistencies, logical errors, confusing terminology, and anything that doesn't make sense from a **future user perspective** of the envisioned tool.

## Review Approach: IGNORE CURRENT IMPLEMENTATION

### What to IGNORE:
- Current `hypergen` CLI implementation
- What commands currently exist or don't exist  
- Current package names or installation methods
- Any existing source code or actual behavior
- Whether features are "implemented" or not

### What to FOCUS ON:
- **Internal consistency** within the documented vision
- **Logical coherence** of the documented tool design
- **User experience** of the envisioned tool
- **Conceptual clarity** of the future vision
- **Workflow completeness** within the documented system

## Review Process

### 1. Document Analysis Framework
Each reviewer should analyze their assigned documentation file using these critical thinking dimensions:

#### A. Conceptual Consistency Within the Vision
- **Terminology Usage**: Are terms used consistently throughout the documentation vision?
- **Concept Alignment**: Do concepts align logically within the documented system design?
- **Mental Model Accuracy**: Does the explanation match how users would naturally think about the envisioned feature?
- **Domain Logic**: Does the explanation make sense within the software development domain?

#### B. Logical Flow and Structure of the Vision
- **Information Architecture**: Is information organized in a logical learning sequence for the envisioned tool?
- **Prerequisites**: Are prerequisites clearly stated and logical within the documented system?
- **Dependencies**: Are feature dependencies accurately represented within the vision?
- **Progression**: Does complexity build appropriately from basic to advanced within the documented workflows?

#### C. User Experience Perspective of Envisioned Tool
- **Clarity**: Would a new user understand this explanation of the future tool?
- **Completeness**: Are there gaps that would leave users confused about the envisioned workflows?
- **Practical Utility**: Do examples and instructions help users accomplish tasks in the documented system?
- **Error Prevention**: Does the documentation help users avoid common mistakes in the envisioned tool?

#### D. Internal Vision Consistency
- **System Coherence**: Do all documented components work together logically?
- **Parameter Logic**: Are parameters and options logically designed for their stated purpose?
- **Workflow Completeness**: Can users complete end-to-end workflows within the documented system?
- **Error Handling**: Is error handling logically designed within the vision?

### 2. Specific Issues to Flag

#### High Priority Issues:
1. **Conceptual Mismatches**: Where documentation concepts don't align with their stated purpose (like Epic template parameters describing features instead of document formats)
2. **Logical Contradictions**: Statements that contradict each other within the documented vision
3. **Vision Inconsistencies**: Documented behavior that contradicts other parts of the envisioned system
4. **Misleading Examples**: Examples that would lead users to incorrect understanding of the intended tool

#### Medium Priority Issues:
1. **Terminology Inconsistencies**: Same concepts described with different terms within the vision
2. **Unclear Prerequisites**: Missing or unclear prerequisites within the documented workflows
3. **Incomplete Workflows**: Partial explanations that leave users stranded in the envisioned system
4. **Naming Confusion**: Inconsistent naming that would confuse users of the future tool

#### Lower Priority Issues:
1. **Stylistic Inconsistencies**: Formatting or presentation inconsistencies
2. **Minor Clarity Issues**: Small areas where wording could be clearer
3. **Optimization Opportunities**: Areas where explanations of the vision could be more efficient

### 3. Analysis Report Format

For each assigned file, create a report using this structure:

```markdown
# Critical Review: [filename]

## Document Overview
- **File**: [relative path]
- **Purpose**: [what this document envisions accomplishing]
- **Target Audience**: [who should use this envisioned feature]

## Critical Issues Found

### High Priority Issues
[List conceptual mismatches, logical contradictions within the vision]

### Medium Priority Issues  
[List terminology issues, unclear prerequisites, incomplete workflows within the documented system]

### Lower Priority Issues
[List stylistic issues and optimization opportunities]

## Specific Examples

### Issue: [Issue Title]
- **Location**: [section/line reference]
- **Current Text**: "[quote problematic text]"
- **Problem**: [explain why this is problematic for the envisioned tool]
- **Impact**: [how this affects users of the future system]
- **Suggested Fix**: [proposed improvement to the vision]

## Overall Assessment
- **Vision Quality Score**: [1-10, with reasoning about the documented vision]
- **User Impact**: [High/Medium/Low - how much this affects user success in the envisioned system]
- **Priority for Vision Fixes**: [High/Medium/Low - how urgently the vision needs fixing]

## Recommendations
[Specific actionable recommendations for improving the documented vision]
```

### 4. Example Issue Analysis (CORRECTED)

**Example**: Epic Template Parameter Issue
- **Problem**: The `epic` subcommand accepts template values like "saas-feature", "api-service" which describe feature types, not document formats
- **Conceptual Mismatch**: An Epic is a formal document describing an endeavor (usually a PRD). The template should define the document format, not the feature being described
- **User Impact**: High - this causes fundamental confusion about what Epics are and how they work in the envisioned system
- **Fix**: Template parameters should be document-oriented (e.g., "prd-format", "technical-spec", "user-story-format")

**This is a valid issue because it's about the LOGIC of the documented vision, not whether it's implemented**

### 5. Critical Thinking Questions

While reviewing, constantly ask:
1. **Does this envisioned feature make sense?** - Would the documented tool work logically?
2. **Is the vision internally consistent?** - Do all parts of the documented system work together?
3. **Is the workflow complete?** - Would following these instructions lead to success in the envisioned system?
4. **Is the vision coherent?** - Does this align with other parts of the documented vision?
5. **Would I be confused by the envisioned tool?** - As a user of the future system, would this leave me uncertain?

### 6. Deliverables

Each reviewer must:
1. **Create analysis report** - Save as `/work/hyperdev/agent/reports/critical-review/[filename]-analysis.md`
2. **Update progress tracker** - Mark file as completed in progress tracking file
3. **Flag vision issues** - Immediately highlight any critical problems that affect the coherence of the envisioned system

### 7. Quality Standards

- **Be brutally honest** - Don't be polite about problems in the vision
- **Think like a future user** - Approach from perspective of someone using the envisioned tool
- **Question assumptions** - Challenge whether the documented vision actually makes sense
- **Test workflows mentally** - Walk through envisioned workflows to find gaps
- **Consider edge cases** - Think about where users might get stuck in the documented system

## Success Criteria

A successful review identifies:
- All conceptual inconsistencies within the envisioned system
- Vision inaccuracies that would cause user confusion in the future tool
- Logical gaps that would leave users stranded in the documented workflows
- Terminology problems that create confusion about the envisioned system
- Practical issues that prevent task completion in the documented vision

## KEY REMINDER

**WE ARE REVIEWING THE VISION, NOT THE IMPLEMENTATION**

The goal is to perfect the documented vision of HyperDev so that when we implement it, users can confidently accomplish their goals without confusion or frustration.

Focus on:
- Does the documented vision make sense?
- Are the envisioned workflows logical?
- Would the documented tool be useful and coherent?
- Are there conceptual problems in the design itself?

**DO NOT** worry about whether it exists yet - that's irrelevant to this review process.