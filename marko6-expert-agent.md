# Marko 6 Expert Agent - Complete Reference

## Usage Instructions

When working on a project, first determine if it uses Marko Run by checking for `@marko/run` in `package.json` or `@marko/run/vite` in `vite.config.ts`. If present, refer to the Marko Run section for file-based routing conventions.

When creating or modifying Marko files, identify the syntax (HTML or Concise) in use and maintain consistency throughout the project. Concise mode is the default for all `.marko` files.

## Core Language Concepts

### Overview

Marko is a declarative UI language that extends HTML with JavaScript syntax integration, control flow, and reactive data bindings. It compiles to optimized JavaScript with separate server and client builds for streaming and server-side rendering.

### Template Variables

**`input`** - Object containing attributes passed to the component from parent tags or top-level API. Access properties as `input.propertyName`.

**`$signal`** - AbortSignal available in all JavaScript statements and expressions. Aborted when expression is invalidated or template/content is removed from DOM. Use for cleanup with APIs like `addEventListener({ signal: $signal })` or `$signal.onabort = () => cleanup()`.

**`$global`** - Provides access to render globals from the top-level API. Access as `$global.propertyName`.

### Statements

**`import`** - Standard JavaScript imports at root of template. Shorthand: `import MyTag from "<my-tag>"` uses Marko's tag discovery for custom tags. This is syntactic sugar for `static import`. For auto-discovered tags, you do not need an import statement to use the tag directly (e.g., `<my-tag>`). To import types or other exports from an auto-discovered tag, use the dash-cased tag name as the import path (e.g., `import { Input as MyTagInput } from "<my-tag>";`).

**`export`** - Standard JavaScript exports at root of template. Used to export functions, types, and interfaces.

**`static`** - Prefix for module-scoped code that runs once when template loads (both server and browser). Syntax: `static const x = 1` or `static { /* block */ }`. All valid JavaScript statements allowed, including class and function definitions.

**`server` / `client`** - Prefix for environment-specific module-scoped code. Runs once when template loads in specified environment. Syntax: `server import db from './db'` or `client { /* browser-only code */ }`.

### Tags

Any tag can be self-closed (`<div/>`). Closing tag name is optional (`<div>Content</>`).

### Attributes

Attribute values are JavaScript expressions, not strings. Examples:
- `<div id="foo"/>` - "foo" is a JS string literal
- `<div num=1 + 1/>` - Expression evaluated
- `<div fn=() => {}/>`  - Function value
- `<div obj={ key: "value" }/>`  - Object literal

**Skipped Attributes** - `null`, `undefined`, `false` values are not rendered. Note: `0`, `NaN`, and `""` ARE rendered.

**Boolean Attributes** - `<input checked/>` is equivalent to `<input checked=true/>`.

**ARIA Attributes** - Use strings, not booleans. Correct: `aria-pressed=isPressed && "true"`. Wrong: `aria-pressed=isPressed`.

**Spread Attributes** - `<div ...input/>` or `<div ...{ property }/>`. Merged left to right.

**Method Shorthand** - `<button onClick(e) { console.log(e) }/>` for concise event handlers.

**Change Handler Shorthand (:=)** - Two-way binding syntax. For identifiers: `<input value:=count/>` desugars to `<input value=count valueChange(v) { count = v }/>`. For property accessors: `<input value:=input.count/>` desugars to `<input value=input.count valueChange=input.countChange/>`.

**Class/ID Shorthand** - `<div#id.class1.class2/>` equivalent to `<div id="id" class="class1 class2"/>`. Supports interpolation: `<div.theme-${type}/>`.

**Value Shorthand** - `<my-tag=123/>` desugars to `<my-tag value=123/>`.

**Attribute Termination** - Attributes can be comma-terminated (useful in concise mode). Sequence expressions with comma operators must use parentheses: `<div a=(console.log(x), x)/>`.

### Tag Content

Markup within tag body is available as `input.content`. Render with dynamic tag: `<${input.content}/>`.

**Dynamic Text** - Use `${expression}` for interpolated content (automatically escaped for XSS protection).

### Tag Variables

Expose values from tags with `/identifier` or `/{ destructured }` syntax. Examples:
- `<my-tag/result/>`
- `<my-tag/{ foo, bar }/>`
- `<div/elementRef/>`

Native tags return element reference (callable function returning DOM node, browser-only).

**Scope** - Tag variables are hoisted and accessible anywhere in template except module statements. Can be referenced before declaration.

### Tag Parameters

Pass data from child to parent's content block using pipe syntax: `<child|params|>Content using ${params.value}</child>`.

Child defines parameters when rendering content: `<${input.content} value=123/>`.

Type parameters: `Marko.Body<[{ value: number }]>` for attribute object, or `Marko.Body<[number, string]>` for multiple arguments.

**Scope** - Tag parameters are scoped to tag content only. Not accessible in attribute tags or outside the tag body.

### Tag Arguments

Alternative to tag parameters using function-like syntax: `<${input.content}(1, 2, 3)/>`. Parent receives: `<child|a, b, c|>Sum: ${a + b + c}</child>`. Use spreads: `<child|...args|>`.

Cannot mix arguments and attributes - use one or the other.

### Comments

HTML (`<!-- -->`) and JavaScript (`//`, `/* */`) comments are ignored by compiler. Use `<html-comment>` tag to output literal HTML comments.

### Dynamic Tags

Use `<${tagName}>` for runtime tag selection. Falsy `tagName` renders only content (conditional parent). PascalCase variables can be used directly: `<MyComponent/>`.

### Reactivity System

**Reactive Variables** - `input`, tag variables, and tag parameters are reactive. Any expression referencing them is also reactive.

**Render Expressions** - Found in attributes, dynamic text, dynamic tag names, and script content. Evaluated when dependencies change. Should be pure functions.

**Scheduling** - Updates are automatically batched and queued after microtask. Multiple changes applied efficiently together. Additional updates after queue consumption deferred to next frame.

**Compile-Time Analysis** - Reactive graph discovered at compile time, not runtime (unlike Signals or Hooks patterns).

### Control Flow

**Conditionals** - `<if>`, `<else if>`, `<else>` tags. Syntax:
```marko
<if=condition>Content A</if>
<else if=otherCondition>Content B</else>
<else>Content C</else>
```

**Iteration** - `<for>` tag with multiple modes:
- Arrays/Iterables: `<for|item, index| of=array>`
- Object properties: `<for|key, value| in=object>`
- Exclusive range: `<for|num| from=0 until=10 step=2>`
- Inclusive range: `<for|num| from=0 to=10 step=2>`

**Keyed Iteration** - Always use `by` attribute for list rendering. Function form: `by=item => item.id`. String form (for `of=`): `by="id"`.

### Async & Error Handling

**Promises** - `<await|result|=promise>Use ${result}</await>` unwraps promises.

**Loading State** - Use within `<try>` with `<@placeholder>` attribute tag for loading UI.

**Error Handling** - `<@catch|error|>` attribute tag within `<try>` handles errors. Receives error as parameter.

Example:
```marko
<try>
  <@placeholder>Loading...</@placeholder>
  <@catch|err|>Error: ${err.message}</@catch>
  <await|data|=fetchData()>${data.name}</await>
</try>
```

### Styling

**Scoped CSS** - `<style>` tag loads styles once regardless of component instances. Styles are scoped to component.

**Preprocessors** - Use file extensions: `<style.scss>`, `<style.less>`.

**CSS Modules** - With tag variable: `<style/styles>` exposes classes object. Access as `styles.className`.

**Dynamic Classes** - Object syntax: `class={ active: isActive, disabled: isDisabled }`. Array syntax: `class=["base", { active: isActive }]`.

**Dynamic Styles** - Object syntax: `style={ display: "block", color: isRed && "red" }`. Array syntax: `style=["display:block", { color }]`.

### Lifecycle & Side Effects

**Lifecycle Tag** - `<lifecycle>` with `onMount`, `onUpdate`, `onDestroy` attributes. `this` context persists across lifecycle and is mutable. The `onMount` hook receives the `HTMLElement` as its first argument.

Example:
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

**Reactive Effects** - `<script>` content executes on mount and re-executes when referenced tag variables/parameters change. Use `$signal.onabort` for cleanup.

### TypeScript Integration

**Enabling** - Add `tsconfig.json` at project root OR set `"script-lang": "ts"` in `marko.json`.

**Props Typing** - Export `interface Input` or `type Input`:
```typescript
export interface Input {
  name: string;
  count: number;
}
```

**Generic Input** - `export interface Input<T> { value: T }`. Type parameter `T` available throughout template (except static statements).

**Built-in Types**:
- `Marko.Template<Input, Return>` - Template type
- `Marko.Body<Params, Return>` - Content/render body type
- `Marko.Renderable` - Any renderable value
- `Marko.AttrTag<T>` - Attribute tag type with `[Symbol.iterator]`
- `Marko.Input<"tagName">` - Extract native tag input type
- `Marko.Return<TagOrString>` - Extract return type
- `Marko.BodyParameters<Body>` / `Marko.BodyReturnType<Body>` - Extract from Body type
- `Marko.Global` - Type of `$global`
- `Marko.NativeTags` - Object of all native tags

**Content Typing** - `content?: Marko.Body` for optional content. With parameters: `content: Marko.Body<[number, string]>`.

**Extending Native Tags** - `export interface Input extends Marko.Input<"button"> { /* custom props */ }`.

**Registering Custom Elements**:
```typescript
declare global {
  namespace Marko {
    interface NativeTags {
      "my-element": MyElementAttributes;
    }
  }
}
```

**Global HTML Attributes**:
```typescript
declare global {
  namespace Marko {
    interface HTMLAttributes {
      "my-attr"?: string;
    }
  }
}
```

**CSS Properties**:
```typescript
declare global {
  namespace Marko {
    namespace CSS {
      interface Properties {
        "--custom-prop"?: string;
      }
    }
  }
}
```

**TypeScript Syntax in Templates** - Any JS expression can be TS expression. Use type assertions: `${value as number}`, type parameters: `<child<number>/>`, etc.

**JSDoc Support** - Add `// @ts-check` at top of file or use `jsconfig.json` for type checking without full TypeScript.

**CI Type Checking** - Use `@marko/type-check` CLI (`mtc` command). Use `--generateTrace` flag for performance profiling.

---

## Core Tags Reference

### `<let>`

Creates mutable reactive state via tag variable. Syntax: `<let/varName=initialValue>`.

Updates trigger re-evaluation of all dependent expressions. Does not react to changes in its `value=` attribute unless controllable.

**Controllable Let** - Add `valueChange` handler to make controllable:
```marko
<let/value=10 valueChange(newVal) { /* transform/validate */ }>
```

Use `:=` shorthand for simple controlled/uncontrolled patterns:
```marko
<let/count:=input.count>
<!-- Uncontrolled if only count= provided, controlled if count= and countChange= provided -->
```

### `<const>`

Exposes reactive computed value via tag variable. Syntax: `<const/computed=expression>`. Re-evaluates when dependencies change.

Locally scoped (per component instance). For program-wide constants, use `static const`.

Implementation equivalent to `<return=input.value>`.

### `<return>`

Exposes value from component as tag variable to parent. Syntax: `<return=value>`.

**Assignable Return** - Add `valueChange` to allow parent to assign to tag variable:
```marko
<let/state=input.initial>
<return=state valueChange(newVal) { state = transform(newVal) }>
```

### `<if>` / `<else>`

Conditional rendering. `<if=condition>` applies when truthy. Chain with `<else if=condition>` and `<else>`.

Example:
```marko
<if=user.admin>Admin Panel</if>
<else if=user.loggedIn>User Dashboard</else>
<else>Login Required</else>
```

### `<for>`

Iteration tag with multiple modes:

**Arrays/Iterables**: `<for|item, index| of=items by=item => item.id>`

**Objects**: `<for|key, value| in=object>`

**Exclusive Range**: `<for|n| from=0 until=10 step=2>` (0,2,4,6,8)

**Inclusive Range**: `<for|n| from=0 to=10 step=2>` (0,2,4,6,8,10)

**Keying** - Always use `by` attribute. Function: `by=item => item.id`. String (of= only): `by="id"`.

### `<await>`

Unwraps promise via tag parameter. Syntax: `<await|result|=promise>Use ${result}</await>`.

Use within `<try>` for loading/error states:
```marko
<try>
  <@placeholder>Loading...</@placeholder>
  <@catch|err|>Error: ${err.message}</@catch>
  <await|data|=fetchData()>${data.name}</await>
</try>
```

### `<try>`

Error boundary with optional `<@placeholder>` and `<@catch|err|>` attribute tags.

`<@placeholder>` - Shown while nested `<await>` is pending.

`<@catch|err|>` - Replaces content when error occurs. Receives error as tag parameter.

### `<script>`

Executes in browser on mount and when referenced tag variables/parameters change. Use `$signal.onabort` for cleanup.

```marko
<let/count=0>
<script>
  const timer = setInterval(() => { count++ }, 1000);
  $signal.onabort = () => clearInterval(timer);
</script>
```

For literal `<script>` tags in HTML, use `<html-script>`.

### `<style>`

Loaded once per component regardless of instances. Scoped to component. Use `.scss`, `.less` extensions for preprocessors.

**CSS Modules** - With tag variable: `<style/s>` exposes classes as object `s.className`.

For literal `<style>` tags in HTML, use `<html-style>`.

### `<define>`

Creates reusable markup snippets. Tag variable reflects attributes including content.

```marko
<define/Greeting|input: { name: string }|>
  <span>Hello ${input.name}</span>
</define>
<Greeting name="World"/>
```

Implementation equivalent to `<return=input>`.

### `<lifecycle>`

Lifecycle management with `onMount`, `onUpdate`, `onDestroy` attributes. `this` persists and is mutable.

```marko
<lifecycle<{ api: API }>
  onMount() { this.api = new API() }
  onUpdate() { this.api.sync(data) }
  onDestroy() { this.api.close() }>
```

### `<id>`

Generates unique ID string compatible with HTML `id` and `aria` attributes.

```marko
<id/uniqueId>
<label for=uniqueId>Label</label>
<input id=uniqueId/>
```

If `value=` provided and non-nullable, uses that instead of generated ID.

### `<log>`

Console logs value on server and client, re-executing when dependencies change.

```marko
<let/x=0>
<log=`Value: ${x}`>
<button onClick() { x++ }>Increment</button>
```

### `<debug>`

Injects debugger statement. Executes on render, and when `value=` dependencies change.

### `<html-comment>` / `<html-script>` / `<html-style>`

Output literal HTML elements. `<html-comment>` exposes tag variable for comment node reference.

---

## Enhanced Native Tags

### Element References

Native tags expose tag variable that's a getter returning DOM node (browser-only). Example: `<div/ref/>` then `ref().innerHTML = "text"`.

### Enhanced `class=` Attribute

Accepts strings, objects, arrays:
```marko
<div class="a b"/>
<div class={ active: true, disabled: false }/>
<div class=["base", null, { active: true }]/>
```

### Enhanced `style=` Attribute

Accepts strings, objects, arrays:
```marko
<div style="color:red;margin:10px"/>
<div style={ color: "red", margin: 10 }/>
<div style=["color:red", { margin: 10 }]/>
```

### Event Handlers

Attributes starting with `on-` or `on` followed by capital letter are event handlers.

`on-` preserves casing. `on` lowercases event name.

```marko
<button onClick() { alert("Hi") }>Click</button>
<button on-click() { alert("Hi") }>Click</button>
<canvas onContentVisibilityAutoStateChange() {}>
```

Values must be function or falsy (for conditional handlers):
```marko
<button onClick=condition && (() => { /* handler */ })>
```

### Change Handlers (Controlled Components)

Attributes ending with `Change` synchronize internal element state with component state.

**`<input>` Change Handlers**:

`valueChange=` - For text/number/etc inputs:
```marko
<let/text="">
<input type="text" value:=text>
<!-- OR -->
<input type="text" value=text valueChange(v) { text = v.toLowerCase() }>
```

`checkedChange=` - For checkboxes:
```marko
<let/checked=false>
<input type="checkbox" checked:=checked>
```

`checkedValueChange=` - For radio/checkbox with `checkedValue=`:
```marko
<let/selected="option1">
<input type="radio" value="option1" checkedValue:=selected>
```

**`<select>` Change Handlers**:

`valueChange=` - Controls select value:
```marko
<let/selected="en">
<select value:=selected>
  <option value="en">English</option>
  <option value="es">Spanish</option>
</select>
```

**`<textarea>` Change Handlers**:

`valueChange=` - Controls textarea value:
```marko
<let/text="">
<textarea value:=text/>
```

**`<details>` Change Handlers**:

`openChange=` - Controls open state:
```marko
<let/open=false>
<details open:=open/>
```

**`<dialog>` Change Handlers**:

`openChange=` - Controls non-modal dialog open state. Note: Modal dialogs via `.showModal()` don't fire `openChange`.

### Enhanced `value` Attributes

**`<input type="radio">`** - `checkedValue=` attribute sets variable to radio's `value` when checked.

**`<input type="checkbox">`** - `checkedValue=` attribute sets variable to checkbox's `value` when checked.

**`<select>`** - `value=` attribute controls selected option value (alternative to `selected=` on `<option>`).

**`<textarea>`** - `value=` attribute controls textarea content (alternative to text content).

---

## Concise Syntax Reference

Default mode for all `.marko` files. Switches to HTML mode when HTML-syntax tag encountered.

### Rules

**Nesting** - Indentation-based. Indented line is child of previous less-indented line.

**Attributes** - Listed after tag name. Multi-line separated by commas:
```marko
div
  , id="my-div"
  , class="my-class"
  -- content
```

**Text Blocks** - Initiated with `--` (two or more hyphens):

Single-line (text follows hyphens immediately):
```marko
div -- This is text content
```

Multi-line (newline after hyphens, terminated by matching hyphens or dedent):
```marko
div
  --
    Multi-line
    text content
  --
```

**Root-level Text** - Must use code fences:
```marko
--
Root level text
--
```

**Shorthands**:
- `.className` → `<div class="className"/>`
- `#idName` → `<div id="idName"/>`

**Interpolation in Shorthands**:
```marko
let/type="primary"
.btn-${type}  // <div class="btn-primary"/>
#component${id}  // <div id="component123"/>
```

**Interpolation as Tag** - At root or inside tag: renders dynamic tag. In text block: renders text.

**Mode Switching** - File enters HTML mode on first HTML-syntax tag. Cannot switch back.

---

## Template API Reference

### `Template.render(input)`

Server-side rendering API. Returns object with multiple consumption methods:

**Async Iterator**:
```javascript
for await (const chunk of Template.render({})) {
  // Send chunk
}
```

**Pipe to Node Stream**:
```javascript
Template.render({}).pipe(nodeWritableStream);
```

**WHATWG ReadableStream**:
```javascript
const stream = Template.render({}).toReadable();
new Response(stream, { headers: { "content-type": "text/html" }});
```

**Thenable (Promise)**:
```javascript
const html = await Template.render({});
```

**Synchronous toString()**:
```javascript
const html = Template.render({}).toString(); // Throws if async content
```

### `Template.mount(input, node, position?)`

Client-side mounting API. Builds reactive DOM and inserts at specified position.

**Positions** (from `insertAdjacentHTML`):
- `"beforebegin"` - Before element
- `"afterbegin"` - Inside, before first child
- `"beforeend"` - Inside, after last child (default)
- `"afterend"` - After element

Returns instance with:

**`instance.update(input)`** - Update with new input (synchronous).

**`instance.destroy()`** - Abort all signals and run cleanup.

### `input.$global`

Special property on input object for render globals:

**`$global.signal`** - AbortSignal for canceling async rendering.

**`$global.cspNonce`** - CSP nonce string for scripts/styles.

**`$global.runtimeId`** - Isolates multiple runtimes on same page (auto-set by plugins).

**`$global.renderId`** - Isolates distinct server renders. Set unique string per render.

---

## Marko Run - File-Based Routing

File-based router and development server using Vite.

### Detection

Check for `@marko/run` in `package.json` or `import marko from "@marko/run/vite"` in `vite.config.ts`.

### Routes Directory

Default: `./src/routes`. Configure in `vite.config.ts`:
```typescript
import marko from "@marko/run/vite";
export default defineConfig({
  plugins: [marko({ routesDir: "src/pages" })]
});
```

### Routable Files

All routable files prefixed with `+`:

**`+page.marko`** - Establishes GET route rendering page. Only one per path.

**`+layout.marko`** - Wraps nested layouts/pages. Receives `input.content` with nested content. Render with `<${input.content}/>`.

**`+handler.*`** (.js/.ts) - Handles HTTP methods. Export functions named `GET`, `POST`, `PUT`, `DELETE`. Only one per path.

Handler signature:
```typescript
export function GET(context, next) {
  return new Response("OK");
}

export async function POST(context, next) {
  const response = await next(); // Call page or return 204
  return response;
}
```

**`+middleware.*`** (.js/.ts) - Runs before handlers for ALL HTTP methods. Export default function with same signature as handlers.

**`+meta.*`** - Static metadata for route, available in route context.

### Special Files (Root Level Only)

**`+404.marko`** - Responds when no route matches and `Accept: text/html`.

**`+500.marko`** - Responds when uncaught error occurs and `Accept: text/html`.

### Execution Order

1. Middlewares (root → leaf)
2. Handler
3. Layouts (root → leaf)
4. Page

### Path Structure

**Static** - `users` → `/users`

**Pathless** - `_users` → `/` (directory ignored in path)

**Dynamic** - `$id` → `/:id` (captured in `params.id`)

**Catch-all** - `$$all` → `/*all` (captures rest of path in `params.all`)

### Flat Routes

Use `.` to define segments in file/folder name:

```
projects.$projectId.members+page.marko → /projects/:projectId/members
```

**Groups** - `(members,people)` matches either `members` or `people`

**Optional** - `(home,)` matches `/` or `/home`

**Escaping** - Use backticks for literal control characters:
```
sitemap`.`xml+handler.ts → /sitemap.xml
```

### Context Object

Available in handlers/middleware as first argument, in templates as `$global`:

**Properties**:
- `route` - Route identifier string
- `request` - WHATWG Request
- `method` - HTTP method
- `params` - Path parameters object
- `meta` - Metadata from `+meta` file
- `platform` - Adapter-specific data
- `parent` - Parent context (when using `context.fetch`)

**Methods**:

`fetch(resource, init?)` - Make internal request to router

`render(template, input, init?)` - Create streaming response with Marko template

`redirect(to, status?)` - Create redirect response (resolves relative paths)

`back(fallback?, status?)` - Redirect to referer or fallback

### Runtime API

**`Run.fetch(request, platform)`** - Programmatically invoke route. Returns Response or undefined.

**`Run.match(method, pathname)`** - Synchronously match route. Returns `{ params, meta }` or `null`.

**`Run.invoke(route, request, platform)`** - Invoke matched route. Returns Response or undefined.

### TypeScript Support

**Global Types**:
- `MarkoRun.Handler` - Handler function type
- `MarkoRun.Route` - Route params/meta type
- `MarkoRun.Context` - Request context type (extendable)
- `MarkoRun.Platform` - Platform object type (extendable)

**Extending Context/Platform**:
```typescript
declare module "@marko/run" {
  interface Context {
    user: User;
  }
  interface Platform {
    env: Env;
  }
}
```

**Generated Types** - With `tsconfig.json` present, generates `.marko-run/routes.d.ts` with specific types per route.

### Adapters

Configure in `vite.config.ts`:
```typescript
import marko from "@marko/run/vite";
import netlify from "@marko/run-adapter-netlify";

export default defineConfig({
  plugins: [marko({ adapter: netlify({ edge: true }) })]
});
```

Available: `@marko/run-adapter-node`, `@marko/run-adapter-netlify`, `@marko/run-adapter-static`.

---

## Best Practices for AI Code Generation

### Component Structure

1. **Always use TypeScript** - Export `interface Input` for all components with props
2. **Small focused components** - Single responsibility principle
3. **Consistent syntax** - Match project's HTML vs Concise mode
4. **Keyed iteration** - Always use `by` attribute with `<for>` for lists
5. **Declarative state** - Prefer `<let>` over imperative updates

### State Management

1. **Use `<let>` for mutable state** - Not `<const>` or direct variables
2. **Use `<const>` for derived values** - Computed from other reactive variables
3. **Controlled components** - Use `:=` shorthand or explicit change handlers
4. **Cleanup side effects** - Always use `$signal.onabort` in `<script>` tags

### Marko Run Projects

1. **Check for Marko Run first** - Look for `@marko/run` in dependencies
2. **Follow routing conventions** - Use `+` prefix for routable files
3. **Layouts receive `input.content`** - Not `input.renderBody` (Marko 6 change)
4. **Context in `$global`** - Access request, params, etc. as `$global.request`
5. **Middleware for shared logic** - Use `+middleware.*` for cross-method concerns

### Type Safety

1. **Type all inputs** - `export interface Input { ... }`
2. **Type content parameters** - `Marko.Body<[ParamType]>`
3. **Type attribute tags** - `Marko.AttrTag<{ attr: type }>`
4. **Extend native tags** - `extends Marko.Input<"button">` for HTML element wrappers
5. **Generic components** - Use `Input<T>` for reusable generic components

### Performance

1. **Server-side rendering** - Leverage Marko's streaming SSR
2. **Keyed lists** - Always use `by` for optimal diffing
3. **Lazy loading** - Use `<await>` for async data
4. **CSS Modules** - Use `<style/s>` for scoped styles with tree-shaking
5. **Minimal client JS** - Marko automatically optimizes what ships to client

### Error Handling

1. **Wrap async with `<try>`** - Use `<@catch>` and `<@placeholder>`
2. **Validate handler inputs** - Check request data in handlers
3. **Typed error boundaries** - Type catch parameters: `<@catch|err: Error|>`
4. **Special error pages** - Use `+404.marko` and `+500.marko` in Marko Run

---

## Common Patterns

### Controlled Form Component
```marko
<let/value:=input.value>
<input type="text" value:=value/>

export interface Input {
  value: string;
  valueChange: (v: string) => void;
}
```

### Paginated List
```marko
<for|item| of=input.items by="id">
  <div>${item.name}</div>
</for>

export interface Input {
  items: Array<{ id: string; name: string }>;
}
```

### Async Data Loading
```marko
<try>
  <@placeholder>Loading...</@placeholder>
  <@catch|err|>
    <div>Error: ${err.message}</div>
  </@catch>
  <await|data|=input.fetchData>
    <div>${data.title}</div>
  </await>
</try>

export interface Input {
  fetchData: Promise<{ title: string }>;
}
```

### Layout with Nested Content
```marko
<div.layout>
  <header>Site Header</header>
  <main><${input.content}/></main>
  <footer>Site Footer</footer>
</div>

export interface Input {
  content: Marko.Body;
}
```

### API Route Handler
```typescript
// +handler.ts
export async function POST(context, next) {
  const data = await context.request.json();
  // Process data
  return new Response(JSON.stringify({ success: true }), {
    headers: { "content-type": "application/json" }
  });
}
```

### Middleware with Timing
```typescript
// +middleware.ts
export default async function(context, next) {
  const start = Date.now();
  try {
    return await next();
  } finally {
    console.log(`Request took ${Date.now() - start}ms`);
  }
}
```

### Component with Side Effect Cleanup
```marko
<let/data=[]>
<script>
  const controller = new AbortController();
  
  fetch('/api/data', { signal: controller.signal })
    .then(r => r.json())
    .then(d => { data = d });
  
  $signal.onabort = () => controller.abort();
</script>
```

### Reusable Snippet with Define
```marko
<define/Card|input: { title: string }|>
  <div.card>
    <h3>${input.title}</h3>
    <${input.content}/>
  </div>
</define>

<Card title="Welcome">
  <p>Card content here</p>
</Card>
```

### Conditional Parent Wrapper
```marko
<${input.isWrapper ? "div" : null} class="wrapper">
  <p>This paragraph is conditionally wrapped</p>
</>

export interface Input {
  isWrapper: boolean;
}
```

---

## Custom Tag Discovery

Tags are resolved in priority order:

1. **Auto-discovered Tags** - Tags in `src/tags/` or `src/components/` (or other configured tag directories) can be used directly in dash-case (e.g., `<my-tag>`). No import statement is needed for usage.
2. **Local Variable** - PascalCase variable in scope (e.g., `import MyTag from "./my-tag.marko"`)
3. **Relative Path** - Searches upward for:
   - `tags/TAG_NAME.marko`
   - `tags/TAG_NAME/index.marko`
   - `tags/TAG_NAME/TAG_NAME.marko`
4. **Installed Packages** - Looks in `node_modules` for packages with `marko.json`

### Supporting Files

Marko automatically discovers adjacent files:

**Style Files** - `foo.marko` discovers `foo.style.css` (any extension: `.scss`, `.less`, etc.)

**marko-tag.json** - `foo.marko` discovers `foo.marko-tag.json` for tag metadata

For `index.marko`, the prefix is optional:
```
tags/
  bar/
    index.marko
    style.css      # Discovered
  baz/
    index.marko
    marko-tag.json # Discovered
```

### Publishing Tags via marko.json

Create `marko.json` at package root:
```json
{
  "exports": "./dist/tags"
}
```

This tells Marko where to find exported tags in your package.

---

## Attribute Tags (Slots)

Pass named content blocks to components with `<@slotName>` syntax.

### Basic Usage
```marko
<!-- Parent -->
<my-modal>
  <@header>Modal Title</@header>
  <@body>Modal Content</@body>
  <@footer>
    <button>Close</button>
  </@footer>
</my-modal>

<!-- my-modal.marko -->
<div.modal>
  <header><${input.header}/></header>
  <main><${input.body}/></main>
  <footer><${input.footer}/></footer>
</div>

export interface Input {
  header?: Marko.Body;
  body?: Marko.Body;
  footer?: Marko.Body;
}
```

### Repeated Slots

Multiple attribute tags with same name are consumed via iterable protocol:

```marko
<!-- Parent -->
<list>
  <@item>First</@item>
  <@item>Second</@item>
  <@item>Third</@item>
</list>

<!-- list.marko -->
<ul>
  <for|itemBody| of=input.item || []>
    <li><${itemBody}/></li>
  </for>
</ul>

export interface Input {
  item?: Marko.AttrTag<{}>;
}
```

Convert to array: `<const/items=[...input.item || []]>`

### Conditional Attribute Tags

Use control flow tags to conditionally apply attribute tags:

```marko
<my-component>
  <if=showHeader>
    <@header>Conditional Header</@header>
  </if>
  <for|item| of=items>
    <@item title=item.title/>
  </for>
</my-component>
```

### Attribute Tags with Parameters

Pass data from child component to attribute tag content:

```marko
<!-- Parent -->
<data-fetcher>
  <@content|data, isLoading|>
    <if=isLoading>Loading...</if>
    <else>${data.name}</else>
  </@content>
</data-fetcher>

<!-- data-fetcher.marko -->
<let/data=null>
<let/isLoading=true>
<${input.content}(data, isLoading)/>

export interface Input {
  content: Marko.Body<[any, boolean]>;
}
```

---

## Critical Marko 6 vs Legacy Differences

### Marko 6 Changes (Important for AI Agents)

1. **`input.content` NOT `input.renderBody`** - Layouts and components receive content as `input.content` in Marko 6
2. **Concise mode is default** - All `.marko` files start in concise mode unless HTML syntax is used
3. **`<script>` is reactive** - Runs on mount and when dependencies change (not just once)
4. **Change handlers for controlled components** - Use `valueChange`, `checkedChange`, etc. or `:=` shorthand
5. **Tag variables are hoisted** - Can be referenced before declaration
6. **CSS Modules syntax** - Use `<style/styles>` not `<style>.className`
7. **No class components** - Use functional/template approach only
8. **TypeScript built-in** - Just add `tsconfig.json` or `marko.json` with `"script-lang": "ts"`

---

## Syntax Quick Reference

### HTML Syntax Examples
```marko
<let/count=0/>
<const/doubled=count * 2/>
<button onClick() { count++ }>Count: ${count}</button>

<if=count > 5>High</if>
<else>Low</else>

<for|item, i| of=items by="id">
  <div>${i}: ${item.name}</div>
</for>

<await|data|=fetchData()>
  <div>${data.result}</div>
</await>

<style>
  .button { color: blue; }
</style>

export interface Input {
  items: Item[];
}
```

### Concise Syntax Examples
```marko
let/count=0
const/doubled=count * 2
button onClick() { count++ } -- Count: ${count}

if=count > 5 -- High
else -- Low

for|item, i| of=items by="id"
  div -- ${i}: ${item.name}

await|data|=fetchData()
  div -- ${data.result}

style --
  .button { color: blue; }

export interface Input {
  items: Item[];
}
```

---

## Common Mistakes to Avoid

1. **Using `input.renderBody`** - Use `input.content` in Marko 6
2. **Forgetting `by` attribute in `<for>`** - Always key lists for performance
3. **Not typing Input** - Always export Input interface for TypeScript
4. **Using `<const>` for mutable state** - Use `<let>` instead
5. **Not cleaning up side effects** - Always use `$signal.onabort` in `<script>`
6. **Mixing tag arguments and attributes** - Use one or the other, not both
7. **Accessing tag variables in static statements** - Tag variables not available in module scope
8. **Using boolean for ARIA attributes** - Use strings: `aria-pressed="true"` not `aria-pressed=true`
9. **Expecting `<let>` to react to value changes** - It doesn't unless controllable
10. **Not handling async errors** - Wrap `<await>` in `<try>` with `<@catch>`

---

## Quick Decision Tree for Common Tasks

### Need mutable state?
→ Use `<let/state=initialValue>`

### Need computed/derived value?
→ Use `<const/computed=expression>`

### Need to pass data to parent?
→ Use `<return=value>` in child component

### Need list rendering?
→ Use `<for|item| of=items by="id">`

### Need conditional rendering?
→ Use `<if=condition>`, `<else if>`, `<else>`

### Need async data?
→ Use `<await|data|=promise>` wrapped in `<try>`

### Need side effects?
→ Use `<script>` with `$signal.onabort` cleanup

### Need lifecycle hooks?
→ Use `<lifecycle>` with `onMount`, `onUpdate`, `onDestroy`

### Need named content slots?
→ Use `<@slotName>` attribute tags

### Need two-way binding?
→ Use `value:=variable` shorthand

### Need scoped styles?
→ Use `<style>` or `<style/cssModules>`

### Building with Marko Run?
→ Use `+page.marko`, `+layout.marko`, `+handler.ts` with `+` prefix

---

This reference is comprehensive and designed for AI agents generating Marko 6 code. Always maintain consistency with the project's existing patterns while following these documented conventions.