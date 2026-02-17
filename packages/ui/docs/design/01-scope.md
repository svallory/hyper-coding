# CLI Design System — Scope

## Purpose

This document defines what the CLI Design System is responsible for and what it is not. Every concern a CLI has is cataloged and assigned a verdict: **IN** (the DS owns it) or **OUT** (the DS does not).

The guiding question: *"Does this concern affect how a CLI looks, feels, or communicates with the user?"*

- **Yes → IN scope.** The DS provides tokens, primitives, components, or guidance.
- **No → OUT of scope.** It's structural, architectural, or application-level.

---

## CLI vs. TUI: A Critical Distinction

This is a design system for **command-line interfaces**, not **text-based user interfaces**. The difference matters:

- **CLI** — A program invoked from a shell that accepts arguments, does work, and produces output. Output flows linearly (top to bottom). Interaction is brief and scoped: a prompt, a confirmation, a progress bar. When it's done, it exits and returns you to the shell. Examples: `git`, `npm`, `curl`, `docker`, `eslint`.

- **TUI** — A program that takes over the terminal, renders a full-screen application with persistent layout regions (header, sidebar, content area, status bar), manages focus and navigation between widgets, and runs until the user explicitly quits. Examples: `vim`, `htop`, `lazygit`, `k9s`.

**This design system targets CLIs.** It covers the output formatting, feedback, and lightweight interaction that CLIs need. It does *not* cover full-screen application rendering, persistent layout management, widget focus systems, or any pattern that requires the alternate screen buffer as a primary interaction model.

Some CLI patterns borrow TUI techniques narrowly (e.g., a spinner uses cursor movement, a multi-progress display redraws a few lines). These are in scope because they're ephemeral — they happen during an operation and resolve to static output. What's out of scope is building an application that *lives* in the terminal.

---

## In Scope

### 1. Color and Styling

Everything about how color is applied to CLI output.

| Concern | Description |
|---|---|
| Semantic color roles | Named color tokens (`error`, `success`, `warning`, `info`, `muted`, `accent`, `emphasis`) — never raw color values |
| Color tier support | 8-color, 256-color, and 24-bit true color with automatic downgrading |
| Foreground vs. background | Rules for when to use each; contrast requirements between the two |
| Contrast and legibility | Minimum contrast expectations; handling terminals that remap ANSI colors |
| Color blindness accommodation | Never relying on hue alone — always pairing color with symbol, label, or position |
| `NO_COLOR` / `FORCE_COLOR` compliance | Stripping all color when `NO_COLOR` is set; forcing it when `FORCE_COLOR` is set |
| `TERM=dumb` handling | Disabling all ANSI styling when the terminal reports no capability |
| TTY/pipe detection | Stripping color and decoration when stdout is not a terminal |
| Bold-as-bright behavior | Acknowledging that in 16-color terminals, bold activates the bright color variant instead of font weight |
| Hyperlinks (OSC 8) | Clickable link support with fallback to plain URL display |

### 2. Typography

How text decoration conveys meaning.

| Concern | Description |
|---|---|
| Bold | Emphasis, headings, key terms |
| Dim / faint | Secondary information, metadata, de-emphasis |
| Italic | Supplementary emphasis (with caveat: support varies across terminals) |
| Underline | Links, emphasis; single and extended underline styles (curly, double) in modern terminals |
| Strikethrough | Deleted content, deprecation notices |
| Blinking text | **Never used.** Accessibility hazard. The DS explicitly bans it |
| Typographic hierarchy | Rules for how bold, dim, underline, and color combine to create heading levels, body, captions, and labels |
| Text truncation | Truncating long strings with ellipsis (`…`), accounting for ANSI escape sequences and wide characters |
| String width accounting | East Asian wide characters (2 columns), combining characters (0 columns), emoji (2 columns), ANSI escapes (0 visible columns) |

### 3. Spacing and Layout

How content is positioned and organized spatially.

| Concern | Description |
|---|---|
| Indentation units | Standard indentation increments for nesting depth |
| Vertical spacing rhythm | Blank lines between sections; consistent grouping rules |
| Horizontal padding | Left-padding from column 0; inner padding in boxes and cells |
| Column alignment | Left, right, center alignment within fixed-width columns |
| Terminal width adaptation | Detecting width, defaulting to 80, adapting layout accordingly |
| Max content width | Capping line length for readability even in wide terminals |
| Line wrapping vs. truncation | Rules for when content wraps and when it truncates |
| Grid / multi-column layout | Arranging items in multiple columns when space permits |
| Responsive layout | Switching display modes based on available terminal width (e.g., table → compact list) |

### 4. Symbols and Icons

The standardized glyph vocabulary.

| Concern | Description |
|---|---|
| Semantic symbol set | Standard symbols for success (`✓`), failure (`✗`), warning (`⚠`), info (`ℹ`), bullet (`•`), arrow (`→`), ellipsis (`…`), and more |
| ASCII fallback mapping | Every Unicode symbol has a pure ASCII equivalent (`✓` → `[OK]`, `✗` → `[FAIL]`, `•` → `*`, `→` → `->`) |
| Fallback detection | Using `LANG`, `LC_ALL`, encoding, or explicit flags to decide Unicode vs. ASCII |
| Symbol consistency | Same symbol always means the same thing — no reuse across semantics |
| Spinner character sets | Curated animation sequences (braille dots, pipe rotation, arc sweep) with ASCII fallbacks |
| Progress glyphs | Block characters for progress bars (`█`, `░`) and their ASCII equivalents (`#`, `-`) |
| Nerd Fonts / icon fonts | Treated as optional enhancement with plain-text fallback; never required |

### 5. Borders and Decoration

Box-drawing, dividers, and visual containers.

| Concern | Description |
|---|---|
| Box-drawing character sets | Single, double, heavy, rounded corner styles — with ASCII fallbacks (`+`, `-`, `|`) |
| Box styles | Named styles (e.g., `single`, `double`, `rounded`, `heavy`, `dashed`, `ascii`) |
| Panels / cards | Content wrapped in a border with optional title |
| Horizontal dividers | Full-width separator lines, optionally with a title embedded |
| Vertical separators | Column dividers in tables and side-by-side layouts |
| Padding inside borders | Standard inner padding to prevent text from touching borders |
| Nested boxes | Visual distinction between nesting levels |

### 6. Data Display

How structured data is presented.

**Tables:**
| Concern | Description |
|---|---|
| Column sizing | Auto-fit and constrained column widths |
| Column alignment by type | Strings left, numbers right, status centered |
| Border styles | None, minimal (header separator only), grid, outer-only |
| Header formatting | Bold, underlined, or color-differentiated |
| Row striping | Optional alternating row backgrounds |
| Cell overflow | Truncation with ellipsis vs. wrapping |
| Pagination | `Showing 1-20 of 847` pattern |
| Empty/null display | Consistent rendering for missing values (`-`, `N/A`, etc.) |

**Lists:**
| Concern | Description |
|---|---|
| Unordered lists | Consistent bullet characters and indentation |
| Ordered lists | Right-aligned numbering for multi-digit counts |
| Nested lists | Increasing indentation; optionally different bullets per depth |
| Compact vs. spacious | Dense (no gaps) vs. spacious (blank lines between items) |

**Trees:**
| Concern | Description |
|---|---|
| Tree rendering | Connecting lines (`├──`, `└──`, `│`) with ASCII fallback |
| Depth limiting | Truncating at configurable depth with hidden-node counts |

**Key-value pairs:**
| Concern | Description |
|---|---|
| Aligned output | Keys padded to consistent width; values at a fixed column |
| Nested structures | Indented sub-keys |
| Section grouping | Visual separation between related groups |

**Structured output:**
| Concern | Description |
|---|---|
| JSON mode | Machine-readable JSON via `--json` (no color, no decoration) |
| Pretty-printed JSON | Syntax-highlighted, indented JSON for human reading |
| Syntax highlighting | Language-specific coloring for code blocks in output |

### 7. Progress and Status

Communicating that work is happening and how it's going.

| Concern | Description |
|---|---|
| Spinners | Animated indicators for indeterminate work; disabled in non-TTY |
| Determinate progress bars | Horizontal fill bar with percentage and/or fraction |
| Indeterminate progress bars | Bouncing/sweeping animation when total is unknown |
| Multi-step indicators | `[1/5]`, `Step 2 of 5` numbered step display |
| Parallel progress | Multiple simultaneous progress bars for concurrent operations |
| ETA and throughput | Estimated time remaining, transfer rate |
| Status indicators (static) | Icons for completed-item states: success, failure, warning, skipped, pending |
| Status lines | In-place updating lines that finalize on completion |
| Log-during-progress | Printing log messages above active progress without disruption |
| Elapsed time display | Running clock for long operations |
| Completion summary | Final counts of success/failure/skipped after multi-step operations |

### 8. Messages and Feedback

How the CLI communicates outcomes and guidance to the user.

| Concern | Description |
|---|---|
| Error messages | Red, bold, `✗` prefix. What failed, why, and what the user can do next |
| Warning messages | Yellow/amber, `⚠` prefix. Advisory; does not halt execution |
| Success messages | Green, `✓` prefix. Brief confirmation |
| Info messages | Neutral color, `ℹ` prefix. General information |
| Debug messages | Only when `--verbose`/`--debug` is active. Timestamps, raw values |
| Hints / tips | Suggestions for follow-up actions. Visually subordinate (dim, indented) |
| Deprecation notices | Migration path included. Distinct from warnings |
| Fatal / crash messages | Last thing before exit. Includes bug-report instructions |
| Multi-error grouping | Summary header with indented individual errors, not repeated prefixes |
| Inline value styling | Distinct treatment for code, commands, paths, flags, and literal values within prose |

### 9. Interactive Prompts

Lightweight, sequential user input patterns. Each prompt is a single interaction point — the user answers and moves on. This is not a form system with simultaneous fields and focus management (that's TUI territory).

| Concern | Description |
|---|---|
| Text input | Single-line with cursor movement, deletion, placeholder |
| Password input | Masked characters; never echoed |
| Confirmation (yes/no) | Binary with default highlighted (`[Y/n]` or `[y/N]`) |
| Single-select list | Scrollable options, arrow key nav, Enter to confirm, optional filter |
| Multi-select list | Toggle per item (spacebar), Enter to confirm, check state display |
| Fuzzy search / autocomplete | Real-time filtering with match highlighting |
| Editor launch | Opening `$EDITOR` for multi-line input |
| Inline validation | Immediate error display below input as user types |
| Default values | Pre-filled or highlighted defaults accepted on Enter |
| Required vs. optional | Visual distinction and clear labeling |
| Prompt cancellation | Clean Ctrl-C handling; terminal state restored |
| Non-TTY fallback | Clear error directing user to use flags when stdin is piped |
| Terminal state restoration | Cursor visibility, echo mode, raw mode restored unconditionally |

### 10. Help and Documentation Display

How help text and documentation are formatted (not the content itself — the visual presentation).

| Concern | Description |
|---|---|
| Usage line format | `command [options] <required> [optional]` convention |
| Flag formatting | Short/long flag in left column, description in right column, aligned |
| Flag grouping | Organized by logical group, not one flat list |
| Default value display | Shown inline with each flag |
| Required flag marking | Visual indicator for required flags |
| Examples section | Real invocations with expected output |
| Version display | `--version` output format |
| Column formatting | Consistent alignment of flag names and descriptions |

### 11. Navigation and Structure

How output is organized into readable sections.

| Concern | Description |
|---|---|
| Section headers | Visually distinct heading lines (bold, underlined, colored) |
| Output grouping | Clustering related lines with blank lines, dividers, or indentation |
| Step numbering | `[1/4]` prefixes for multi-phase operations |
| Indented sub-output | Detail lines indented under their parent context |
| Breadcrumbs | Current step context display (`[setup > db > migration]`) |
| Mode / context indicator | Current environment, profile, or account display |

### 12. Animation and Motion

Terminal rendering techniques for dynamic CLI output. These are ephemeral — they happen during an operation and resolve to static output when done.

| Concern | Description |
|---|---|
| Cursor hiding/showing | During rendering; must be restored on exit/signal |
| In-place line updates | `\r` and ANSI cursor movement for overwriting a single line (spinners, status lines) |
| Line clearing | `\e[K` to prevent stale characters after an overwrite |
| Multi-line updates | Cursor-up-N and redraw for bounded regions (e.g., parallel progress bars) — not full-screen redraws |
| Reduced motion | `--no-animations` flag or env var to suppress all animation |
| Signal handling for cleanup | `SIGINT`/`SIGTERM` restore terminal state (cursor visibility, echo mode) before exit |

### 13. Responsive and Adaptive Behavior

Detecting and adapting to the runtime environment.

| Concern | Description |
|---|---|
| TTY detection | Per-stream (`stdout`, `stderr`, `stdin`) independently |
| Color depth detection | Via `$TERM`, `$COLORTERM`, `$TERM_PROGRAM` |
| Terminal size detection | Width and height via env vars or `ioctl` |
| Dumb terminal mode | Plain text only when `TERM=dumb` |
| CI environment detection | `CI=true`, `GITHUB_ACTIONS`, etc. — log-friendly output |
| Pager integration | Piping through `$PAGER` when output exceeds terminal height |
| Windows compatibility | Abstracting differences between Console Host, Windows Terminal, and WSL |
| Locale and encoding | Reading `LANG`/`LC_ALL` for Unicode safety |
| Multiplexer detection | `tmux`/`screen` — escape code differences |

### 14. Diff and Change Display

Showing what changed.

| Concern | Description |
|---|---|
| Line-level diff | Added (green `+`), removed (red `-`), context (dim) |
| Word-level diff | Highlighting only changed characters within a line |
| Hunk headers | `@@` range indicators, distinctly styled |
| Side-by-side diff | Two-column layout, degrading to unified in narrow terminals |
| Change summary | `+15 -3` counters with proportional bar |
| No-change state | Clear message when nothing differs |

### 15. Logging Display

How log output is visually formatted (not log infrastructure).

| Concern | Description |
|---|---|
| Level prefixes | Color-coded `[ERROR]`, `[WARN]`, `[INFO]`, `[DEBUG]` badges |
| Timestamp formatting | ISO 8601, relative, or elapsed — context-dependent |
| Log-to-stderr routing | Normal output to stdout; logs to stderr |
| Stack trace display | Indented, visually separated from the error message |
| Interleaving with progress | Log lines printed without destroying active progress bars |

### 16. Markdown / Rich Text Rendering

Rendering formatted text in the terminal.

| Concern | Description |
|---|---|
| Headings | Bold/underline/color differentiation by level |
| Inline formatting | `**bold**` → bold, `*italic*` → italic, `` `code` `` → distinct color |
| Code blocks | Syntax highlighting, border or background, language label |
| Blockquotes | Left-border character (`│`) with dimmed text |
| Horizontal rules | Full-width divider |
| Lists | Unordered and ordered, proper indentation |
| Tables | Pipe-delimited markdown → aligned terminal table |
| Links | OSC 8 when supported; `text (url)` fallback |
| Width-constrained wrapping | Reflowing prose to fit terminal width |

### 17. Sound / Bell

| Concern | Description |
|---|---|
| Terminal bell | `\a` for completion or error notification — **opt-in only, never default** |
| Bell spam prevention | Maximum one bell per event |

---

## Out of Scope

These are structural, architectural, or application-level concerns. The DS does not own them.

| Concern | Why it's out |
|---|---|
| **Argument parsing** | Parsing `argv`, defining flag types, required/optional args. This is application plumbing, not presentation |
| **Command routing** | Dispatching to subcommand handlers, command tree definition, alias resolution |
| **Shell completion generation** | Generating bash/zsh/fish/PowerShell completion scripts from schemas |
| **Configuration management** | Reading/writing config files, merging config layers, secret storage |
| **Process management** | Spawning child processes, PID management, signal forwarding, job control |
| **File I/O** | Reading, writing, watching, copying files and directories |
| **Networking** | HTTP requests, connection management, auth token handling, retries |
| **Data serialization / parsing** | Parsing JSON/YAML/TOML input, schema validation, data transformation |
| **Business logic** | Any domain-specific computation or decision-making |
| **Authentication / authorization** | Login flows, credential storage, token refresh. (Note: the *visual UX* of prompting for credentials is in scope; managing them is not) |
| **Logging infrastructure** | Log rotation, remote shipping, structured log schemas. (Note: the *visual display* of log lines is in scope) |
| **Testing infrastructure** | Test runners, assertion libraries. (Note: the DS's predictable output format *enables* snapshot testing, but the DS doesn't provide test tooling) |
| **Package management** | Installing, updating, or distributing the CLI tool itself |
| **Internationalization (i18n)** | String translation, locale-aware number/date formatting, RTL text. (Note: the DS defines formatting *tokens*; translation is an application concern) |
| **Plugin systems** | Dynamic loading of extensions or commands |
| **Database access** | Querying or mutating persistent data stores |
| **OS-level operations** | System calls, permission management, environment manipulation beyond reading |
| **Full-screen TUI rendering** | Alternate screen buffer, persistent layout regions (header/sidebar/content/footer), screen-level redraws, scrolling regions. This is application-level rendering, not CLI output |
| **Widget focus and navigation** | Focus indicators, Tab/Shift-Tab traversal between widgets, full-screen menu navigation. These are TUI framework concerns |
| **Persistent screen layout** | Fixed headers, scrollable bodies, status bars that persist across redraws. CLIs produce linear output, not managed screen regions |

---

## Boundary Decisions

Some concerns straddle the boundary. Here's where we drew the line and why.

### CLI techniques that borrow from TUI
**Narrow, ephemeral use is IN. Persistent full-screen use is OUT.** A spinner that hides the cursor and overwrites a line is a CLI concern — it's ephemeral and resolves to static output. A multi-progress display that redraws 5 lines is still CLI — it's bounded and temporary. A select prompt with a scrolling viewport of options is CLI — it's a single interaction that resolves to a selected value. But the moment you need the alternate screen buffer, a persistent layout, or a focus management system, you've crossed into TUI territory and that's out of scope. The test: *does it resolve to static output when the operation completes?* If yes, it's CLI. If no, it's TUI.

### Help text content vs. help text formatting
**Formatting is IN. Content generation is OUT.** The DS defines how help text looks (column alignment, flag grouping, section headers) but does not generate help text from argument definitions. That's the argument parser's job.

### JSON/machine output
**IN, narrowly.** The DS provides a JSON output mode because the decision to emit structured vs. human-readable output is a presentation concern. But the DS does not define JSON schemas or validate output structure.

### Terminal capability detection
**IN.** Detecting color depth, Unicode support, TTY status, and terminal dimensions is foundational to every other concern the DS owns. The DS must own this layer to make adaptive decisions.

### Interactive prompt behavior vs. interactive prompt state
**Behavior and appearance are IN. State management is OUT.** The DS defines what a select prompt looks like and how it responds to keystrokes. It does not manage form state, validation rules, or data flow between prompts.

### Pager integration
**IN.** Deciding when to page and how to invoke the pager is a presentation concern. The DS doesn't own the pager itself.

### Verbosity levels
**Partially IN.** The visual treatment of different verbosity levels (how `--verbose` output looks different from normal output) is in scope. The flag parsing and filtering logic is out.

### Credential prompts
**IN for appearance, OUT for security.** The DS owns the password-masked input primitive. It does not handle credential storage, encryption, or auth flows.

---

## Summary

The CLI Design System owns **everything the user sees and hears**. If it affects the visual presentation, communicative clarity, or interactive feel of a CLI, it's ours. If it's about what the CLI *does* rather than how it *presents*, it's not.

Seventeen concern areas are in scope. They span from low-level tokens (color, typography, symbols) through mid-level components (tables, progress bars, prompts) to high-level patterns (help display, diff rendering, markdown output). The system provides a complete vocabulary for building CLIs that look coherent, behave consistently, and degrade gracefully across terminal environments.
