---
name: hyper-gen
description: Use when generating files from a project template — the rules for template-driven generation where everything outside marked prompt regions is copied verbatim. Triggers on "generate from template", "hyper gen", "scaffold a component", "create from the template", "new file like the others".
---

# Template-Driven Generation

The point of a template is that generated files are *identical* except where
they must differ. An agent writing "roughly the same" file from memory produces
drift: import order, comment style, a helper renamed. Templates make the
pattern deterministic; the agent's judgement is confined to the regions the
template opens.

Template location and format are defined in `/hyper:gen`: a directory under
`<space>/templates/`, containing a `template.md` manifest plus the tree to
copy.

## Rule 1 — verbatim outside prompt regions. Absolute.

Everything outside a prompt region is copied **byte-for-byte** after
placeholder substitution. Not "equivalent", not "improved" — identical.

The template IS the standard. If it uses `var`, four-space indent, or an
import style you dislike, the generated file gets it too. "Improving" output
during generation defeats the template's entire purpose: the next generation
won't match this one, and the pattern the team standardised on stops being a
pattern. If the template is wrong, say so and propose editing the *template* —
a separate change the user approves — never a silent fix in one generated copy.

This includes whitespace, comments, trailing newlines, and file names.

## Rule 2 — never invent placeholders

The `placeholders` map in `template.md` is the complete set.

- A `{{token}}` in the tree that is not listed → the template is broken.
  Report it; do not guess a value.
- Do not substitute strings the template did not mark. A hardcoded name in the
  template stays hardcoded, even when a placeholder value "obviously" belongs
  there.
- Do not add placeholders while filling values, and do not ask for values the
  manifest does not declare.

Placeholder substitution is literal string replacement — no casing transforms,
no pluralisation. If a template needs `{{name}}` in two casings, it declares
two placeholders.

## Rule 3 — prompt regions are the only authored code

A prompt region is a single comment line whose content starts with `prompt:`,
in the file's own comment syntax. Replace the comment line with content that
satisfies its instruction, informed by any prose in `template.md`. Match the
surrounding code's style exactly — the authored region should be
indistinguishable in style from the verbatim parts around it.

If a prompt instruction cannot be satisfied (needs information you don't have,
contradicts the surrounding code), ask — don't improvise around it.

## Rule 4 — missing template: build from an exemplar, not from imagination

When the template someone needs does not exist, offer to create it **from an
existing exemplar file in the repo** — the file the team already points at as
"do it like this one":

1. Ask which existing file(s) best represent the pattern. Do not pick one
   silently.
2. Copy the exemplar into a new template directory unchanged.
3. Replace only the instance-specific strings with `{{placeholders}}`, and only
   the genuinely per-instance regions with `prompt:` comments. When in doubt,
   leave it concrete — an over-templated file generates mush.
4. Write `template.md` listing every placeholder with a one-line meaning.
5. Have the user review the template before first use.

Running without a user to ask (autonomous or delegated run): pick the exemplar
yourself, but record the choice — note in `template.md` which file it was
built from and that the selection and template are unreviewed. The review in
steps 1 and 5 is deferred, not waived.

A template written from imagination encodes *your* pattern, not the team's —
exactly the drift templates exist to prevent.

## After generating

Verify, then validate:

- **Verbatim check**: outside filled prompt regions, output must equal the
  template with placeholders substituted. Any other diff is your bug.
- **Project checks**: run the `check`/`checks` config from
  `.claude/hyper.json` when present (see `/hyper:tools`). Failures in
  your authored regions are yours to fix; failures in verbatim regions mean
  the template is broken — report, don't patch the output.
