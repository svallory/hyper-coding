#!/bin/bash

# customize-setup.json
cat > /work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/advanced_customize-setup.json << 'JSON'
{
  "filepath": "advanced/customize-setup.mdx",
  "heuristics_score": 0.28,
  "classification": "likely_human",
  "human_confidence": 76,
  "evidence": {
    "human_signals": [
      "Direct casual language ('The coding tool wires up your dev environment')",
      "Conversational explanation ('so you're not doing it by hand')",
      "Simple, direct phrasing",
      "Questions that prompt reader thinking",
      "Contractions throughout"
    ],
    "ai_signals": [
      "Structured command sections",
      "Bullet-point lists (typical documentation)"
    ]
  },
  "notes": "Casual, friendly tone ('not doing it by hand', 'is the most useful command') indicates human author. Short, punchy sentences are characteristic of developer documentation written by developers, not AI templates."
}
JSON

# development.json
cat > /work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/development.json << 'JSON'
{
  "filepath": "development.mdx",
  "heuristics_score": 0.32,
  "classification": "likely_human",
  "human_confidence": 74,
  "evidence": {
    "human_signals": [
      "Contractions ('You'll', \"it's\")",
      "Casual verb forms ('get installed', 'run the following')",
      "Direct reader address",
      "Questions in content ('what changed')",
      "Personal reference to common pain point"
    ],
    "ai_signals": [
      "Step-by-step structure (could be either)",
      "Code blocks with language labels"
    ]
  },
  "notes": "Despite structured format, human voice evident in conversational transitions and direct reader engagement. Note reference to 'Curious about what changed' - natural human curiosity phrasing."
}
JSON

# security-guide.json
cat > /work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/security-guide.json << 'JSON'
{
  "filepath": "security-guide.mdx",
  "heuristics_score": 0.26,
  "classification": "likely_human",
  "human_confidence": 78,
  "evidence": {
    "human_signals": [
      "Opening casual statement: 'A few things worth knowing'",
      "Conversational tone throughout ('Not all template sources are equal')",
      "Personal security advice phrasing",
      "Contractions and colloquialisms",
      "Humorous ending: 'That's the gist. Most of this is just standard dev hygiene'"
    ],
    "ai_signals": [
      "Organized checklist structure",
      "Code config examples"
    ]
  },
  "notes": "Strong human voice, especially closing: 'That's the gist. Most of this is just standard dev hygiene applied to code generation.' This is distinctly human perspective and tone. Security advice written conversationally by someone with genuine experience."
}
JSON

# troubleshooting.json
cat > /work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/troubleshooting.json << 'JSON'
{
  "filepath": "troubleshooting.mdx",
  "heuristics_score": 0.38,
  "classification": "uncertain",
  "human_confidence": 60,
  "evidence": {
    "human_signals": [
      "Conversational opening: 'Something broke. Start here.'",
      "Direct casual language ('When you're stuck')",
      "Personal advice ('where you can't tell what')",
      "Contractions throughout"
    ],
    "ai_signals": [
      "Extremely comprehensive (1300+ lines)",
      "Highly structured accordion groups",
      "Extensive formatted code examples (50+)",
      "Very systematic error categorization",
      "Consistent template structure across sections",
      "Formulaic 'Symptoms', 'Diagnosis', 'Solutions' pattern"
    ]
  },
  "notes": "Mixed signals. Opening and conversational elements are human, but the sheer exhaustiveness, perfect systematization, and repetitive structure across 14+ accordion sections suggest possible AI assistance. Could be human-written and refined, but heavy AI involvement is plausible."
}
JSON

# installation.json
cat > /work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/get-started_installation.json << 'JSON'
{
  "filepath": "get-started/installation.mdx",
  "heuristics_score": 0.36,
  "classification": "uncertain",
  "human_confidence": 65,
  "evidence": {
    "human_signals": [
      "Conversational opening about no setup required",
      "Casual phrasing ('you're good to go')",
      "Direct reader address",
      "Contractions"
    ],
    "ai_signals": [
      "Highly structured with consistent sections",
      "Many code blocks (8+) with language labels",
      "Repetitive structure (Tab groups with identical format)",
      "Comprehensive coverage pattern",
      "Formulaic troubleshooting accordions"
    ]
  },
  "notes": "Borderline. While conversational elements exist, the extremely systematic structure, repetitive Tab patterns, and comprehensive formatting suggest possible AI generation or heavy AI-assisted refinement."
}
JSON

# quickstart.json
cat > /work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/get-started_quickstart.json << 'JSON'
{
  "filepath": "get-started/quickstart.mdx",
  "heuristics_score": 0.25,
  "classification": "likely_human",
  "human_confidence": 77,
  "evidence": {
    "human_signals": [
      "Casual, goal-oriented opening: 'Go from zero to a generated Next.js project in under 5 minutes'",
      "Natural conversational transitions ('This guide walks you through')",
      "Personal perspective on what's happening ('Hypergen will:')",
      "Excited tone with clear enthusiasm",
      "Contractions throughout"
    ],
    "ai_signals": [
      "Step structure (standard docs format)",
      "Table format"
    ]
  },
  "notes": "Human voice is clear and consistent. Opening is goal-focused and personal ('walk you through'), not templated. The 5-minute promise and casual explanations suggest human author with practical experience."
}
JSON

# tutorial.json
cat > /work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/get-started_tutorial.json << 'JSON'
{
  "filepath": "get-started/tutorial.mdx",
  "heuristics_score": 0.27,
  "classification": "likely_human",
  "human_confidence": 75,
  "evidence": {
    "human_signals": [
      "Personal, goal-oriented framing: 'From zero to your first custom template in about 30 minutes'",
      "Conversational transitions and asides",
      "Direct reader engagement ('Let's read the recipe')",
      "Natural teaching progression",
      "Contractions and casual phrasing",
      "Explanatory comments that clarify thinking"
    ],
    "ai_signals": [
      "Part-based structure",
      "Code examples with explanations"
    ]
  },
  "notes": "Strong human teaching voice. The progression 'Let's read', 'Now look at', 'Create a new directory', 'Run it again' shows natural tutoring flow. Author clearly understands the subject and explains it conversationally."
}
JSON

# hyper-vs-vibe.json
cat > /work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/hyper-coding_hyper-vs-vibe.json << 'JSON'
{
  "filepath": "hyper-coding/hyper-vs-vibe.mdx",
  "heuristics_score": 0.45,
  "classification": "uncertain",
  "human_confidence": 58,
  "evidence": {
    "human_signals": [
      "Strong opening opinion: 'Both approaches use AI to generate code. That's where the similarity ends.'",
      "Direct perspective: 'One treats AI output as a starting point you still have to own'",
      "Conversational framing of trade-offs",
      "Personal voice in risk assessment"
    ],
    "ai_signals": [
      "Multiple comparison tables with consistent formatting",
      "Very comprehensive coverage (200 lines)",
      "Repeated structured sections",
      "Long lists of examples (success stories, failures, etc.)",
      "Formulaic 'Expert Perspectives' section",
      "Decision framework with structured lists"
    ]
  },
  "notes": "Mixed signals. Opening and core argument are human, but the systematic comparison tables, extensive structured lists, and perfect categorization suggest AI generation or heavy refinement. The breadth of examples and structured presentation pattern is characteristic of AI work."
}
JSON

# introduction-to-hyper-coding.json
cat > /work/hyper/.ghostwriter/publications/hyperdev-docs/pipeline/audit/hyper-coding_introduction-to-hyper-coding.json << 'JSON'
{
  "filepath": "hyper-coding/introduction-to-hyper-coding.mdx",
  "heuristics_score": 0.41,
  "classification": "uncertain",
  "human_confidence": 62,
  "evidence": {
    "human_signals": [
      "Direct opinion opening: 'Hyper Coding is a process-driven approach'",
      "Clear statement of stakes: 'The AI generates; you stay responsible.'",
      "Practical perspective on problems"
    ],
    "ai_signals": [
      "Very systematic 5-principles framework",
      "Extensive bullet-point lists (30+)",
      "Perfect four-phase process structure",
      "Multiple formatted tables",
      "Repeated section pattern (numbered phases with subsections)",
      "Comprehensive metrics list",
      "Formulaic tool-to-methodology mapping"
    ]
  },
  "notes": "Borderline. While initial framing is human, the extreme systematization—five principles, four phases each with subsections, metrics sections, implementation guidelines—suggests either very disciplined human writing or AI generation. The perfect structural consistency leans toward AI involvement."
}
JSON

echo "All assessment files created."
