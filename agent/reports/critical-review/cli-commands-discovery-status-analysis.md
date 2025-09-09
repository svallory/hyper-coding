# Critical Review: cli/commands/discovery/status.mdx

## Document Overview
- **File**: /apps/docs/cli/commands/discovery/status.mdx
- **Purpose**: Documents the `hyper status` command that provides comprehensive project health monitoring and status reporting
- **Target Audience**: Developers and project managers seeking project health insights and progress tracking

## Critical Issues Found

### High Priority Issues

#### 1. Fundamental Category Misalignment
- **Location**: Command placement in `/discovery/` directory
- **Problem**: Status monitoring is not a discovery function - it's a monitoring/reporting function
- **Impact**: High - Creates conceptual confusion about what discovery means vs. monitoring
- **Suggested Fix**: Move to `/cli/commands/monitoring/status.mdx` or `/cli/commands/reporting/status.mdx`

#### 2. Metric Calculation Logic Inconsistencies
- **Location**: Throughout status output examples
- **Current Text**: Various composite scores (e.g., "Overall Health: Excellent (9.2/10)")
- **Problem**: No explanation of how composite scores are calculated from individual metrics
- **Impact**: High - Users cannot understand or validate the scores they see
- **Suggested Fix**: Define clear scoring algorithms and weightings in documentation

#### 3. Real-time vs. Cached Data Contradiction
- **Location**: Lines 11 (claims "real-time insights") vs. 493-497 (cache configuration)
- **Current Text**: "real-time insights" but then shows 5-minute cache duration
- **Problem**: Logical contradiction between real-time claims and caching behavior
- **Impact**: High - Sets incorrect expectations about data freshness
- **Suggested Fix**: Clarify that status provides "near real-time" or "periodically refreshed" insights

### Medium Priority Issues

#### 4. Team Metrics Privacy Inconsistency
- **Location**: Lines 341-384 (detailed individual performance) vs. 518-521 (privacy settings)
- **Problem**: Shows detailed individual metrics by default but has privacy configuration suggesting this might be sensitive
- **Impact**: Medium - Could create workplace tension or privacy concerns
- **Suggested Fix**: Default to team-level aggregated metrics, require explicit opt-in for individual details

#### 5. Undefined Status Categories
- **Location**: Epic status examples (lines 278-301)
- **Current Text**: Shows "Health: Excellent (9.1/10)" for epics
- **Problem**: No definition of what constitutes epic "health" vs. progress
- **Impact**: Medium - Users won't understand what these scores represent
- **Suggested Fix**: Define distinct metrics for epic health (team capacity, blocker frequency, etc.)

#### 6. Inconsistent Threshold Logic
- **Location**: Lines 476-482 (threshold configuration) vs. status examples
- **Problem**: Shows thresholds in config but doesn't explain how they affect status reporting
- **Impact**: Medium - Users can't configure meaningful alerts
- **Suggested Fix**: Document how thresholds translate to status indicators and alerts

### Lower Priority Issues

#### 7. Command Option Redundancy
- **Location**: Lines 40-49 (options table)
- **Problem**: `--detailed` and individual category flags (`--quality`, `--security`) seem to overlap
- **Impact**: Low - Could cause confusion about which options to use together
- **Suggested Fix**: Clarify interaction between `--detailed` and category-specific flags

## Specific Examples

### Issue: Composite Score Calculation Mystery
- **Location**: Lines 98-103 (Overall Health calculation)
- **Current Text**: "📊 Overall Health: Excellent (9.2/10) ├── Code Quality: 8.7/10 ├── Security: 9.5/10 ├── Performance: 8.9/10 ├── Team Health: 9.1/10"
- **Problem**: Shows 9.2 overall but doesn't explain how it's calculated from the component scores
- **Impact**: Users cannot understand why their overall score is what it is
- **Suggested Fix**: Add formula explanation: "Overall Health = (Code Quality × 0.25 + Security × 0.25 + Performance × 0.25 + Team Health × 0.25)"

### Issue: Status vs. Progress Semantic Confusion
- **Location**: Lines 24, 44 (progress tracking) vs. overall command name
- **Current Text**: Command is "status" but heavily focuses on "progress" tracking
- **Problem**: Status typically implies current state, progress implies forward movement - these are different concepts
- **Impact**: Users expecting simple status checks get complex progress analytics
- **Suggested Fix**: Clarify that status includes both state and progress, or separate into distinct commands

### Issue: Team Performance Scoring Logic Gap
- **Location**: Lines 341-384 (individual performance metrics)
- **Current Text**: Shows velocity points and code quality scores for individuals
- **Problem**: No explanation of how individual velocity translates to performance assessment
- **Impact**: Could create unfair performance evaluation based on unclear metrics
- **Suggested Fix**: Define performance evaluation criteria that consider role differences and project context

## Overall Assessment
- **Vision Quality Score**: 6/10 - Comprehensive feature set but significant logical inconsistencies
- **User Impact**: High - Status reporting is critical functionality that needs clear, consistent metrics
- **Priority for Vision Fixes**: High - Core workflow tool that affects daily development experience

## Recommendations

### Immediate Fixes Required
1. **Relocate command** from discovery to monitoring/reporting category
2. **Define metric calculation formulas** for all composite scores
3. **Resolve real-time vs. cached data contradiction** with clear terminology
4. **Separate status from progress** concepts or clearly define their relationship

### Structural Improvements
1. **Create metric taxonomy** - Define what each score type measures and why it matters
2. **Add scoring transparency** - Show how individual metrics contribute to composites
3. **Implement privacy-first design** - Default to aggregated team metrics, individual metrics opt-in
4. **Define alert logic** - Explain how thresholds trigger notifications and actions

### Content Enhancements
1. **Add troubleshooting section** - What to do when scores are low or trending negative
2. **Include benchmark guidance** - Industry standards for quality, security, performance scores
3. **Document metric limitations** - When scores might be misleading or need human interpretation
4. **Add configuration examples** - Real-world threshold and alert configurations

The `hyper status` command represents a powerful vision for project health monitoring, but the current documentation needs significant clarification of its scoring logic, metric definitions, and conceptual boundaries to be truly useful for development teams.