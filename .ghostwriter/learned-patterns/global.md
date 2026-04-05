# Global Learned Patterns

Universal patterns that apply to all writing. Updated by the ai-engineer during humanization rounds.

---

### [CRITICAL] Em-Dash Density: Hit the Target, Not the Ceiling

**Issue:** The Writer overcorrects on em-dashes in both directions. It can produce zero em-dashes (hard detection signal), or when instructed to include them, overshoot to 5.5/1k words — which is also a detection signal. A typical config prose target is 2.0/1k; a typical detector ai_threshold is 4.0/1k.

**Root cause:** Instructions emphasized "MUST include em-dashes" without enough emphasis on the upper limit. The Writer treated em-dashes as its go-to punctuation for every aside, pivot, and list introduction.

**Rule:** Aim for the config's prose target density (check `writing_style.prose.em_dash_density`). After drafting, do a quick mental count. If you find yourself reaching for an em-dash more than once every 2-3 paragraphs, use a semicolon, colon, or parentheses instead.

The replacement hierarchy:
- Semicolons for logical connections (30%)
- Parentheses for asides (25%)
- Colons for introductions (25%)
- Periods for hard stops (15%)
- Em-dashes for true interruptions only (5%)

**Ceiling rule:** If your em-dash count is already at or above the config target, stop. Use any other punctuation for the next aside.

**Floor rule:** If you have zero em-dashes after drafting, add them — but only where they are the natural choice (true interruption or sharp pivot), not everywhere at once.

---

### Avoid "In Summary" Closing Formulas

**Issue:** The structure detector specifically scans for closing formulas. Even one instance gets flagged.

**Detection:** Closing formulas including "in summary," "in conclusion," "to summarize," "to sum up" are universally flagged by structure detectors. While the structure tool weight is low (0.05), these are easily avoidable AI signals.

**Rule:** Avoid summary signpost phrases in all media types. Instead of "The distinction in summary:" use direct restatement without the meta-label. Alternative patterns:
- **Direct restatement:** Jump straight into the summary content without announcing it
- **Rhetorical framing:** "Here's what that means:" or "The breakdown:" or "Put simply:"
- **Thematic echo:** Reference a concept from earlier in the section as your summary anchor

---

### "Be" Verb Dominance (Critical)

**Issue:** Forms of "be" can account for 60-70% of auxiliary verb usage, inflating auxiliary verb density far above target (typically 3.0%). High auxiliary density is a significant syntactic tool signal.

**Rule:** When revising for auxiliary verb density, prioritize "be" forms above all others. Common patterns that inflate "be" count:

- **"X is Y" declaratives:** "The lock is real" / "Migration is necessary" → restructure with action verbs: "The lock holds" / "Migration matters"
- **"X isn't Y" negated copulas:** "This isn't abstract" / "Compliance isn't optional" → use stronger verbs: "The numbers prove the point" / "Compliance demands attention"
- **Contracted forms ('s, 're):** "That's the real damage" / "They're reasons to stay engaged" → rewrite: "The real damage lies in..." / "These gaps demand engagement"
- **Progressive tense:** "Customer trust is declining" → "Customer trust declines" / "is doing heavy lifting" → "does heavy lifting"
- **Passive voice with "be":** "is being drawn by attackers" → "attackers draw" / "can be encrypted" → "supports encryption"
- **Do-support negation:** "doesn't pretend" → "avoids pretending" / "doesn't exist yet" → "lacks cross-platform support"

**Priority:** Target "be" forms first since they typically represent 60-70% of auxiliary verb usage.

---

### Pronoun Chains in Direct-Address Sections

**Issue:** Pronoun density spikes in sections addressing the reader directly (advice, recommendations, calls to action) where "you/your" stacks with "it/this/that" references.

**Detection:** The pronoun tool flags critical groups. Heavy clusters like "You cannot migrate what you don't know you have" (4 pronouns in 9 words) are reliable AI signals.

**Rule:** In direct-address sections:
1. Replace 2nd-person address with role-specific nouns: "Decision makers should start with inventory" not "You should start with inventory"
2. Replace "it" and "this" with the specific noun they reference: "The migration requires planning" not "It requires planning"
3. Merge adjacent sentences that share pronoun referents into single compound sentences
4. Cap at 2 personal pronouns per sentence; rewrite any sentence exceeding this
