# Marko 6 Expert Agent

## Purpose
Provide a deterministic, machine-optimised reference for generating, modifying, and analyzing Marko 6 and Marko Run code. No narrative; only formalized syntax, semantics, API signatures, typing, and canonical usage examples. Use verbatim for system prompts.

---

## Core primitives (explicit)
- `input: Record<string, any>` — component props object.
  ```ts
  /** @typedef {{ [k: string]: any }} Input */
  ```
- `input.content?: Marko.Body` — render body passed from parent. Render: `<${input.content}/>`.
  ```ts
  /** @type {Marko.Body | undefined} */
  const content = input.content;
  ```
- `$signal: AbortSignal` — available inside templates and `<script>`; aborted when template is removed or expression invalidated.
  ```ts
  /** @type {AbortSignal} */ const signal = $signal;
  signal.onabort = () => { /* cleanup */ };
  ```
- `$global: Marko.Global` — render-context globals (Marko Run: contains request, params, etc.).
  ```ts
  /** @type {Marko.Global} */ const g = $global;
  ```

---

## Module statements (explicit)
- `import` / `export` — standard ES module semantics at module root. For auto-discovered tags, you do not need an import statement to use the tag directly (e.g., `<my-tag>`). To import types or other exports from an auto-discovered tag, use the dash-cased tag name as the import path (e.g., `import { Input as MyTagInput } from "<my-tag>";`).
- `static` — module-scoped; executes once on module load (server + client). All valid JavaScript statements allowed, including class and function definitions.
  ```marko
  static const VERSION = "1.0";
  static class MyClass { /* ... */ }
  ```
- `server` / `client` — environment-specific module-scoped code.
  ```marko
  server import db from "./db";
  client { /* browser-only init */ }
  ```

---

## Tag syntax & attribute rules (explicit)
- Attributes are JavaScript expressions (not string interpolation unless quoted).
  ```marko
  <div id="foo"/>           // id => "foo" (string literal)
  <div num=1 + 1/>         // num => 2 (expression)
  <div fn=() => {} />      // fn => function value
  ```
- Skip rendering when attribute value is `null | undefined | false`.
  - Render when value is `0 | NaN | ""`.
- Boolean attribute shorthand: `<input checked/>` → `checked=true` (attribute present).
- ARIA: use strings: `aria-pressed=isPressed && "true"` (do not pass booleans).
- Spread attributes: `<div ...input/>` merges left-to-right; later keys override.
- Method shorthand (concise): `button onClick(e) { ... }` → event handler.
- `:=` binding (two-way): `<input value:=count/>` desugars to:
  ```marko
  <input value=count valueChange(v) { count = v }/>
  ```
- Class/id shorthand: `.class #id` in concise or `<div#id.class/>` in HTML.
- Value shorthand: `<my-tag=123/>` → `<my-tag value=123/>`.
- Attribute termination: comma-terminated attributes allowed in concise mode.

---

## Tag variables (explicit)
- Syntax: `<tag/var/>` or `<tag/{ a, b }/>` exposes variables from tag to parent scope.
- Hoisted: tag variables are available anywhere in template (except module scope).
- Native element ref: `<div/ref/>` exposes `ref` as `() => HTMLElement | null` (browser only).
  ```marko
  <div/ref/>
  <script>
    const el = ref(); // HTMLElement | null
    if (el) el.innerHTML = "x";
  </script>
  ```
- Return value from child: child uses `<return=value>`; parent reads `<child/ret/>`.

---

## Tag parameters & arguments (explicit)
- Tag parameters (pipe syntax): `<child|params|> ... </child>`.
  - Parent provides content: `<child|p|>Content ${p.value}</child>`.
  - Type: `Marko.Body<[ParamTypes]>`.
- Tag arguments (call syntax): `<child(1,2)/>`; parent receives parameters: `<child|a,b|>...`.
- **Cannot mix** arguments and attributes on same tag instance.

---

## Reactivity model (explicit)
- Reactive sources: `input`, tag variables, tag parameters, `<let>` variables.
- Any template expression that references reactive sources becomes reactive and re-evaluates when sources change.
- Reactive graph is discovered at compile time.
- Update scheduling: model batches changes after current microtask; further changes after batch processed are deferred to next frame.
- Render expressions must be pure (no side effects) for predictable updates.

---

## Control flow (explicit)
- Conditionals:
  ```marko
  <if=cond> A </if>
  <else if=cond2> B </else>
  <else> C </else>
  ```
- Iteration (`<for>`):
  - Arrays/iterables: `<for|item, index| of=array by=item => item.id>`
  - Objects: `<for|k, v| in=obj>`
  - Ranges: `from`, `to` (inclusive) or `until` (exclusive), `step=`.
- **Always provide `by` for lists** to produce stable keys for diffing:
  - Function: `by = item => item.id`
  - String shorthand (for `of=` only): `by="id"`

---

## Async & error handling (explicit)
- `<await|result|=promise>` unwraps `Promise` and provides `result` to body.
- Use `<try>` with `<@placeholder>` (loading) and `<@catch|err|>` (error handler).
  ```marko
  <try>
    <@placeholder>Loading...</@placeholder>
    <@catch|err|>Error: ${err.message}</@catch>
    <await|data|=fetchData()>${data.name}</await>
  </try>
  ```
- Any long-running tasks must respond to `$signal` cancellation: `fetch(url, { signal: $signal })`.

---

## Styling (explicit)
- `<style>` in template: scoped to component; loaded once per component type, not per instance.
- Preprocessors: `<style.scss>` etc. supported.
- CSS Modules: `<style/s>` exposes `s` object: `class=s.btn`.
  ```marko
  <style/s> .btn { } </style>
  <div class=s.btn/>
  ```
- `class=` accepts `string | Array<string | null | undefined | object> | { [k:string]: boolean }`.
- `style=` accepts `string | object | array` similarly.

---

## Lifecycle & side-effects (explicit)
- `<lifecycle>` tag attributes: `onMount()`, `onUpdate()`, `onDestroy()`; `this` persists across lifecycles. The `onMount` hook receives the `HTMLElement` as its first argument.
  ```marko
  <lifecycle<{ scrollSnapInstance?: ScrollSnap }>
    onMount() {
      const element = document.getElementById("scroll-snapper") as HTMLElement;
      if (element) {
        this.scrollSnapInstance = new ScrollSnap(element, input);
      }
    }
    onDestroy() {
      this.scrollSnapInstance?.destroy();
    }/>
  ```
- `<script>` runs on mount and re-runs when referenced reactive dependencies change.
  - Use `$signal.onabort = () => cleanup()` for disposal inside `<script>`.

---

## TypeScript integration (explicit)
- Enable TS via `tsconfig.json` or `marko.json` `"script-lang": "ts"`.
- Export input types:
  ```ts
  export interface Input {
    name: string;
    count?: number;
    content?: Marko.Body;
  }
  ```
- Common types available:
  ```ts
  type Template<TInput, TReturn>;
  type Body<TParams extends any[], TReturn = any>;
  type AttrTag<T>;
  type Global;
  type NativeTags;
  ```
- JSDoc support allowed in JS-mode files for type hints: `// @ts-check` + `/** @type {Input} */`.

---

## Core built-in tags (explicit, canonical usage)
- `<let/name=init/>` — mutable reactive variable.
  ```marko
  <let/count=0/>
  <button onClick() { count++ }/>
  ```
- `<const/name=expr/>` — derived reactive constant (recomputes on deps change).
- `<return=val/>` — expose value to parent; parent reads via `<child/val/>`.
- `<define/Name|input:{...}|>` — reusable component snippet; acts like function return value.
- `<id/myId/>` — generates stable unique id string; `myId` is `string`.
- `<log=expr/>` — logs to console on server & client when expr changes.
- `<debug=expr/>` — injects `debugger` when executed.

---

## Enhanced native tag behavior (explicit)
- Native tag exposes a tag variable when declared: `<div/ref/>` → `ref(): HTMLElement | null` (browser only).
  - Use: `const el = ref(); if (el) el.focus();`
- Event handlers:
  - `onClick`, `onFocus`, `on-input`, `on-contentvisibilitychange` are valid forms.
  - `onX` lowercases event name; `on-x` preserves case.
  - Value must be function or falsy (for conditional binding).
- Controlled component change handlers:
  - `valueChange`, `checkedChange`, `openChange`, `checkedValueChange`.
  - Example: `<input value:=text/>` or `<input value=text valueChange(v){ text = v }/>`.
- `<select>`: `value=` controls selected option; `<option selected/>` vs `value` semantics.
- Radio/checkbox `checkedValue=` maps checked state to a value string/primitive.

---

## Concise syntax rules (explicit)
- File default: Concise mode; first HTML-syntax tag switches to HTML mode permanently.
- Indentation determines tree; incorrect indentation = syntax error.
- Text blocks start with `--`, multi-line terminated by matching hyphen block or dedent.
- Root-level text blocks require fenced `--` block.
- Shorthands:
  - `.className` → `<div class="className"/>`
  - `#idName` → `<div id="idName"/>`
  - Interpolation: `${expr}` in text/attributes.
  - `#comp${i}` → `<div id="comp1" />` if `i == 1`
  - `.theme-${theme}.${input.class}` → `<div class="theme-dark one two" />` if `theme == 'dark'` and `input.class == ['one', 'two']`
- Attributes may be comma-terminated or comma-prepended to span across multiple lines in concise mode.


## Template API (explicit types & usage)
- `Template.render(input)` → RenderResult:
  ```ts
  interface RenderResult {
    [Symbol.asyncIterator](): AsyncIterableIterator<string>; // async chunks (SSR)
    pipe(stream: NodeJS.WritableStream): void;
    toReadable(): ReadableStream;
    then(onFulfilled: (html: string) => any): Promise<any>; // when fully rendered
    toString(): string; // synchronous if no async content (throws otherwise)
  }
  ```
- `Template.mount(input, node, position?)` → `Instance`:
  ```ts
  interface Instance {
    update(input: Partial<Input>): void; // synchronous update
    destroy(): void; // abort signals + cleanup
  }
  ```
- `input.$global` fields:
  - `signal: AbortSignal`, `cspNonce: string`, `runtimeId: string`, `renderId: string`.

---

## Marko Run (file-based routing) — explicit
- Detect: `@marko/run` in `package.json` OR `import marko from "@marko/run/vite"`.
- Routes directory default: `./src/routes` (configurable via plugin options).
- Routable file names (convention):
  - `+page.marko` → render page for GET
  - `+layout.marko` → layout, receives `input.content`
  - `+handler.*` (.js/.ts) → exports `GET/POST/PUT/DELETE` handlers
  - `+middleware.*` → default export runs before handlers
  - `+meta.*` → static metadata
  - `+404.marko`, `+500.marko` → special error pages at root
- Route path segments:
  - `dir` → `/dir`
  - `_dir` → pathless directory (ignored in URL)
  - `$id` → `/:id` (param captured in `params.id`)
  - `$$rest` → `/*rest` (captures remainder)
  - `.` separates flat segments: `projects.$projectId.members+page.marko` → `/projects/:projectId/members`
  - groups: `(a,b)` matches `a` or `b`; `(x,)` optional segment (matches `/` or `/x`)
  - backtick escapes for literal punctuation: ``sitemap`.`xml+handler.ts`` → `/sitemap.xml`
- Execution order: middlewares (root→leaf) → handler → layouts (root→leaf) → page.
- Context object in handlers:
  ```ts
  interface Context {
    route: string;
    request: Request;
    method: string;
    params: Record<string,string>;
    meta: any;
    platform?: any;
    parent?: Context;
    fetch(resource: RequestInfo, init?: RequestInit): Promise<Response>;
    render(template: any, input?: any): Response; // streaming
    redirect(to: string, status?: number): Response;
    back(fallback?: string, status?: number): Response;
  }
  ```
- Runtime API: `Run.fetch(request, platform?)`, `Run.match(method, pathname) -> { params, meta } | null`, `Run.invoke(route, request, platform?) -> Response | undefined`.
- Adapters: `@marko/run-adapter-node`, `@marko/run-adapter-netlify`, `@marko/run-adapter-static` (configure in vite plugin).

---

## TypeScript & Marko Run type support (explicit)
- Global augmentation pattern:
  ```ts
  declare module "@marko/run" {
    interface Context { user?: User }
    interface Platform { env?: Env }
  }
  ```
- `.marko-run/routes.d.ts` auto-generated when TS enabled (contains route-specific types).

---

## Custom tag discovery & packaging (explicit)
- Resolution order:
  1. **Auto-discovered Tags** - Tags in `src/tags/` or `src/components/` (or other configured tag directories) can be used directly in dash-case (e.g., `<my-tag>`). No import statement is needed for usage.
  2. Local PascalCase variable
  3. `tags/` folders (index.marko, TAG.marko)
  4. `node_modules` with `marko.json` exports.
- Associated discovery: `foo.marko` finds `foo.style.*` and `foo.marko-tag.json` adjacent.
- Publish: `marko.json` example: `{ "exports":"./dist/tags" }`.

---

## Attribute tags (slots) — explicit
- Parent writes:
  ```marko
  <my-modal>
    <@header>Title</@header>
    <@body>Content</@body>
  </my-modal>
  ```
- Component input type:
  ```ts
  export interface Input {
    header?: Marko.Body;
    body?: Marko.Body;
  }
  ```
- Repeated slots iterate as `Marko.AttrTag<T>`; convert to array with `const items = [...input.item || []]`.
- Slots accept parameters: `<@content|data,isLoading|>...` and the child invokes `<${input.content}(data,isLoading)/>`.

---

## Best practices (AI directives - explicit)
- Prefer TypeScript: `export interface Input { ... }` for every component.
- Keep components single-responsibility.
- Match file syntax to project (Concise vs HTML).
- Always key lists via `by=` on `<for>`.
- Prefer `<let>` for mutable state; `<const>` for derived values.
- Use `value:=` or `valueChange` handlers for controlled components.
- Dispose side-effects with `$signal.onabort` inside `<script>`.
- Wrap async operations in `<try>` + `<@catch>` + `<@placeholder>`.
- Minimize client JS: leverage server streaming and lazy `<await>` blocks.
- Use CSS Modules (`<style/s>`) for scoped classes when reusability required.

---

## Common patterns (compact canonical examples)
- Controlled input:
  ```marko
  <let/text:=input.value>
  <input type="text" value:=text/>
  export interface Input { value: string; valueChange?: (v:string)=>void }
  ```
- Paginated list:
  ```marko
  <for|item| of=input.items by="id">
    <div>${item.name}</div>
  </for>
  export interface Input { items: Array<{ id: string; name: string }> }
  ```
- Async load with placeholder:
  ```marko
  <try>
    <@placeholder>Loading...</@placeholder>
    <@catch|err|>Error: ${err.message}</@catch>
    <await|data|=input.fetchData()>${data.title}</await>
  </try>
  ```
- API handler (`+handler.ts`):
  ```ts
  export async function POST(context: Context) {
    const data = await context.request.json();
    return new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" }});
  }
  ```

---

## Critical differences vs legacy (explicit)
- `input.content` **replaces** `input.renderBody` (Marko 6).
- Concise mode is default; first HTML tag triggers HTML mode.
- `<script>` is reactive (runs on mount + when dependencies referenced by script change).
- Tag variables are hoisted (accessible before declaration within template scope).
- CSS Modules via `<style/s>`.
- No class-based components; templates only.
- TypeScript supported natively via config.

---

## Common mistakes (explicit checklist)
- Don't use `input.renderBody` (use `input.content`).
- Always provide `by` for `<for>` to avoid unstable list diffing.
- Export `interface Input` for TS safety.
- Use `<let>` for mutable state; don't mutate `<const>`.
- Always use `$signal.onabort` inside `<script>` for cleanup of async work.
- Don't mix tag args with attributes on same tag instance.
- Do not access tag variables inside `static` module scope.
- Use string values for ARIA attributes, not booleans.
- `<let>` is not reactive to external `value=` unless controllable (use `valueChange`).

---

## Decision guide (quick mapping)
- mutable → `<let>`
- derived → `<const>`
- pass data to parent → `<return>`
- list rendering → `<for of= ... by=...>`
- conditional → `<if>` / `<else>`
- async → `<await>` inside `<try>`
- side-effects → `<script>` with `$signal.onabort`
- lifecycle hooks → `<lifecycle onMount/onUpdate/onDestroy>`
- slots → `<@name>` attribute tags
- two-way binding → `value:=var`
- scoped CSS → `<style>` or `<style/s>`
- Marko Run page → `+page.marko`

---

End of file. 
