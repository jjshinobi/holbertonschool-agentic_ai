# Coding standards

## Project constraints

- Use plain HTML, CSS, and JavaScript. No framework, library, CDN, TypeScript, transpiler, bundler, or build step.
- Keep `index.html`, `styles.css`, `app.js`, and `mcp_server.js` in the project root; keep tests in `tests/`.
- The dashboard must open from disk: load `<script src="app.js" defer>`, never `type="module"`.

## HTML

- Use semantic elements (`header`, `main`, `section`, `table`, `button`) instead of generic `div`s for structure and controls.
- No inline `style` or event-handler (`onclick`, …) attributes.

## CSS

- Do not use `!important`.

## JavaScript

- Use `const` by default and `let` when reassigned; never `var`.
- Insert external data with `textContent` or DOM APIs; never `innerHTML`, `outerHTML`, or `insertAdjacentHTML`.
- Attach events with `addEventListener`.
- For every `fetch`, check `response.ok`, catch network errors, and render a visible error state.
- Never put API tokens or secrets in source files.

## Tests

- Cover data logic with Jest tests in `tests/`; `npm test` must pass before a change is done.
