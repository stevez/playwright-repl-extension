# Chrome DevTools Extension for playwright-repl

## Context

playwright-repl is a terminal REPL for Playwright browser automation. We want a **standalone Chrome DevTools extension** that provides:
1. A **REPL panel** inside DevTools (next to Elements/Console/Network tabs) for typing .pw commands
2. An **action recorder** that captures user interactions and generates .pw commands

The extension works standalone — no Node.js daemon required. Inspired by [playwright-crx](https://github.com/ruifigueira/playwright-crx) but built from scratch.

**Separate repo:** `playwright-repl-extension` — no shared code with the Node.js REPL (different runtime). Only shares the `.pw` file format and command vocabulary.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Chrome DevTools Panel ("Playwright REPL")                   │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Command output area (scrollable)                        │ │
│ │  > goto https://example.com                             │ │
│ │  ✓ Navigated to https://example.com                     │ │
│ │  > click "Submit"                                       │ │
│ │  ✓ Clicked                                              │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ pw> [input field]                          [⏺ Record]  │ │
│ └─────────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────────┘
                       │ chrome.runtime.sendMessage()
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Background Service Worker                                   │
│ - Receives commands from panel                              │
│ - Uses chrome.debugger API to execute CDP commands          │
│ - Translates .pw commands → CDP protocol calls              │
│ - Returns results to panel                                  │
└──────────────────────┬──────────────────────────────────────┘
                       │ chrome.debugger.sendCommand()
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Chrome Browser Tab (inspected page)                         │
│ - Receives CDP commands (click, evaluate, navigate, etc.)   │
│ - Content script captures user actions for recording        │
└─────────────────────────────────────────────────────────────┘
```

### How Commands Execute (without daemon)

Instead of the daemon's socket protocol, we use Chrome's `chrome.debugger` API to send CDP (Chrome DevTools Protocol) commands directly:

| .pw command | CDP approach |
|-------------|-------------|
| `goto <url>` | `chrome.debugger.sendCommand(target, 'Page.navigate', {url})` |
| `click <text>` | Evaluate JS: `document.querySelector(...)` or accessibility query → `DOM.getBoxModel` → `Input.dispatchMouseEvent` |
| `fill <text> <value>` | Find element → focus → `Input.dispatchKeyEvent` for each char |
| `press <key>` | `Input.dispatchKeyEvent` |
| `snapshot` | `Accessibility.getFullAXTree` → format as text |
| `screenshot` | `Page.captureScreenshot` |
| `eval <expr>` | `Runtime.evaluate` |

For complex interactions (click by text, fill by label), we evaluate JavaScript in the page context using `Runtime.evaluate` with helper functions that use `document.querySelector`, `getByText`-like logic, etc.

### How Recording Works

A **content script** is injected into the inspected page. It listens for:

| DOM Event | Generated .pw command |
|-----------|----------------------|
| `click` on element | `click "Button Text"` or `click "Link Text"` |
| `input`/`change` on field | `fill "Label" "value"` |
| `change` on checkbox | `check "Label"` / `uncheck "Label"` |
| `change` on select | `select "Label" "option"` |
| `keydown` (Enter, Tab, Escape) | `press Enter` |
| Navigation (popstate, hashchange) | `goto <url>` |

The content script determines locators by:
1. `aria-label` or associated `<label>` text
2. `placeholder` attribute
3. Element text content
4. Role + accessible name
5. Fallback: CSS selector

## Project Structure (new repo: playwright-repl-extension)

```
playwright-repl-extension/
├── manifest.json              # Manifest V3
├── devtools.html              # DevTools page (loads devtools.js)
├── devtools.js                # Creates the DevTools panel
├── panel/
│   ├── panel.html             # REPL panel UI
│   ├── panel.js               # Panel logic (input, output, history)
│   └── panel.css              # Styling
├── background.js              # Service worker — CDP command execution
├── content/
│   └── recorder.js            # Content script — DOM event recording
├── lib/
│   ├── commands.js            # .pw command → CDP translation
│   ├── locators.js            # Element location strategies
│   └── formatter.js           # Result formatting for display
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Implementation Phases

### Phase 1: Extension shell + DevTools panel

**Goal:** Load extension in Chrome, see a "Playwright REPL" tab in DevTools.

Files:
- `manifest.json` — Manifest V3 with `devtools_page`, `permissions: ["debugger"]`
- `devtools.html` + `devtools.js` — `chrome.devtools.panels.create("Playwright REPL", ...)`
- `panel/panel.html` — Basic HTML with input field + output area
- `panel/panel.js` — Handle input, display output, command history (up/down arrows)
- `panel/panel.css` — Terminal-like styling (dark bg, monospace font)

### Phase 2: Command execution via CDP

**Goal:** Type `goto https://example.com` in the panel and have it navigate the inspected tab.

Files:
- `background.js` — Service worker that:
  - Listens for messages from panel via `chrome.runtime.onMessage`
  - Attaches to inspected tab via `chrome.debugger.attach()`
  - Translates .pw commands to CDP calls
  - Returns results
- `lib/commands.js` — Command router:
  - `goto` → `Page.navigate`
  - `snapshot` → `Accessibility.getFullAXTree` + format
  - `screenshot` → `Page.captureScreenshot` → display in panel
  - `eval` → `Runtime.evaluate`
  - `click` → locate element + `Input.dispatchMouseEvent`
  - `fill` → locate element + focus + key events
  - `press` → `Input.dispatchKeyEvent`
- `lib/locators.js` — Element finding via:
  - `Runtime.evaluate` with JS that queries by text, label, role, placeholder

**Start with a minimal subset:** `goto`, `snapshot`, `screenshot`, `eval`, `click` (by ref from snapshot), `press`

### Phase 3: Text locators + more commands

**Goal:** `click "Submit"`, `fill "Email" "test@example.com"` work.

- Extend `locators.js` with text-based element finding
- Add `fill`, `select`, `check`, `uncheck`, `hover`, `dblclick`
- Add tab commands using `chrome.tabs` API
- Add `go-back`, `go-forward`, `reload`

### Phase 4: Action recorder

**Goal:** Toggle recording, click around in the page, see .pw commands appear in the panel.

Files:
- `content/recorder.js` — Content script that:
  - Listens for click, input, change, keydown, navigation events
  - Determines best locator for each element
  - Sends `.pw` command string to background → panel
- Update `manifest.json` to declare content script
- Update `panel.js` with Record/Stop button, recorded commands list
- Add "Save as .pw" button (downloads text file)

### Phase 5: Load & Replay .pw files

**Goal:** Load a `.pw` file, review commands, then replay them.

- **Load button** — file picker (`<input type="file" accept=".pw">`) opens `.pw` file
- Loaded commands displayed in output area (grayed out / dimmed, not yet executed)
- **Play button** — replays loaded commands one by one:
  - Highlights the current command being executed
  - Shows result after each command
  - Becomes **Pause/Stop** during replay for step-through control

### Phase 6: Polish

- Command aliases (c → click, s → snapshot, etc.) — reuse vocabulary from playwright-repl
- Verify commands (verify-text, verify-element, etc.)
- Tab completion in input field
- Error handling and connection status
- Icons and branding

## Key Chrome APIs

- `chrome.devtools.panels.create()` — register DevTools panel
- `chrome.devtools.inspectedWindow.tabId` — get inspected tab
- `chrome.debugger.attach(target, version)` — attach CDP debugger
- `chrome.debugger.sendCommand(target, method, params)` — send CDP command
- `chrome.debugger.detach(target)` — detach
- `chrome.runtime.sendMessage()` / `onMessage` — panel ↔ background communication
- `chrome.scripting.executeScript()` — inject content script for recording

## Panel UI — Toolbar

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Load     │  │ Play     │  │ Copy     │  │ Save     │  │ Clear    │
└──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

- **Load** — open `.pw` file, display commands for review (grayed out)
- **Play** — replay loaded/recorded commands; becomes Pause/Stop during replay
- **Copy** — copy all commands to clipboard
- **Save** — download commands as `.pw` file
- **Clear** — clear the output area
- **Record** (in input bar) — toggle action recording on/off

## Panel UI — Full Mockup

```
┌─ Elements  Console  Sources  Network  Playwright REPL ─────────────────────┐
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                         │ │
│  │  > goto https://demo.playwright.dev/todomvc/                            │ │
│  │  ✓ Navigated to https://demo.playwright.dev/todomvc/                    │ │
│  │                                                                         │ │
│  │  > snapshot                                                             │ │
│  │  - heading "todos" [ref=e1]                                             │ │
│  │  - textbox "What needs to be done?" [ref=e8]                            │ │
│  │                                                                         │ │
│  │  > fill "What needs to be done?" "Buy groceries"                        │ │
│  │  ✓ Filled "Buy groceries"                                               │ │
│  │                                                                         │ │
│  │  > press Enter                                                          │ │
│  │  ✓ Pressed Enter                                                        │ │
│  │                                                                         │ │
│  │  > verify-text "Buy groceries"                                          │ │
│  │  ✓ Text "Buy groceries" is visible                                      │ │
│  │                                                                         │ │
│  │  > screenshot                                                           │ │
│  │  ┌───────────────────────────────┐                                      │ │
│  │  │       [inline screenshot]     │                                      │ │
│  │  └───────────────────────────────┘                                      │ │
│  │                                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────┬───────────────┐ │
│  │ pw> _                                                   │ ⏺ Record     │ │
│  └─────────────────────────────────────────────────────────┴───────────────┘ │
│                                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ Load     │  │ Play     │  │ Copy     │  │ Save     │  │ Clear    │     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Verification

1. Load unpacked extension from project directory in `chrome://extensions`
2. Open any webpage → Open DevTools (F12)
3. See "Playwright REPL" tab in DevTools
4. Type `goto https://demo.playwright.dev/todomvc/` → page navigates
5. Type `snapshot` → see accessibility tree
6. Type `click "What needs to be done?"` → element gets focus
7. Toggle Record → interact with page → see .pw commands appear
8. Click "Save" → downloads `.pw` file
9. Click "Load" → open a `.pw` file → commands shown grayed out
10. Click "Play" → commands replay one by one with results
