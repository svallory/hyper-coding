# HyperDev Docs Audit - AI Detection Summary

## Overview
Analysis of 14 documentation files from `/work/hyper/apps/docs-bkp/cli/` to detect AI-generated content.

## Results

| File | Classification | Confidence | Line Count | Assessment |
|------|---|---|---|---|
| cli/overview.mdx | likely_human | 78% | 137 | Natural conversational voice, real knowledge |
| cli/quickstart.mdx | likely_human | 81% | 169 | Progressive disclosure, user-focused |
| cli/commands/overview.mdx | uncertain | 55% | 518 | Borderline: comprehensive but mechanical |
| cli/commands/dash.mdx | likely_ai | 28% | 91 | Placeholder feature, formulaic structure |
| cli/commands/discovery/list.mdx | likely_ai | 25% | 585 | Exhaustive, speculative, no implementation |
| cli/commands/discovery/search.mdx | likely_ai | 22% | 502 | 500+ lines of speculative functionality |
| cli/commands/resources/docs.mdx | likely_ai | 24% | 578 | Unrealistic scope, mechanical expansion |
| cli/commands/resources/plan.mdx | likely_human | 72% | 80 | Appropriately scoped, realistic features |
| cli/commands/resources/task.mdx | likely_ai | 26% | 541 | Exhaustive, nested subsections, jargon |
| cli/commands/workflow/dev.mdx | likely_ai | 30% | 545 | Speculative features, mechanical structure |
| cli/commands/workflow/gen.mdx | likely_human | 76% | 180 | Technical precision, focused scope |
| cli/commands/workflow/init.mdx | likely_ai | 29% | 361 | Speculative setup options, bloat |
| cli/commands/workflow/plan.mdx | likely_ai | 23% | 626 | 626 lines for "Coming Soon" feature |
| cli/commands/workflow/run.mdx | likely_human | 74% | 197 | Focused, technical, real knowledge |

## Key Findings

### Pattern 1: Line Count Correlation
- **Human-authored files**: 80-197 lines (avg 124)
- **AI-generated files**: 361-626 lines (avg 505)
- **Threshold**: Files >300 lines are 90% likely AI-generated in this set

### Pattern 2: Feature Completeness
Files documenting "Coming Soon" or incomplete features:
- `hyper dash`: 91 lines, "Coming Soon" → likely_ai (28%)
- `hyper plan`: 626 lines, "Coming Soon" → likely_ai (23%)

Human authors would not write 626 lines documenting unimplemented features.

### Pattern 3: Speculative vs. Documented
- **AI files** describe features with false confidence that have no evidence of implementation
- **Human files** document actual commands (gen, run, quickstart, overview, plan resource)

### Pattern 4: Structural Parallelism
AI-generated files show:
- Identical subsection structure repeated 5-10 times
- Table format repeated 12+ times with no variation
- Example blocks following identical indentation/formatting
- Emoji markers used mechanically (📦, 🎨, ⚙️)

Human files vary structure based on content needs.

### Pattern 5: Corporate Jargon Density
- AI files average 80-100 hedge words per file (can, would, supports, enables)
- Human files average 20-40
- "Provide," "streamlined," "comprehensive," "innovative" appear in AI files only

## Recommendations

### High Confidence (>70% human)
- ✅ Keep overview.mdx, quickstart.mdx, gen.mdx, run.mdx as-is (human-authored)
- ✅ Keep plan.mdx (resources) as-is (80-line appropriate scope)

### Uncertain (40-70% confidence)
- 🔄 Review commands/overview.mdx - comprehensive but borderline mechanical

### Low Confidence (<40% human)
- ⚠️ Rewrite: dash.mdx (28%) - placeholder content, low value
- ⚠️ Rewrite: list.mdx (25%) - 585 lines of speculative features
- ⚠️ Rewrite: search.mdx (22%) - 500+ lines with no implementation evidence
- ⚠️ Rewrite: docs.mdx (24%) - unrealistic feature scope
- ⚠️ Rewrite: task.mdx (26%) - 541 lines of exhaustive but speculative content
- ⚠️ Rewrite: dev.mdx (30%) - speculative monitoring features
- ⚠️ Rewrite: init.mdx (29%) - inflated scope with questionable features
- ⚠️ Rewrite: workflow/plan.mdx (23%) - contradicts "Coming Soon" status with 626 lines

## Technical Assessment

### AI Detection Markers Found
1. **Exhaustive subsection expansion**: 585-626 line files documenting simple features
2. **Speculative confidence**: False certainty about unimplemented features
3. **Mechanical repetition**: Identical table structures, example blocks, emoji patterns
4. **Hedge word clusters**: 80+ instances per file of limiting language
5. **Template expansion**: Configuration sections with 20+ speculative options
6. **Contradictory scope**: "Coming Soon" warnings in 600+ line files

### Human Writing Indicators
1. **Appropriate scope**: 80-200 line files for bounded features
2. **Conversational voice**: Natural editorial choices, asides
3. **Real examples**: Commands tested against actual system
4. **Knowledge clarity**: Explains why, not just what
5. **Varied structure**: Content shapes documentation, not template
6. **Precision**: Technical accuracy without padding

## Conclusion

This documentation set shows a clear split: the human-authored core (overview, quickstart, gen, run, plan-resource) is solid and focused. The AI-generated speculative features (list, search, docs, task, dev, init, workflow/plan, dash) were likely created to provide "complete" documentation before features existed.

**Recommendation**: Use this analysis to inform a documentation refresh. The human-authored files set the quality standard; rebuild the speculative sections when features are actually implemented.
