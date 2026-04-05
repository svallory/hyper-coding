**Classification:** likely_human
**Human Confidence:** 76%

## Assessment

This file shows human authorship. It's appropriately scoped at 180 lines for documenting a real, existing command. The language is precise and technical without corporate padding. The structure focuses on what's actually important (recipe resolution, variable passing, AI 2-pass generation) rather than exhaustively enumerating every possibility. Editorial choices like explaining "greedy matching" upfront show real knowledge communication rather than template expansion.

## Evidence

### Strong Signals
- **Proportionate length**: 180 lines for an actual command (vs. 500+ for speculative ones)
- **Technical precision**: "greedy matching," "coerce values," "non-TTY" used accurately without over-explanation
- **Real examples**: Command examples show actual usage patterns, not speculative features
- **Editor's knowledge**: Explanation of recipe resolution order (lines 61-67) shows genuine understanding
- **Natural phrasing**: "Any remaining tokens are mapped to positional variables" reads like someone explaining their own system

### Moderate Signals
- **Focused scope**: Covers actual command behavior, AI 2-pass generation, ask modes - bounded set
- **Table efficiency**: Two focused tables (Arguments, Flags) rather than exhaustive option enumeration
- **Variable passing explanation**: Lines 42-56 naturally explain the feature without over-detailing

### Weak/Contextual
- **Minimal examples**: 7 examples is appropriately limited for documentation
- **No speculative features**: Only documents what's actually implemented
- **Some corporate phrasing**: "support," "flexibility," but balanced with technical content
