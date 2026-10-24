Read this when the harness config is missing, the user asks to reconfigure, a dev launch needs a harness's `env:` block resolved (Dev environment), or you must translate between roles and harnesses (Known harnesses and models).

## Harness setup

Run when the harness config is missing or the user asks to reconfigure. The goal: a saved list of the coding-agent CLIs the user wants on this team, how to launch each, and which roles each fills.

1. **Detect installed harnesses.** Some CLIs are only on the interactive shell's PATH, so check through a login shell:
   ```bash
   for t in claude codex agy gemini kimi klaude pi opencode aider crush cursor-agent amp goose qwen droid copilot; do
     p=$("${SHELL:-zsh}" -ic "command -v $t" 2>/dev/null | tail -1); [ -n "$p" ] && echo "$t $p"
   done
   ```
2. **Ask which to use.** One multi-select question per group of at most four detected harnesses (the question tool caps options at four; use up to four questions). Label each option with the harness and one line on what it is good for, from [Known harnesses and models](#known-harnesses-and-models). Tell the user they can type any harness that was not detected in "Other" (a wrapper script, a remote runner, a CLI installed somewhere unusual) with its launch command.
3. **Fill each chosen harness.** From the known-harness table plus the harness's own `--help` or model list: launch command (non-interactive and interactive), optional `bin:` (the actual executable, required when `launch:` starts with `env` or an assignment), Herdr `--kind` if it has one, the models the user's plan gives access to, quota notes, and the `env:` block (see [Dev environment](#dev-environment)): `inherit:` starts from the "Env to inherit" column of the table, so a dev runs under the same account and config directory as the lead; add `defaults:` or `set:` only when the user asks for them. For a multi-provider harness, list what it can actually run instead of guessing: `pi --list-models` shows only providers that have credentials configured, so a paid model whose provider isn't set up won't appear. Ask only what you cannot find out (for example which models their subscription includes). Then check what the chosen harnesses need for *Agent messaging* in SKILL.md: for pi, the `pi-claude-link` extension (`pi list | grep -q pi-claude-link`). If it is missing, ask the user before installing (`pi install git:github.com/alonw0/pi-claude-link`); if they decline, record `messaging: herdr` for pi in the config so pi devs use Herdr.
4. **Propose routing.** Do not invent it: start from the curated chains in `${CLAUDE_PLUGIN_ROOT}/skills/team/default-models.yaml`. Its `routing:` block has the same shape as the config's (role -> ordered `harness:model` preferences, one reason per line as a comment). Keep only the entries whose harness the user chose in step 2 (`claude:...` needs `claude`; `pi:<provider>/<model>[:<thinking>]` needs `pi`, and its provider/model must appear in `pi --list-models`, which shows only providers with credentials; for `claude:` entries the model must be one the user's plan gives). Keep the file's order. A role left with no entry falls back to the "best for" column of [Known harnesses and models](#known-harnesses-and-models); tell the user which roles you had to fill that way. Ask the user to confirm or edit the result in one question with it as the default. The file is curated by hand and may lag reality: where it disagrees with what the harness lists, the harness wins and you say so.
5. **Save** the confirmed routing, with the user's edits, to `${XDG_CONFIG_HOME:-$HOME/.config}/hyper/team-lead/harnesses.yaml` (create the directory if needed); from then on the saved routing is the source of truth, not `default-models.yaml`. Show the user a 5-line summary. Format:
   ```yaml
   # team-lead harness config. Written by the team-lead skill; safe to edit by hand.
   updated: 2026-09-27
   harnesses:
     codex:
       launch: codex -m gpt-5.6-sol -c 'model_reasoning_effort="high"'
       bin: codex            # optional for direct commands; required for env/wrappers
       herdr_kind: codex
       models: [gpt-5.6-sol]
       notes: weekly quota; check before assigning M/L work
       env:
         inherit: [CODEX_HOME]
     claude:
       launch: claude --model <model>
       herdr_kind: claude
       models: [haiku, sonnet, opus]
       env:
         inherit: [CLAUDE_CONFIG_DIR]   # same account/config dir as the lead; see Dev environment
     pi:
       launch: pi --name <agent-name>
       herdr_kind: pi
       messaging: claude-link   # or herdr when pi-claude-link is not installed
       env:
         inherit: [PI_CODING_AGENT_DIR]
   routing:                     # role -> ordered harness:model preferences
     researcher:   [agy:gemini-3.1-pro, claude:haiku]
     mechanic:     [kimi:kimi-for-coding-highspeed, claude:haiku]
     developer:    [codex:gpt-5.6-sol, kimi:kimi-for-coding, claude:sonnet]
     senior-dev:   [codex:gpt-5.6-sol@high, claude:opus]
     reviewer:     [claude:opus, claude:sonnet]
     squad-leader: [claude:opus]
   ```
6. From then on, pick a role's first harness whose quota is available; fall to the next on a quota error, and note the switch in the status table.

### Dev environment

A dev's shell does not inherit the lead's environment: inside Herdr the pane shell comes from the Herdr server, and outside Herdr a background shell starts clean. So a lead running under a non-default config directory (for example `CLAUDE_CONFIG_DIR` pointing at a work account) would otherwise spawn devs on the personal account. Each harness's optional `env:` block says which variables cross that boundary:

```yaml
env:
  inherit: [CLAUDE_CONFIG_DIR, CLAUDE_PROMPT_INFO]   # copy from the lead's env when set there
  defaults:                                          # used when a listed var is unset in the lead's env
    CLAUDE_CONFIG_DIR: ~/.claude-work
  set:                                               # always this value, whatever the lead has
    DISABLE_AUTOUPDATER: "1"
```

- `inherit`: copied from your own environment when set there; a variable not listed is never copied, so Herdr pane IDs and other session-specific values never leak into a dev.
- `defaults`: value for a listed variable that is unset in your environment. Every key must also appear in `inherit`; a default for an unlisted variable is a config error (`check-deps.sh` reports it).
- `set`: forced value, independent of your environment.

Precedence: `set` > your value > `defaults`. Expand a leading `~` to `$HOME`. Resolve the block once per launch into `KEY=VALUE` pairs and pass them to the launcher: an `export KEY=VALUE ...` run in the dev's pane before `herdr agent start` in [Herdr mode](herdr-mode.md), a `KEY=VALUE ...` prefix inside the `--command` string in [Orca mode](orca-mode.md), an `env KEY=VALUE ...` prefix on the launch command elsewhere. With no `env:` block nothing is passed, which is why setup always writes the table's `inherit` list. A remote machine has its own home and its own credentials: a value that is a path on your machine (a config dir) is only valid there if the same path exists on the remote; check with the probe terminal before inheriting it across machines.

## Known harnesses and models

Snapshot as of 2026-09. Model names change often: confirm with the harness's own model list before writing the config, and let the user's config win over this table.

| Harness (CLI) | Models | Best for | Launch notes | Env to inherit |
|---|---|---|---|---|
| Claude Code (`claude`) | Haiku 4.5 (`haiku`) | lookups, research that returns text, mechanical edits, running verify and reporting counts | `--model haiku`; cheapest Claude tier | `CLAUDE_CONFIG_DIR` (account and settings directory) |
| | Sonnet 5 (`sonnet`) | default development: features, bug fixes, tests, `/code-review` passes | | |
| | Opus 5.5 (`opus`) | hard bugs, gnarly types, multi-system changes, reviews of core contracts, squad leaders | | |
| | Fable 5.1 (`fable`) | only when the user asks for it; never for work Opus or Sonnet can do | most expensive tier | |
| Codex CLI (`codex`) | `gpt-5.6-sol` | M/L implementation; strong at following a precise brief | `-c 'model_reasoning_effort="high"'` for M/L (the default effort may be low); weekly quota, so check before assigning; its sandbox may block git writes when the repo's `.git` is outside the worktree (add it to `writable_roots`) | `CODEX_HOME` (config and auth directory) |
| Kimi Code (`kimi`) | `kimi-for-coding-highspeed`, `kimi-for-coding`, `k3`, `k3-256k` | highspeed: mechanical edits and verify runs; `kimi-for-coding`/`k3`: S/M implementation; `k3-256k`: tasks that read a lot of source | use the managed alias `-m kimi-code/<model>`; a bare alias may fail auth. A wrapper that runs Claude Code against Kimi's endpoint (e.g. a `klaude` script) is a drop-in Claude-kind dev with the same skills and hooks | none known; a `klaude`-style wrapper inherits like Claude Code |
| Antigravity (`agy`) | Gemini 3.1 Pro | research with citations, docs lookups, really simple tasks | asks a folder-trust question on first run in a directory; answer it before sending the brief | none known |
| Gemini CLI (`gemini`) | Gemini models on the user's plan | same niche as `agy` when it is the one configured | | none known |
| pi (`pi`) | any model from its configured providers; list them with `pi --list-models` | route by the model behind it, not the CLI | pick a model with `--model <provider>/<model>[:<thinking>]`; launch with `--name <agent-name>` so it shows under that name in Claude's `/list-agents`; needs the `pi-claude-link` extension to message Claude sessions | `PI_CODING_AGENT_DIR` (config directory) |
| opencode, aider, crush, others | whatever provider the user configured | ask the user; route by the model behind it, not the CLI | record the exact launch command the user gives | ask the user |

Routing rule of thumb: the cheapest harness that finishes in one or two attempts, with Claude kept for leads, reviews and hard problems when other harnesses are available. A reviewer should use a different model from the dev whose work it reviews.
