# Playwright REPL

A Chrome DevTools extension that adds a REPL panel for Playwright-style browser automation commands. Type `.pw` commands to navigate, click, fill forms, take screenshots, and more -- all directly from DevTools.

## Features

- **REPL panel** inside Chrome DevTools (next to Elements, Console, Network)
- **25+ commands**: `goto`, `click`, `fill`, `select`, `check`, `press`, `verify-text`, `snapshot`, `screenshot`, `eval`, and more
- **Action recorder**: toggle recording, interact with the page, and watch `.pw` commands appear in real time
- **Load & replay** `.pw` files
- **Export** sessions as Playwright TypeScript tests
- **Accessibility tree** snapshots with element refs
- **Scoped clicks**: `click "delete" "Buy milk"` targets a button within a specific list item
- **Text locators**: finds elements by aria-label, label text, placeholder, or text content

## Installation

1. Clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked** and select the project directory
5. Open any webpage, open DevTools (F12), and find the **Playwright REPL** tab

## Usage

### Commands

```
pw> goto https://demo.playwright.dev/todomvc/
pw> snapshot
pw> fill "What needs to be done?" "Buy groceries"
pw> press Enter
pw> click "Buy groceries"
pw> screenshot
```

| Command | Description |
|---------|-------------|
| `goto <url>` | Navigate to URL |
| `click "text"` | Click an element by text |
| `click "text" "scope"` | Click within a scoped container |
| `dblclick "text"` | Double-click an element |
| `fill "target" "value"` | Fill an input field |
| `select "target" "option"` | Select a dropdown option |
| `check "target"` | Check a checkbox |
| `uncheck "target"` | Uncheck a checkbox |
| `hover "text"` | Hover over an element |
| `press <key>` | Press a key (Enter, Tab, Escape, ...) |
| `snapshot` | Show accessibility tree |
| `screenshot [full]` | Capture screenshot (optional full page) |
| `eval <expr>` | Evaluate JavaScript expression |
| `verify-text "text"` | Assert text is visible on page |
| `verify-no-text "text"` | Assert text is NOT on page |
| `verify-element "target"` | Assert element exists |
| `verify-no-element "target"` | Assert element does NOT exist |
| `verify-url "substring"` | Assert URL contains string |
| `verify-title "text"` | Assert page title contains string |
| `go-back` / `back` | Navigate back |
| `go-forward` / `forward` | Navigate forward |
| `reload` | Reload the page |
| `export` | Export session as Playwright test |
| `export <cmd>` | Convert a single command to Playwright |
| `help` | Show available commands |

Aliases: `c` (click), `s` (snapshot), `f` (fill), `p` (press)

### Recording

1. Click the **Record** button in the input bar
2. Interact with the page -- clicks, typing, selecting, checking boxes
3. Watch `.pw` commands appear in the panel in real time
4. Click **Stop** when done
5. Use **Save** to download as a `.pw` file, or **Export** to get Playwright TypeScript

The recorder captures:
- Clicks on buttons, links, and interactive elements
- Checkbox check/uncheck (with scoped context for list items)
- Text input with debounced `fill` commands
- Dropdown selections
- Special key presses (Enter, Tab, Escape)
- Page navigations as `goto` commands

### Toolbar

| Button | Action |
|--------|--------|
| **Load** | Open a `.pw` file for review and replay |
| **Play** | Replay loaded commands one by one |
| **Copy** | Copy all commands to clipboard |
| **Save** | Download commands as a `.pw` file |
| **Clear** | Clear the output area |

## Architecture

```
DevTools Panel (panel.js)
    |
    | chrome.runtime.sendMessage / port
    v
Background Service Worker (background.js)
    |
    | chrome.debugger.sendCommand (CDP)
    v
Inspected Page
    |
    | console.debug("__pw:...") events
    v
Background (listener) --> Panel (recorded commands)
```

- **panel.js** -- UI, input handling, command history, export
- **background.js** -- CDP command execution, debugger lifecycle, recording coordinator
- **content/recorder.js** -- Injected into pages during recording, captures DOM events
- **lib/commands.js** -- Command parser (handles quoted args, comments, whitespace)
- **lib/locators.js** -- Generates JavaScript for finding/clicking elements by text
- **lib/formatter.js** -- Formats accessibility tree nodes for display
- **lib/converter.js** -- Converts `.pw` commands to Playwright TypeScript

## Development

### Prerequisites

- Node.js (for running tests)
- Chrome browser

### Install dependencies

```bash
npm install
```

### Run tests

```bash
npm test              # single run
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
```

### Project structure

```
playwright-repl-extension/
├── manifest.json          # Chrome Extension Manifest V3
├── devtools.html          # DevTools page entry point
├── devtools.js            # Creates the DevTools panel
├── background.js          # Service worker -- CDP commands + recording
├── panel/
│   ├── panel.html         # REPL panel UI
│   ├── panel.js           # Panel logic
│   └── panel.css          # Dark terminal-style theme
├── content/
│   └── recorder.js        # Content script for action recording
├── lib/
│   ├── commands.js        # .pw command parser
│   ├── locators.js        # Element locator JS generation
│   ├── formatter.js       # Accessibility tree formatter
│   └── converter.js       # .pw --> Playwright TypeScript converter
├── tests/                 # Vitest test suite (241 tests)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── vitest.config.js
```

## .pw File Format

`.pw` files are plain text with one command per line. Comments start with `#`.

```
# Navigate to the todo app
goto https://demo.playwright.dev/todomvc/

# Add a todo item
fill "What needs to be done?" "Buy groceries"
press Enter

# Verify it was added
snapshot
screenshot
```

## License

MIT
