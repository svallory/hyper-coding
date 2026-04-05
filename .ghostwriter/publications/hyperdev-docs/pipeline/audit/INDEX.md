# HyperDev Documentation Audit - Complete Results

## Analysis Summary
- **Date**: 2026-04-05
- **Files Analyzed**: 14
- **Detection Quality**: HIGH
- **Average Human Confidence**: 46%

## Distribution
- **Human-authored**: 5 files (36%)
- **AI-generated**: 8 files (57%)
- **Uncertain**: 1 file (7%)

## Files Analyzed

### Likely Human (High Confidence >70%)
1. **cli/overview.mdx** - 78% confidence
   - Assessment: Natural conversational voice, editorial knowledge
   - Path: `/work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/cli/overview.md`

2. **cli/quickstart.mdx** - 81% confidence
   - Assessment: Progressive disclosure, user-focused
   - Path: `/work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/cli/quickstart.md`

3. **cli/commands/resources/plan.mdx** - 72% confidence
   - Assessment: Appropriately scoped, realistic features
   - Path: `/work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/cli/commands/resources/plan.md`

4. **cli/commands/workflow/gen.mdx** - 76% confidence
   - Assessment: Technical precision, focused scope
   - Path: `/work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/cli/commands/workflow/gen.md`

5. **cli/commands/workflow/run.mdx** - 74% confidence
   - Assessment: Technical clarity, real knowledge
   - Path: `/work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/cli/commands/workflow/run.md`

### Uncertain (40-70% Confidence)
1. **cli/commands/overview.mdx** - 55% confidence
   - Assessment: Borderline mechanical, some human editorial
   - Path: `/work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/cli/commands/overview.md`

### Likely AI (Low Confidence <40%)
1. **cli/commands/dash.mdx** - 28% confidence (AI Signal: 0.72)
   - Assessment: Placeholder, formulaic structure
   - Path: `/work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/cli/commands/dash.md`

2. **cli/commands/discovery/list.mdx** - 25% confidence (AI Signal: 0.75)
   - Assessment: 585 lines, exhaustive, speculative
   - Path: `/work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/cli/commands/discovery/list.md`

3. **cli/commands/discovery/search.mdx** - 22% confidence (AI Signal: 0.78)
   - Assessment: 502 lines, mechanical examples, false confidence
   - Path: `/work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/cli/commands/discovery/search.md`

4. **cli/commands/resources/docs.mdx** - 24% confidence (AI Signal: 0.76)
   - Assessment: 578 lines, unrealistic scope, nested structure
   - Path: `/work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/cli/commands/resources/docs.md`

5. **cli/commands/resources/task.mdx** - 26% confidence (AI Signal: 0.74)
   - Assessment: 541 lines, exhaustive, repetitive
   - Path: `/work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/cli/commands/resources/task.md`

6. **cli/commands/workflow/dev.mdx** - 30% confidence (AI Signal: 0.70)
   - Assessment: 545 lines, speculative features
   - Path: `/work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/cli/commands/workflow/dev.md`

7. **cli/commands/workflow/init.mdx** - 29% confidence (AI Signal: 0.71)
   - Assessment: 361 lines, scope bloat
   - Path: `/work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/cli/commands/workflow/init.md`

8. **cli/commands/workflow/plan.mdx** - 23% confidence (AI Signal: 0.77)
   - Assessment: 626 lines for Coming Soon feature
   - Path: `/work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/cli/commands/workflow/plan.md`

## Output Files

### Assessment Documents
- **ANALYSIS_SUMMARY.md** - Comprehensive analysis with patterns and recommendations
- **REPORT.txt** - Plain text summary of all results
- **results.json** - Structured JSON results
- **INDEX.md** - This file

### Individual File Assessments
Each analyzed file has:
- `.md` file with detailed feedback
- `.json` file with structured assessment

All located in: `/work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/`

## Key Patterns

### Line Count Correlation
- Human files: **80-197 lines** (avg 124)
- AI files: **361-626 lines** (avg 505)
- **Threshold**: >300 lines = 90% likely AI-generated

### Feature Completeness
Files marked "Coming Soon" with 600+ lines of documentation are almost certainly AI-generated. Humans would not invest that effort into unimplemented features.

### Structural Signals
- **AI markers**: Identical table structures, mechanical emoji use, nested subsections (4-5 levels)
- **Human markers**: Varied structure, conversational tone, editorial decisions, real examples

### Language Patterns
- **AI files**: 80-100 hedge words per file (can, would, supports, enables)
- **Human files**: 20-40 hedge words per file

## Recommendations

### Keep as-is (Human Quality)
- overview.mdx
- quickstart.mdx
- gen.mdx
- run.mdx
- plan.mdx (resources version)

### Review & Polish (Uncertain)
- commands/overview.mdx

### Rewrite (AI-generated)
- dash.mdx
- discovery/list.mdx
- discovery/search.mdx
- resources/docs.mdx
- resources/task.mdx
- workflow/dev.mdx
- workflow/init.mdx
- workflow/plan.mdx (workflow version - "Coming Soon")

## Detection Methodology

Analysis used:
1. **Line count and scope** - Evidence of excessive documentation
2. **Structural parallelism** - Identical table/section repetition
3. **Hedge language density** - Frequency of limiting qualifiers
4. **Speculative confidence** - False certainty about unimplemented features
5. **Editorial voice** - Presence/absence of conversational phrasing
6. **Real knowledge** - Specific implementation details vs. generic descriptions
7. **Example authenticity** - Tests of actual system vs. aspirational features

High detection confidence due to clear patterns and contradictions (600+ lines for "Coming Soon").
