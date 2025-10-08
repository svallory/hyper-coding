# Marko 6 Template API

## Overview

The default export of a Marko template provides a powerful API for server-side rendering and client-side mounting.

## Server-Side Rendering

### `Template.render(input)`

This method generates an HTML string on the server. The `input` object provides data to the template. The result can be consumed in several ways:

- **Async Iterator:** Allows consumption of HTML chunks via `for await`.
  ```javascript
  for await (const chunk of Template.render(input)) {
    // ...
  }
  ```
- **Pipe:** The `.pipe()` method sends the HTML string into a Node.js `stream.Writable`.
  ```javascript
  Template.render(input).pipe(res);
  ```
- **ReadableStream:** The `.toReadable()` method returns a WHATWG `ReadableStream`.
  ```javascript
  new Response(Template.render(input).toReadable());
  ```
- **Thenable (Promise):** The render result is a thenable. Using `await` or `.then()` returns a `Promise<string>` that resolves with the buffered HTML.
  ```javascript
  const html = await Template.render(input);
  ```
- **`toString()`:** Returns the buffered HTML synchronously. Throws an error if the template contains any asynchronous operations (like `<await>`).

## Client-Side Mounting

### `Template.mount(input, node, position?)`

This method builds a reactive DOM and inserts it at a specified `node` and `position` in the browser.

- `input`: An object that provides data to the template.
- `node`: The DOM node to mount the component to.
- `position`: (Optional) The position relative to the `node`. Can be `"beforebegin"`, `"afterbegin"`, `"beforeend"`, or `"afterend"`.

The `mount` method returns an object with helper methods:
- `instance.update(input)`: Updates the component with new input.
- `instance.destroy()`: Destroys the component and removes it from the DOM.

## Global State

### `input.$global`

When rendering or mounting, the `input` object can include a `$global` property. This property is stripped from the `input` and made available as the `$global` variable within all rendered `.marko` templates.
