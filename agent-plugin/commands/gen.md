---
name: gen
description: Generate files from a project template — deterministic copy with placeholder substitution, agent authoring only inside marked prompt regions
argument-hint: "[template] [dest]"
---

# Gen

Hyper's *Deterministic First* principle: **if it can be done
deterministically, don't LLM it.** New files that follow a project pattern are
copied from a template, not written from imagination — the template is the
standard, and the agent authors only the regions the template explicitly opens.

This is the plugin-scale version of the methodology's `hyper gen`
([hyperdev.saulo.engineer](https://hyperdev.saulo.engineer)). There is **no
engine** — the command instructs the agent, and the `hyper-gen` skill holds
the rules. A real generator may replace this later; templates written for this
command should survive that by keeping the format below.

Read the **hyper-gen** skill before generating anything. Its rules are not
optional.

## Where templates live

Templates live at `<space>/templates/`, beside `worktrees/` at the space
root. The space root is local-only — templates there are never committed and
exist on exactly one disk; tell the user this the first time the dir is
created. `/hyper:adopt` recognises `templates/` as managed, not as a loose
entry to relocate.

## Template format

Each template is a directory:

```
templates/<name>/
├── template.md        manifest — frontmatter below, prose optional
└── …                  everything else is the tree to copy
```

`template.md` frontmatter:

```yaml
---
name: react-component
description: Feature component with test and barrel export
placeholders:
  name: Component name, PascalCase
  feature: Feature directory under src/features/
---
```

Every placeholder the tree uses **must** be listed with a one-line meaning.
Anything in `template.md` after the frontmatter is guidance for the agent
filling prompt regions.

Inside the tree:

- **`{{name}}` tokens** — substituted deterministically, in file contents and
  in file/directory names. Literal string replacement, nothing else.
- **Prompt regions** — a comment line whose content starts with `prompt:`, in
  the file's own comment syntax (`<!-- prompt: … -->`, `# prompt: …`,
  `// prompt: …`). The agent replaces that line with content satisfying the
  instruction. These are the **only** regions the agent may author.

Everything outside prompt regions is copied **byte-for-byte** after
placeholder substitution.

## Usage

```
/hyper:gen                          # list available templates
/hyper:gen react-component          # generate; dest asked or derived
/hyper:gen react-component src/features/billing
```

## Steps

1. **Locate the templates dir** at the space root. No arguments, or the
   dir is missing/empty → list what exists (each template's `name` and
   `description` from its `template.md`) and stop. Named template not found →
   list what exists and offer to create one — from an exemplar, per the skill,
   never from imagination.
2. **Read `template.md`.** The `placeholders` map is the complete set: collect
   a value for every entry — derive it when the argument or context makes it
   unambiguous, ask otherwise — and never substitute a token that is not
   listed.
3. **Copy the tree** to the destination, applying substitutions to contents
   and names. Refuse to overwrite existing files; report collisions and let
   the user decide.
4. **Fill each prompt region**, and nothing else, using the guidance in
   `template.md`.
5. **Verify verbatimness**: outside the filled prompt regions, the output must
   equal the template with placeholders substituted. Diff mentally or with
   `diff` — any other difference is a bug in the generation, fix it.
6. **Run the project's checks** (*Real-time Feedback*): if
   `.claude/hyper.json` has a `check`/`checks` config, run it against the
   generated files. A failure inside a prompt region is yours — fix your
   authored code. A failure in the verbatim part means the **template** is
   broken: report it to the user, do not patch the generated copy to hide it.

## Notes

- Generation is additive. This command never modifies or deletes files that
  already exist.
- If the check config is absent, say the generated code was not validated and
  point at `/hyper:tools`.
