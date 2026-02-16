# Structured Terminal Messages — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add structured message formatting utilities (error, warning, success, info, tip) to `@hypercli/core` that display git-style formatted messages with icon, title, summary, and body.

**Architecture:** A `ui/` module in core with a `formatMessage` internal function that all five public functions delegate to. Each message type has an accent color, icon, and auto-prefix. Functions return formatted strings (pure, no side effects).

**Tech Stack:** chalk 4.1.2 (already a core dependency), vitest for tests.

**Design doc:** `docs/plans/2026-02-16-structured-terminal-messages-design.md`

---

### Task 1: Create `symbols.ts`

**Files:**
- Create: `packages/core/src/ui/symbols.ts`

**Step 1: Create the symbols module**

```typescript
// packages/core/src/ui/symbols.ts

export const symbols = {
  error: "×",
  warning: "▲",
  success: "✔",
  info: "●",
  tip: "◆",
  bar: "│",
} as const;
```

**Step 2: Commit**

```bash
git add packages/core/src/ui/symbols.ts
git commit -m "feat(core): add unicode symbols for terminal messages"
```

---

### Task 2: Write failing tests for `messages.ts`

**Files:**
- Create: `packages/core/tests/ui/messages.test.ts`

**Step 1: Write the test file**

Tests should cover all overload forms and all five message types. Use `chalk.level = 0` to strip ANSI for assertions on structure, but also test with colors enabled to verify ANSI codes are present.

```typescript
// packages/core/tests/ui/messages.test.ts
import chalk from "chalk";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { error, warning, success, info, tip } from "../../src/ui/messages.js";
import { symbols } from "../../src/ui/symbols.js";

// Helper: strip ANSI codes for structural assertions
function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("messages", () => {
  describe("error", () => {
    it("renders summary-only (single arg)", () => {
      const result = strip(error("Something broke"));
      // Should have icon + summary, no title line
      expect(result).toContain(symbols.error);
      expect(result).toContain("Something broke");
      // Should NOT have a title line with "Error:" prefix
      expect(result).not.toMatch(/^.*Error:/m);
    });

    it("renders title + summary (two args)", () => {
      const result = strip(error("process::failed", "Git exited with code 128"));
      // Title line: "Error: process::failed"
      expect(result).toContain("Error: process::failed");
      // Icon + summary
      expect(result).toContain(symbols.error);
      expect(result).toContain("Git exited with code 128");
    });

    it("renders title + summary + string body (three args)", () => {
      const result = strip(error(
        "process::failed",
        "Git exited with code 128",
        "fatal: index file open failed"
      ));
      expect(result).toContain("Error: process::failed");
      expect(result).toContain(symbols.error);
      expect(result).toContain("Git exited with code 128");
      expect(result).toContain(symbols.bar);
      expect(result).toContain("fatal: index file open failed");
    });

    it("renders title + summary + array body", () => {
      const result = strip(error(
        "validation",
        "3 errors found",
        ["missing name", "bad type", "circular dep"]
      ));
      expect(result).toContain("Error: validation");
      expect(result).toContain("3 errors found");
      expect(result).toContain("missing name");
      expect(result).toContain("bad type");
      expect(result).toContain("circular dep");
    });

    it("applies red color to icon and bar", () => {
      // With colors enabled, check ANSI codes are present
      const result = error("test", "summary");
      // Should contain ANSI escape codes (not be plain text)
      expect(result).toMatch(/\x1b\[/);
    });
  });

  describe("warning", () => {
    it("renders summary-only", () => {
      const result = strip(warning("Config not found"));
      expect(result).toContain(symbols.warning);
      expect(result).toContain("Config not found");
    });

    it("renders title + summary", () => {
      const result = strip(warning("deprecated", "Use 'plugins' instead of 'helpers'"));
      expect(result).toContain("Warning: deprecated");
      expect(result).toContain("Use 'plugins' instead of 'helpers'");
    });
  });

  describe("success", () => {
    it("renders summary-only", () => {
      const result = strip(success("Generated 4 files"));
      expect(result).toContain(symbols.success);
      expect(result).toContain("Generated 4 files");
    });

    it("renders title + summary + body", () => {
      const result = strip(success("recipe complete", "Generated 4 files", "src/components/Button.tsx\nsrc/components/Card.tsx"));
      expect(result).toContain("Success: recipe complete");
      expect(result).toContain("Generated 4 files");
      expect(result).toContain("Button.tsx");
    });
  });

  describe("info", () => {
    it("renders summary-only", () => {
      const result = strip(info("Using kit nextjs v2.1.0"));
      expect(result).toContain(symbols.info);
      expect(result).toContain("Using kit nextjs v2.1.0");
    });
  });

  describe("tip", () => {
    it("renders summary-only", () => {
      const result = strip(tip("Add --parallel for faster generation"));
      expect(result).toContain(symbols.tip);
      expect(result).toContain("Add --parallel for faster generation");
    });
  });

  describe("structure", () => {
    it("icon sits directly above the vertical bar", () => {
      const result = strip(error("title", "summary", "body text"));
      const lines = result.split("\n");

      // Find the line with the icon
      const iconLine = lines.findIndex((l) => l.includes(symbols.error));
      // Find the first line with the bar
      const barLine = lines.findIndex((l) => l.includes(symbols.bar));

      expect(iconLine).toBeGreaterThan(-1);
      expect(barLine).toBeGreaterThan(iconLine);

      // Icon and bar should be at the same column
      const iconCol = lines[iconLine].indexOf(symbols.error);
      const barCol = lines[barLine].indexOf(symbols.bar);
      expect(iconCol).toBe(barCol);
    });

    it("title line appears before the icon line", () => {
      const result = strip(error("my-title", "summary", "body"));
      const lines = result.split("\n");

      const titleLine = lines.findIndex((l) => l.includes("Error: my-title"));
      const iconLine = lines.findIndex((l) => l.includes(symbols.error));

      expect(titleLine).toBeGreaterThan(-1);
      expect(titleLine).toBeLessThan(iconLine);
    });

    it("body lines are indented past the vertical bar", () => {
      const result = strip(error("t", "s", "body text here"));
      const lines = result.split("\n");

      const bodyLine = lines.find((l) => l.includes("body text here"));
      expect(bodyLine).toBeDefined();

      const barLine = lines.find((l) => l.includes(symbols.bar) && !l.includes("body"));
      if (barLine) {
        const barCol = barLine.indexOf(symbols.bar);
        const bodyCol = bodyLine!.indexOf("body text here");
        // Body text should start after the bar column
        expect(bodyCol).toBeGreaterThan(barCol);
      }
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /work/hyper && bun test packages/core/tests/ui/messages.test.ts`
Expected: FAIL — cannot find `../../src/ui/messages.js`

**Step 3: Commit**

```bash
git add packages/core/tests/ui/messages.test.ts
git commit -m "test(core): add failing tests for structured terminal messages"
```

---

### Task 3: Implement `messages.ts`

**Files:**
- Create: `packages/core/src/ui/messages.ts`

**Step 1: Implement the module**

```typescript
// packages/core/src/ui/messages.ts
import chalk from "chalk";
import { symbols } from "./symbols.js";

type MessageType = "error" | "warning" | "success" | "info" | "tip";

const config: Record<MessageType, { icon: string; prefix: string; color: chalk.Chalk }> = {
  error:   { icon: symbols.error,   prefix: "Error:",   color: chalk.red },
  warning: { icon: symbols.warning, prefix: "Warning:", color: chalk.yellow },
  success: { icon: symbols.success, prefix: "Success:", color: chalk.green },
  info:    { icon: symbols.info,    prefix: "Info:",    color: chalk.blue },
  tip:     { icon: symbols.tip,     prefix: "Tip:",     color: chalk.cyan },
};

const INDENT = "  ";
const ICON_GAP = "  ";

function formatMessage(
  type: MessageType,
  arg1: string,
  arg2?: string,
  arg3?: string | string[],
): string {
  const { icon, prefix, color } = config[type];

  let title: string | undefined;
  let summary: string;
  let body: string | string[] | undefined;

  if (arg2 === undefined) {
    // Single arg: summary only
    summary = arg1;
  } else if (arg3 === undefined) {
    // Two args: title + summary
    title = arg1;
    summary = arg2;
  } else {
    // Three args: title + summary + body
    title = arg1;
    summary = arg2;
    body = arg3;
  }

  const lines: string[] = [];

  // Title line: "  Error: process::failed"
  if (title !== undefined) {
    lines.push(`${INDENT}${color(prefix)} ${title}`);
    lines.push("");
  }

  // Icon line: "    ×  Process git failed"
  lines.push(`${INDENT}${INDENT}${color(icon)}${ICON_GAP}${summary}`);

  // Body section with vertical bar
  if (body !== undefined) {
    const bodyLines = Array.isArray(body) ? body : body.split("\n");

    // Empty bar line
    lines.push(`${INDENT}${INDENT}${color(symbols.bar)}`);

    for (const line of bodyLines) {
      lines.push(`${INDENT}${INDENT}${color(symbols.bar)}${ICON_GAP}${chalk.dim(line)}`);
    }
  }

  // Trailing blank line
  lines.push("");

  return lines.join("\n");
}

export function error(summary: string): string;
export function error(title: string, summary: string): string;
export function error(title: string, summary: string, body: string | string[]): string;
export function error(arg1: string, arg2?: string, arg3?: string | string[]): string {
  return formatMessage("error", arg1, arg2, arg3);
}

export function warning(summary: string): string;
export function warning(title: string, summary: string): string;
export function warning(title: string, summary: string, body: string | string[]): string;
export function warning(arg1: string, arg2?: string, arg3?: string | string[]): string {
  return formatMessage("warning", arg1, arg2, arg3);
}

export function success(summary: string): string;
export function success(title: string, summary: string): string;
export function success(title: string, summary: string, body: string | string[]): string;
export function success(arg1: string, arg2?: string, arg3?: string | string[]): string {
  return formatMessage("success", arg1, arg2, arg3);
}

export function info(summary: string): string;
export function info(title: string, summary: string): string;
export function info(title: string, summary: string, body: string | string[]): string;
export function info(arg1: string, arg2?: string, arg3?: string | string[]): string {
  return formatMessage("info", arg1, arg2, arg3);
}

export function tip(summary: string): string;
export function tip(title: string, summary: string): string;
export function tip(title: string, summary: string, body: string | string[]): string;
export function tip(arg1: string, arg2?: string, arg3?: string | string[]): string {
  return formatMessage("tip", arg1, arg2, arg3);
}
```

**Step 2: Run tests**

Run: `cd /work/hyper && bun test packages/core/tests/ui/messages.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add packages/core/src/ui/messages.ts
git commit -m "feat(core): implement structured terminal message formatters"
```

---

### Task 4: Create `ui/index.ts` and wire up exports

**Files:**
- Create: `packages/core/src/ui/index.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Create the barrel export**

```typescript
// packages/core/src/ui/index.ts
export { error, warning, success, info, tip } from "./messages.js";
export { symbols } from "./symbols.js";
```

**Step 2: Add export to core's index.ts**

Add this line after the logger exports in `packages/core/src/index.ts`:

```typescript
export * from "#/ui/index";
```

**Step 3: Build to verify it compiles**

Run: `cd /work/hyper/packages/core && bun run build`
Expected: Clean build, no errors.

**Step 4: Run all core tests to check nothing broke**

Run: `cd /work/hyper && bun test packages/core/tests/`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/core/src/ui/index.ts packages/core/src/index.ts
git commit -m "feat(core): export structured message utilities from @hypercli/core"
```

---

### Task 5: Manual visual verification

**Step 1: Create a quick visual test script**

```typescript
// packages/core/tests/ui/visual-check.ts
import { error, warning, success, info, tip } from "../../src/ui/messages.js";

console.log(error("Something broke"));
console.log(error("process::failed", "Git exited with code 128"));
console.log(error("process::failed", "Git exited with code 128", "fatal: .git/index: index file open failed: Not a directory"));
console.log(error("validation", "3 errors in recipe.yml", [
  "missing required field 'name'",
  "invalid step type 'foobar' at step 3",
  "circular dependency between steps 2 and 5",
]));
console.log(warning("deprecated config", "The 'helpers' field has been renamed to 'plugins'"));
console.log(success("recipe complete", "Generated 4 files", "src/components/Button.tsx\nsrc/components/Card.tsx"));
console.log(info("Kit discovered", "nextjs v2.1.0 at hyper-kits/nextjs"));
console.log(tip("Speed up generation", "Add --parallel flag to run steps concurrently"));
```

**Step 2: Run it**

Run: `cd /work/hyper && bun packages/core/tests/ui/visual-check.ts`
Expected: Beautiful structured messages with colored icons, bars, and proper indentation.

**Step 3: Review the output visually, tweak spacing/colors if needed. Delete the visual check script when done.**

```bash
rm packages/core/tests/ui/visual-check.ts
```
