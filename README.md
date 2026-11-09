<div align="center">

<img src="media/icon.png" alt="Pip Todos" width="104" height="104" />

# Pip Todos

**A tiny sidebar todo list for the small things you notice while you work.**

Drop a thought into VS Code in two seconds, keep coding, and check it off later.

[![VS Code](https://img.shields.io/badge/VS%20Code-1.84%2B-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-F2C14E.svg)](LICENSE)
![Dependencies](https://img.shields.io/badge/runtime%20deps-0-6FCF97)

</div>

---

## Why

While you build a website, you keep noticing small things to fix later. A missing
loading state, a leftover `console.log`, a label to rename. Pip Todos gives you one
calm place to park them, right in the sidebar, so you never break your flow to
remember them and never lose them either.

No accounts. No cloud. No settings page. Just a checklist that stays out of your way.

## Features

- **Lists** - Keep as many as you like (`inbox`, `bego`, `ideas`). Each list is one
  plain `.md` file, so your notes stay yours and stay readable.
- **One-key capture** - Press `Ctrl+Alt+T` (`Cmd+Alt+T` on macOS) from anywhere in
  the editor to add a todo without leaving your code. Text you have selected is
  pre-filled for you.
- **Real checkboxes** - Click to check, double-click to edit, hover to delete. Done
  items slide into a collapsible section, struck through and dimmed.
- **Auto-save, always** - Every change is written to disk right away. There is no
  Save button and no "unsaved" state. Writes are atomic, so a crash never leaves a
  half-written list.
- **Export and import** - Back up every list to a single JSON file, then merge or
  replace on another machine.
- **Native to your theme** - Built entirely from VS Code theme variables, so it
  looks right in dark, light and high-contrast themes. The only custom color is the
  Pip yellow.
- **Edit outside the extension** - Change a `.md` file by hand and the sidebar
  refreshes to match.

## Meet Pip

Pip is a small yellow sticky note with a folded corner, two dot eyes, and a smile
shaped like a check mark. Every icon in the extension is drawn from that one shape.

## Install

### From a packaged build

```bash
npm install
npm run build
npx @vscode/vsce package      # produces pip-todos-x.y.z.vsix
code --install-extension pip-todos-*.vsix
```

### Run from source

```bash
npm install
npm run watch        # rebuilds on change
```

Then press `F5` in VS Code to open an Extension Development Host with Pip Todos
loaded. The Pip icon appears in the Activity Bar.

## Usage

| Action | How |
| --- | --- |
| Add a todo | Type in the add box and press Enter, or use `Ctrl/Cmd+Alt+T` |
| Check / uncheck | Click the checkbox or the text |
| Edit | Double-click the text (Enter saves, Escape cancels, empty deletes) |
| Delete | Click the `x` that appears on hover, or press Delete on a focused row |
| New list | Click `+` in the header or the `+ New list` chip |
| Switch list | Click a list chip |
| Rename / delete list | Open the `...` menu, or right-click a chip |
| Clear finished items | `...` menu -> Clear done in this list |
| Export / Import | Footer buttons, or the `...` menu |

Everything is keyboard reachable, with a visible focus ring on every control.

## Where your data lives

Lists are stored per machine and shared across every workspace, in your extension's
global storage:

```
<VS Code global storage>/yoni.pip-todos/lists/
  inbox.md
  bego.md
  ideas.md
```

Each file is standard GitHub task-list markdown, so it stays useful even without the
extension:

```markdown
# bego

- [ ] Rename API env vars
- [ ] Loading state on submit button
- [x] Remove leftover console.logs
```

A backup export is one JSON file containing every list:

```json
{
  "app": "pip-todos",
  "version": 1,
  "exportedAt": "2026-11-09T10:00:00Z",
  "lists": [
    { "id": "bego", "name": "bego", "items": [{ "text": "Rename API env vars", "done": false }] }
  ]
}
```

## Development

```bash
npm install          # install dev dependencies (zero runtime dependencies)
npm run build        # bundle extension + webview with esbuild
npm run watch        # rebuild on change
npm run lint         # type-check with tsc
npm test             # unit tests for markdown parsing and backup validation
```

### How it is built

- **TypeScript** throughout, bundled with **esbuild**, no UI framework.
- The sidebar is a single `WebviewViewProvider`. The extension host is the one
  source of truth; the webview only renders state and sends back actions.
- A strict Content-Security-Policy guards the webview, and all todo text is rendered
  with `textContent`, never `innerHTML`.

### Project structure

```
pip-todos/
  src/
    extension.ts     activate, commands, register the view
    store.ts         load/save lists, debounce, atomic write, file watcher
    markdown.ts      parse + serialize list files
    backup.ts        export / import / validate JSON
    sidebarView.ts   WebviewViewProvider, message handling
    types.ts         shared data shapes
  webview/
    main.ts          builds the UI from state, sends actions
    style.css        theme-aware styling
  media/             icon.png, pip.svg, activity.svg
  test/              markdown + backup unit tests
```

## Design principles

- Clean, simple, usable. No tags, due dates, priorities, reminders, or drag-to-reorder.
- Everything lives in one sidebar view.
- The user never sees raw markdown.
- Every change saves itself.

## Contributing

Issues and pull requests are welcome. Please keep the scope small and in line with
the design principles above, run `npm run lint` and `npm test` before opening a PR,
and follow the Conventional Commits format for commit messages.

## License

[MIT](LICENSE) (c) 2026 yoni
