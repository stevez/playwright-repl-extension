# Changelog

## v0.8.0

### Added

- Verify commands for assertions during REPL sessions and `.pw` scripts:
  - `verify-text "text"` -- assert text is visible on the page
  - `verify-no-text "text"` -- assert text is NOT on the page
  - `verify-element "target"` -- assert element exists (by text, aria-label, label)
  - `verify-no-element "target"` -- assert element does NOT exist
  - `verify-url "substring"` -- assert current URL contains a string
  - `verify-title "text"` -- assert page title contains a string
- Verify commands produce PASS/FAIL output with descriptive messages
- Playwright export support for all verify commands (e.g. `verify-text` exports as `await expect(page.getByText(...)).toBeVisible()`)
- 29 new tests for verify commands (241 total)

## v0.7.0

### Fixed

- Debugger session cleanup: the yellow "debugging this tab" bar now reliably disappears when recording stops or the panel closes
- Three-layer cleanup strategy: on panel connect, on stop recording, and on panel disconnect
- Handles MV3 service worker restarts that previously left orphaned debugger sessions
- Content recorder now correctly records checkbox check/uncheck interactions (was skipping all INPUT elements)

### Added

- Unit test suite with 212 tests using Vitest
- Test coverage for all source files (background.js, panel.js, recorder.js, lib/*)
- Chrome API mocking via vitest-chrome with happy-dom environment
- Tests for recording lifecycle: startRecording, stopRecording, CDP event listeners
- Tests for all command implementations including error paths

## v0.6.0

### Added

- Export session as Playwright TypeScript test (`export` command)
- Export single command conversion (`export <cmd>`)
- Scoped click support: `click "delete" "Buy milk"` targets a button within a specific list item
- Item context detection for action buttons (delete, remove, edit, close, destroy)
- Checkbox recording via content script with label/context detection
- Fill command debounce (800ms in content recorder, 1500ms in background recorder)
- Recording via `console.debug("__pw:...")` protocol with CDP `Runtime.consoleAPICalled` listener
- `Page.addScriptToEvaluateOnNewDocument` so recorder survives page reloads

## v0.5.0

### Added

- Action recorder: toggle recording, interact with the page, see .pw commands appear in real time
- Recording captures: clicks, text input, dropdown selections, checkbox toggles, special key presses, page navigations
- Load `.pw` files for review and replay
- Play button replays loaded commands sequentially with 300ms delay
- Save commands as `.pw` files
- Copy commands to clipboard
- Command history navigation with ArrowUp/ArrowDown
- Comment support (`# comment lines`)

### Commands

- `goto` / `open` -- navigate to URL (auto-prepends `https://` if missing)
- `click` / `c` -- click by text, aria-label, or snapshot ref
- `dblclick` -- double-click an element
- `fill` / `f` -- fill an input by label, placeholder, or aria-label
- `select` -- select dropdown option by text
- `check` / `uncheck` -- toggle checkboxes
- `hover` -- hover over an element
- `press` / `p` -- press a key (Enter, Tab, Escape, Backspace, Delete, arrow keys, Space)
- `snapshot` / `s` -- show accessibility tree with element refs
- `screenshot` -- capture screenshot (supports `screenshot full` for full page)
- `eval` -- evaluate JavaScript in page context
- `go-back` / `back` -- navigate back
- `go-forward` / `forward` -- navigate forward
- `reload` -- reload the page
- `export` -- export session as Playwright TypeScript
- `help` -- show available commands

## v0.1.0

### Added

- Initial Chrome DevTools extension (Manifest V3)
- DevTools panel with terminal-style REPL interface
- Background service worker with CDP command execution via `chrome.debugger`
- Basic command set: `goto`, `snapshot`, `screenshot`, `eval`, `click` (by ref), `press`
- Accessibility tree snapshot with formatted output
- Dark theme UI with monospace font
