---
name: canvas
description: Draw a diagram for the user on a shared canvas they can see and comment on, kept as a file in a project. Use when the user says "paint a picture", "canvas", "diagram it", "draw this", or when a flowchart, architecture, sequence, state or ER diagram would explain something better than prose. Needs the canvas MCP server and its local service.
---

# Canvas

Draw on the user's canvas through the `canvas` MCP server. Diagrams live as `.openflow.json` files in the
service's projects; the user opens a link and sees them live, and comments on the canvas reach you.

**When to draw:** a flow with branches, a system with more than three moving parts, a protocol, a data model,
a state machine. Not a list, a single call, or what one sentence explains.

## Setup (once)

```
brew install hyperlab-sh/tap/canvas      # or: npm i -g @hyperlab.sh/canvas (needs Node), or the install script in the README
claude mcp add -s user canvas -- canvas mcp
```

To have the service always running (macOS and Linux): `canvas service install`.

Start Claude Code with `OPENFLOWKIT_CHANNEL=1` in the environment if you want canvas comments pushed into the
session; without it, read them with `list_threads`. The MCP server starts the service (`canvas serve`,
127.0.0.1:43120) itself when it is not running.

## Draw

1. `server_info` (or `whoami`): `service` says whether the service is up and which projects it has.
2. Which diagram? Check the one the user named with `list_diagrams`.
   - Existing: `connect_diagram` with `{ project, diagram }`. If it is held by another session, it is refused and the
     error names the holder: tell the user to disconnect it in the app, never work around it.
   - New: `create_diagram` with `{ project, diagramName, dsl }`. Omit `project` only when the service has one.
3. Write the diagram in Mermaid or OpenFlow DSL (`get_syntax` for the grammar) and `validate_openflow_dsl` with
   `{ dsl }` until `ok`. Fix every `error`; read the warnings.
4. Give the user the link from the result (`/#/p/<project>/<id>`), and say what you left out.

A session holds one diagram per `create_diagram`/`connect_diagram` call and may hold several; pass `diagram`
to say which. Release one with `disconnect_diagram` when the user is done with it.

## Change a diagram

`get_diagram` returns the DSL, then edit the text and `update_diagram`; not `create_diagram` again, that makes a
second diagram. `update_diagram` redraws from the text, so the user's canvas edits (recolours, moves, renames) are
lost unless you merge each `carry` into that node's `[ … ]` list; `discarded` lists any lost. To see what the user
changed on the canvas, `get_diagram` with `diffOnly: true`.

## Comments

`list_threads` (`unanswered: true` for the ones waiting on you), `reply_to_thread`, `resolve_thread`,
`start_thread`. A comment pushed into the session arrives as a `<channel source="openflowkit" thread_id=…>`
message: answer it with `reply_to_thread` using that `thread_id`.

## DSL in one screen

First line is the family: `flowchart`, `architecture`, `sequence`, `state`, `erd`, `class`, `mindmap`,
`gitgraph`, optionally with a direction (`flowchart right`).

```dsl
flowchart right
title: Checkout
group Payments {
  Pay [diamond]
  Stripe [icon: tabler/brand-stripe]
}
Cart -> Pay : card ok?
Pay -> Done [ellipse, green] : yes
Pay --> Cart : no [red]
```

Arrows: `->` solid, `-->` dashed, `<->` both ends, `A -> B : label`. Attributes go in `[ … ]`: a shape, a colour,
or `key: value`. `search_icons` finds icon ids. `get_syntax` has the rest.
