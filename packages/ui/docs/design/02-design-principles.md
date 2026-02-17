# CLI Design System — Design Principles

## Purpose

These principles are the non-negotiable rules that govern every decision in the CLI Design System. When two valid approaches conflict, these principles break the tie. When a new feature is proposed, these principles filter it. When a contributor asks "why was it done this way?", these principles answer.

There are seven. They are ordered by priority — when two principles conflict, the higher-ranked one wins.

---

## Principle 1: Degrade, Never Break

**The rule:** Every output the system produces must be meaningful in the worst terminal on the worst day. If the terminal doesn't support color, the output is still readable. If it doesn't support Unicode, the output is still correct. If stdout is piped to a file, the output is still useful.

**Why it matters:** CLI tools run everywhere — CI pipelines, Docker containers, SSH sessions over flaky connections, Windows Command Prompt, screen readers, `TERM=dumb` environments. A design system that produces beautiful output in iTerm2 but garbage in a CI log is not a design system. It's a decoration library.

**The degradation chain:**

```
Truecolor (24-bit)
  → 256-color
    → 16-color (ANSI)
      → Bold/dim only (no color)
        → Plain text (no ANSI at all)

Unicode symbols
  → ASCII fallbacks

Interactive prompts
  → Non-TTY error with flag suggestion

Animated progress
  → Static log lines
```

**Every feature must define its entire degradation chain.** There is no "unsupported" — only "degraded."

**Example:** A success message designed as `✓ Build complete` (green, bold) degrades through: green bold `✓ Build complete` → bold `[OK] Build complete` → plain `[OK] Build complete`. At every tier, the meaning is preserved.

---

## Principle 2: Accessible by Default

**The rule:** Accessibility is not a theme variant or an opt-in mode. It is the baseline. Every default must work for users who can't see color, can't see the screen at all, or need reduced motion.

**Why it matters:** Terminal users include people using screen readers, people with color vision deficiency, people running in high-contrast mode, and people whose "terminal" is a CI log viewed in a browser. Accessibility in CLIs is different from web — there's no ARIA, no alt text, no semantic HTML. The only tools are text, structure, and restraint.

**The rules in practice:**

- **Color is never the sole carrier of meaning.** Every color-coded element is also differentiated by symbol, label, or position. A red `✗` is also labeled `ERROR:`. A green `✓` is also labeled `Done`.
- **Symbols have text equivalents.** Screen readers see `[OK]`, `[FAIL]`, `[WARN]` — not Unicode glyphs that may be read as "heavy check mark" or ignored entirely.
- **Animation is suppressible.** Spinners and progress bars respond to `--no-animations` or `NO_COLOR`. When suppressed, they degrade to static log lines.
- **Blinking text is banned.** No exceptions. It is a seizure risk and a distraction.
- **Output structure is parseable.** Section headers, indentation, and consistent formatting help screen readers and automated tools navigate output.

**Example:** A test report uses color (green/red), symbols (✓/✗), AND text labels ("passed"/"failed"). A screen reader user gets `PASS: test_login (0.3s)`. A color-blind user sees the symbol difference. A NO_COLOR user sees `[PASS] test_login (0.3s)`. All three understand the result.

---

## Principle 3: Content Over Chrome

**The rule:** Every visual element must earn its pixels. If a border, color, icon, or decoration doesn't help the user understand the output faster, remove it.

**Why it matters:** Terminals are 80-120 columns wide. Every character of decoration is a character stolen from content. Web design systems can afford generous whitespace and decorative elements because screens are 1920px wide. Terminals cannot. The design system must be visually disciplined — always asking "does this element help the user, or does it just look nice?"

**The test:** Cover up the decorative element. Is the output harder to understand? If yes, keep it. If no, remove it.

**In practice:**

- **Tables default to minimal borders** (header separator only), not full grid. Full grid is available but not the default.
- **Messages lead with content**, not ceremony. `✗ File not found: config.yml` — not `═══ ERROR ═══\n\nFile not found: config.yml\n\n═════════════`.
- **Whitespace is used intentionally.** A blank line between sections is structure. Three blank lines is waste.
- **Box-drawing is reserved for containers** that group related content, not for decoration.
- **Color is used for differentiation**, not ornamentation. A status column uses color to let the eye quickly scan for failures. A heading doesn't need to be cyan just because it's a heading.

**Example:** Compare:

```
╔══════════════════════╗
║   BUILD SUCCEEDED    ║
╚══════════════════════╝
```

vs.

```
✓ Build succeeded (2.3s)
```

The second one is better. It communicates the same information in one line instead of three, leaves room for what comes next, and doesn't pretend the terminal is a GUI.

---

## Principle 4: Composable Over Monolithic

**The rule:** The system is built from small, single-purpose pieces that combine predictably. No component should assume it knows the full context it'll be used in.

**Why it matters:** Design systems fail when they try to anticipate every use case with monolithic, all-in-one components. A `<Table>` that handles its own pagination, filtering, sorting, and empty states is impossible to maintain and impossible to use when the developer wants just one of those features. The same applies here: a table component renders a table. Pagination is a separate concern that can be composed with a table — or with anything else.

**The composition model:**

```
Tokens → Primitives → Components → Recipes
         (atoms)       (molecules)   (organisms)
```

Each layer composes the layer below it. Each layer is usable independently. A developer who only needs styled text and a spinner never imports the table component. A developer who needs a custom layout can use primitives directly without going through components.

**In practice:**

- **Primitives are truly atomic.** A `StyledText` primitive handles text + ANSI styling. A `Symbol` primitive resolves a semantic name to a glyph. They don't know about each other.
- **Components compose primitives.** A `Message` component uses `Symbol` + `StyledText` + spacing rules. It doesn't reimplement any of those.
- **Recipes compose components.** A "deploy output" recipe uses `Spinner` + `StatusList` + `Message` + `KeyValue`. It documents the composition, not a new abstraction.
- **No implicit side effects.** A component that renders a table doesn't also print a newline after itself. The caller controls spacing.
- **Predictable output types.** Every component produces a string (or string array for multi-line). No component writes directly to stdout — the caller decides where to send it.

**Example:** A developer wants a status list with custom icons. They don't need to fork the status list component or pass an `iconOverrides` map. They compose `Symbol` (with their custom mapping) + `StyledText` + the layout logic from primitives. The system doesn't fight them.

---

## Principle 5: Predictable, Then Customizable

**The rule:** Every default must be sensible. Customization exists for the 20% who need it, but the 80% who use defaults should get professional, consistent output without configuring anything.

**Why it matters:** Design systems earn trust through consistency. If every consumer makes different choices about how errors look, the ecosystem fragments and the system provides no value. Strong defaults create a recognizable visual language across all tools that use the system — the way Material Design makes Android apps feel cohesive even across developers.

**The layers of customization:**

1. **Zero config** — Use the system with no options. Get professional output that works everywhere.
2. **Token overrides** — Change colors, symbols, or spacing by overriding tokens. The structure stays.
3. **Theme selection** — Switch between built-in themes (default, minimal, high-contrast, monochrome).
4. **Component options** — Configure individual components (table border style, message prefix format).
5. **Full composition** — Use primitives directly to build entirely custom output while still inheriting tokens.

Each layer is opt-in. Most users stop at layer 1 or 2.

**In practice:**

- **Error messages are red with `✗` by default.** A consumer doesn't need to configure this.
- **Tables use minimal borders by default.** A consumer can switch to grid borders with a single option.
- **Themes cascade.** A theme overrides tokens; components inherit the overridden tokens automatically. No per-component theming needed.
- **Opinions are documented.** Every default includes a rationale. If someone disagrees, they know what to override and why the default was chosen.

**Example:** `message({ level: 'error', text: 'Connection refused' })` produces `✗ Connection refused` in red, bold. No further configuration. But if a developer's brand uses `×` instead of `✗`, they override the `symbol.error` token once and every component picks it up.

---

## Principle 6: Terminal-Native

**The rule:** Design for the terminal as it actually is. Don't emulate the web. Don't pretend the terminal is a canvas. Work with its constraints — monospace fonts, line-oriented output, limited color — and make those constraints feel intentional.

**Why it matters:** The terminal is not a degraded browser. It's a different medium with its own strengths: instant rendering, perfect text alignment (monospace!), universal availability, scriptability, composability with pipes and redirects. A design system that fights the medium — trying to recreate web layouts with box-drawing characters — produces output that's worse than what the terminal does naturally.

**In practice:**

- **Monospace is an advantage.** Perfect column alignment is free. Use it for tables, key-value displays, and aligned output. Don't fight it with proportional-spacing hacks.
- **Lines are the unit of composition.** The terminal renders top-to-bottom, left-to-right. Design with this flow, not against it.
- **Pipes and redirects are first-class.** Output must work when piped through `grep`, `head`, `jq`, or `less`. This means: structured data on stdout, human decoration on stderr, and machine-readable output available via flags.
- **Whitespace is the primary layout tool.** Indentation, alignment, and blank lines — not borders and boxes — are the default way to organize content.
- **ANSI is the styling API.** Bold, dim, underline, color. That's the palette. Use it fully but don't invent abstractions that pretend it's CSS.

**Example:** Instead of:

```
┌─────────────────────────────────────────────┐
│  Name:     my-project                       │
│  Version:  2.1.0                            │
│  License:  MIT                              │
└─────────────────────────────────────────────┘
```

Do:

```
Name       my-project
Version    2.1.0
License    MIT
```

The second uses monospace alignment (the terminal's strength), wastes no columns on borders, pipes cleanly through `grep`, and conveys the same information.

---

## Principle 7: Opinionated With Escape Hatches

**The rule:** The system makes decisions so the developer doesn't have to — but it never traps them. Every opinion can be overridden. Every component can be replaced with a custom implementation that still uses the token layer.

**Why it matters:** Unopinionated systems are unusable. If a design system says "here are some colors, use them however you want," it's just a color palette — developers still have to make every decision themselves, and the ecosystem fragments. But over-opinionated systems are abandoned. If the system insists errors are always red and there's no override, the first team with a brand guideline that says "errors are orange" drops the system entirely.

**The balance:**

- **Strong opinions at the default layer.** Errors are red. Warnings are yellow. Tables have minimal borders. Indentation is 2 spaces. These are the defaults and they produce cohesive output.
- **Clean overrides at the token layer.** Change `color.error` to orange and every error in the system follows.
- **Composition at the primitive layer.** If the entire `Message` component doesn't work for someone, they can use the same tokens and primitives to build their own.
- **The system never breaks when overridden.** Override a color token, and contrast calculations still work. Override a symbol, and spacing still holds. Override a border style, and the box still closes properly.

**Example:** The system defaults to rounded box corners (`╭╮╰╯`). A developer building an enterprise tool wants sharp corners (`┌┐└┘`). They set `border.style: 'single'` in their theme and every box in their tool updates. They didn't fork anything, didn't monkey-patch anything, and can upgrade the design system without conflict.

---

## System Voice

The CLI Design System has a voice — it shows up in every message, error, and hint the system helps produce. Here's what that voice sounds like:

### Personality Traits

| Trait | What it means | What it doesn't mean |
|---|---|---|
| **Direct** | Lead with the important information. Say what happened, then why, then what to do. | Terse to the point of unhelpfulness. `Error.` is not a message. |
| **Calm** | Don't panic. An error is a problem to solve, not an emergency to escalate. No all-caps, no exclamation marks, no alarming red boxes around routine failures. | Emotionless. It's fine to say "Done!" on a success or "Hmm, that didn't work" on an error. |
| **Helpful** | When something goes wrong, suggest what to try next. When something succeeds, say what happened. When something is ambiguous, ask. | Patronizing. Don't explain what an error code is to someone who asked for `--verbose`. |
| **Honest** | If the tool doesn't know what went wrong, say so. "Something went wrong" is better than a misleading guess. | Confusingly vague. "Something went wrong" is acceptable; "An error occurred in the system" is not. |
| **Quiet by default** | Don't say things that don't need saying. Success is one line. Progress is one line. Errors get as many lines as they need. | Silent. The user should never wonder if the tool is working. |

### Voice in Practice

**Error message:**
```
✗ Could not connect to database at localhost:5432
  Connection refused — is PostgreSQL running?

  Try:
    pg_isready -h localhost -p 5432
```

Not:
```
ERROR!!! DATABASE CONNECTION FAILED!!!
An error occurred while attempting to establish a connection to the database server.
The connection was refused by the remote host.
Please check your database configuration and try again.
```

**Success message:**
```
✓ Deployed to production (2.3s)
  https://myapp.example.com
```

Not:
```
====================================
  DEPLOYMENT SUCCESSFUL!
  Your application has been deployed.
  URL: https://myapp.example.com
  Time: 2.3 seconds
====================================
```

**Progress:**
```
⠋ Installing dependencies...
```

Not:
```
[INFO] Now installing project dependencies, please wait...
```

### The Three-Line Test

Most CLI output should pass this test:

1. **Line 1:** What happened (with status icon and result)
2. **Line 2:** The key detail (URL, path, count, duration)
3. **Line 3:** What to do next (if anything)

If a message routinely needs more than three lines, it's either doing too much or explaining too much. Verbose detail belongs behind `--verbose`, not in the default output.

---

## Principles as a Decision Filter

When making any design decision, run it through this checklist:

1. **Does it degrade gracefully?** If not, redesign it until it does.
2. **Is it accessible without configuration?** If not, fix the defaults.
3. **Does every visual element earn its space?** If not, remove the decoration.
4. **Can it be used independently and composed with other pieces?** If not, break it up.
5. **Does it work well with zero configuration?** If not, pick better defaults.
6. **Does it work with the terminal, not against it?** If not, simplify it.
7. **Can the opinion be overridden cleanly?** If not, add an escape hatch.

If a proposed feature passes all seven, it belongs in the system. If it fails any, it needs rethinking.
