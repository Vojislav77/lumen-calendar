# Lumen Calendar

A clean, fast, offline-first desktop calendar for Linux, macOS, and Windows. Built with Electron.

## Features

- **Month / Week / Day views** — switch between them with `1` `2` `3`
- **Events, Tasks, Notes** — full CRUD with inline editing
- **Recurring events** — daily, weekly, weekday, monthly, yearly with undo support
- **ICS import / export** — drag-and-drop from other calendars, including from URL (`webcal://` → `https://`)
- **Per-event color override** — override calendar color on individual events
- **Calendar management** — create, rename, recolor, hide, and delete calendars
- **Dark mode** — system-following or manual toggle
- **12 / 24-hour time** and **date format** (`DD/MM/YYYY`, `MM/DD/YYYY`, `DD Mon YYYY`)
- **Week start** — Monday or Sunday
- **Reminders** — desktop notifications for events
- **Search** — search all events by title, location, or description
- **Keyboard shortcuts** — press `?` anywhere to see the full list
- **System tray** — minimize to tray with optional start-on-boot
- **Minimal & responsive UI** — built with vanilla JS, no framework overhead

## Quick start

```bash
npm install
npm run dist
```

The AppImage (Linux), `.dmg` (macOS), or installer (Windows) will be in `dist/`.

For development:

```bash
npm start
```

## Project structure

```
src/
  main.js          Electron main process
  preload.js       Context bridge
  store.js         Data store with undo
  importers.js     ICS / CSV parser and exporter
  renderer/
    app.js         UI logic
    index.html     Templates
    styles.css     All styles
test/              Unit tests (node --test)
assets/            App icons
```

## Tests

```bash
npm test
```

## Tech

- Electron 41
- Vanilla JS (no frameworks)
- ICS / iCalendar standard (RFC 5545)
- `node --test` for unit tests

## License

MIT

---

© 2026 Vojislav Korać · Built with [OpenCode](https://opencode.ai)
