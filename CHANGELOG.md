# Changelog

All notable changes to Pip Todos are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-09

### Added

- Sidebar todo list with real checkboxes, add, edit, delete, and a collapsible
  Done section.
- Multiple lists, each stored as its own `.md` file; first launch creates an Inbox.
- Quick capture from the editor with `Ctrl+Alt+T` / `Cmd+Alt+T`, pre-filled with the
  current selection.
- Auto-save on every change with debounced, atomic writes and a footer save status.
- External file watching: editing a `.md` file by hand refreshes the sidebar.
- Export all lists to a single JSON backup, and import with Merge or Replace all.
- Theme-aware styling for dark, light, and high-contrast themes.
- Unit tests for markdown parsing/serialization and backup validation.
