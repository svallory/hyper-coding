# Marko Run

## Overview

Marko Run is a file-based router and development server for Marko. It uses Vite for its dev server and build process.

## File-based Routing

### Routes Directory
- By default, routes are in `./src/routes`.
- This can be configured in `vite.config.ts` with the `routesDir` option.

### Routable Files
- Files must be prefixed with `+`.
- **`+page.marko`**: Establishes a `GET` route that renders the page.
- **`+layout.marko`**: Wraps nested layouts and pages. Renders the nested content via the `input.content` property (equivalent to `children` in React).
- **`+handler.*`**: Handles `GET`, `POST`, `PUT`, `DELETE` requests. Exports functions with these names.
- **`+middleware.*`**: Runs before handlers for all HTTP methods. Exports a default function.
- **`+meta.*`**: Static metadata for the route, available in the route `context`.

### Special Files
- **`+404.marko`**: Responds to requests with no matching route and an `Accept` header of `text/html`.
- **`+500.marko`**: Responds to uncaught errors during a request with an `Accept` header of `text/html`.

### Execution Order
1.  Middlewares (root to leaf)
2.  Handler
3.  Layouts (root to leaf)
4.  Page

### Path Structure
- **Static:** `users` -> `/users`
- **Pathless:** `_users` -> `/`
- **Dynamic:** `$id` -> `/:id`
- **Catch-all:** `$$all` -> `/*all`

### Flat Routes
- Use `.` to define path segments in a file or folder name.
- `projects.$projectId.members+page.marko` -> `/projects/:projectId/members`
- **Groups:** `(members,people)` -> matches `members` or `people`.
- **Optional:** `(home,)` -> matches `/` or `/home`.
- **Escaping:** Use backticks (`` ` ``) to escape control characters (`.,+()$_`).

## Vite Plugin
- The `@marko/run/vite` plugin discovers routes, generates routing code, and registers the `@marko/vite` plugin.
- **Adapters:** Allow building for different platforms (Node, Netlify, Static, etc.).

## Runtime
- **`Context`:** Passed to middleware and handlers, and available as `$global` in templates. Contains `request`, `params`, `meta`, `platform`, `fetch`, `render`, `redirect`, `back`.
- **`Run.fetch(request, platform)`:** Programmatically fetches a route.
- **`Run.match(method, pathname)`:** Synchronously finds a route.
- **`Run.invoke(route, request, platform)`:** Invokes a matched route.

## TypeScript
- **`MarkoRun.Handler`**: Type for a handler function.
- **`MarkoRun.Route`**: Type for a route's params and metadata.
- **`MarkoRun.Context`**: Type for the request context. Can be extended.
- **`MarkoRun.Platform`**: Type for the platform object. Can be extended.
- **Generated Types:** A `.marko-run/routes.d.ts` file is generated with specific types for each route.
