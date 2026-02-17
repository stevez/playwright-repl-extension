# Backlog

## Tier 1 — High value, easy to implement

- [ ] `type <text>` — Type text key-by-key (for autocomplete/search fields). CDP `Input.dispatchKeyEvent`
- [ ] `dialog-accept [text]` — Accept browser dialog (alert/confirm/prompt). CDP `Page.handleJavaScriptDialog`
- [ ] `dialog-dismiss` — Dismiss browser dialog. CDP `Page.handleJavaScriptDialog`
- [ ] `console` — Show browser console messages. CDP `Runtime.consoleAPICalled`
- [ ] `pdf` — Save page as PDF. CDP `Page.printToPDF`
- [ ] `resize <w> <h>` — Resize viewport for responsive testing. CDP `Emulation.setDeviceMetricsOverride`

## Tier 2 — Medium value, moderate effort

- [ ] `network` — Show network request log. CDP `Network` domain events
- [ ] `upload <ref> <file>` — Upload file to input. CDP `DOM.setFileInputFiles`
- [ ] `tab-list` — List open tabs. `chrome.tabs` API (needs `tabs` permission)
- [ ] `tab-new [url]` — Open new tab. `chrome.tabs` API
- [ ] `tab-close [index]` — Close a tab. `chrome.tabs` API
- [ ] `tab-select <index>` — Switch to a tab. `chrome.tabs` API
- [ ] `drag <from> <to>` — Drag and drop. CDP mouse events
